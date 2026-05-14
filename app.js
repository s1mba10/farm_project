// === Загрузка вопросов ===
let ALL = [];
let view = [];  // отфильтрованный/перемешанный список
let idx = 0;
let mode = "learn";
let answered = false;       // в test-режиме — был ли ответ проверен
let selected = new Set();   // выбранные индексы вариантов (после перемешивания опций)
let orderMap = [];          // отображённый индекс -> исходный

const LS_KEY = "farm_state_v1";
const state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw 0;
    const s = JSON.parse(raw);
    return {
      mistakes: new Set(s.mistakes || []),
      correct: new Set(s.correct || []),
      bookmarks: new Set(s.bookmarks || []),
    };
  } catch {
    return { mistakes: new Set(), correct: new Set(), bookmarks: new Set() };
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    mistakes: [...state.mistakes],
    correct: [...state.correct],
    bookmarks: [...state.bookmarks],
  }));
}

// === Утилиты ===
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// === Фильтрация по режиму ===
function rebuildView() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  let pool = ALL;

  if (mode === "mistakes") {
    pool = ALL.filter(x => state.mistakes.has(x.id));
  } else if (mode === "bookmarks") {
    pool = ALL.filter(x => state.bookmarks.has(x.id));
  }

  if (q) {
    pool = pool.filter(x =>
      x.question.toLowerCase().includes(q) ||
      x.options.some(o => o.toLowerCase().includes(q))
    );
  }

  if (document.getElementById("shuffleQ").checked) {
    pool = shuffle(pool);
  }

  view = pool;
  if (idx >= view.length) idx = 0;
  render();
}

// === Рендер карточки ===
function render() {
  const card = document.getElementById("card");
  updateBadges();

  if (!view.length) {
    let msg = "Нет вопросов.";
    if (mode === "mistakes") msg = "🎉 Нет ошибок. Молодец!";
    if (mode === "bookmarks") msg = "📌 Нет закладок. Нажми ★ на карточке, чтобы добавить.";
    card.innerHTML = `<div class="empty">${msg}</div>`;
    document.getElementById("progressText").textContent = "0 / 0";
    return;
  }

  const q = view[idx];
  document.getElementById("progressText").textContent = `${idx + 1} / ${view.length}`;
  answered = false;
  selected.clear();

  // Перемешивание вариантов
  const optsIdx = q.options.map((_, i) => i);
  orderMap = document.getElementById("shuffleA").checked ? shuffle(optsIdx) : optsIdx;

  const isBookmarked = state.bookmarks.has(q.id);
  const typeLabel = q.type === "multi" ? "несколько ответов" : "один ответ";

  card.innerHTML = `
    <div class="q-head">
      <div>
        <span class="badge-id">№ ${q.id}</span>
        <span class="q-type-badge ${q.type}">${typeLabel}</span>
      </div>
      <button class="bookmark ${isBookmarked ? 'on' : ''}" id="bookmarkBtn" title="Закладка (B)">${isBookmarked ? '★' : '☆'}</button>
    </div>
    <div class="q-text">${escapeHtml(q.question)}</div>
    <div class="options" id="opts">
      ${orderMap.map((origI, dispI) => `
        <div class="option" data-i="${origI}">
          <div class="num">${dispI + 1}</div>
          <div class="txt">${escapeHtml(q.options[origI])}</div>
        </div>`).join("")}
    </div>
    <div class="actions">
      ${mode === "test"
        ? `<button id="checkBtn">Проверить</button><button id="revealBtn" class="secondary">Показать ответ</button><span class="verdict" id="verdict"></span>`
        : `<button id="revealBtn">Показать правильный</button>`
      }
    </div>
  `;

  // Подсветка правильных в learn-режиме
  if (mode === "learn" || mode === "mistakes" || mode === "bookmarks") {
    // ничего сразу не показываем — показать по кнопке
  }

  // Обработчики
  card.querySelectorAll(".option").forEach(el => {
    el.addEventListener("click", () => onOptionClick(el));
  });

  document.getElementById("bookmarkBtn").addEventListener("click", toggleBookmark);

  if (mode === "test") {
    document.getElementById("checkBtn").addEventListener("click", check);
  }
  document.getElementById("revealBtn").addEventListener("click", reveal);
}

function onOptionClick(el) {
  if (answered) return;
  const i = parseInt(el.dataset.i, 10);
  const cur = view[idx];

  if (cur.type === "multi") {
    if (selected.has(i)) {
      selected.delete(i);
      el.classList.remove("selected");
    } else {
      selected.add(i);
      el.classList.add("selected");
    }
  } else {
    // single — снимаем со всех, ставим один
    document.querySelectorAll(".option.selected").forEach(o => o.classList.remove("selected"));
    selected.clear();
    selected.add(i);
    el.classList.add("selected");

    // в learn режиме сразу проверяем
    if (mode !== "test") {
      check();
    }
  }
}

function check() {
  if (answered) return;
  const q = view[idx];
  if (!selected.size) return;

  answered = true;
  const correctSet = new Set(q.correct);
  const selectedSet = selected;

  // Подсветка
  document.querySelectorAll(".option").forEach(el => {
    const i = parseInt(el.dataset.i, 10);
    const isCorrect = correctSet.has(i);
    const isSelected = selectedSet.has(i);
    el.classList.remove("selected");
    if (isSelected && isCorrect) el.classList.add("correct");
    else if (isSelected && !isCorrect) el.classList.add("wrong");
    else if (!isSelected && isCorrect) el.classList.add("reveal-correct");
  });

  // Сравнение для multi
  const ok = correctSet.size === selectedSet.size &&
             [...correctSet].every(x => selectedSet.has(x));

  if (ok) {
    state.correct.add(q.id);
    state.mistakes.delete(q.id);
  } else {
    state.mistakes.add(q.id);
  }
  saveState();
  updateBadges();

  if (mode === "test") {
    const v = document.getElementById("verdict");
    if (v) {
      v.textContent = ok ? "✓ Верно" : "✗ Неверно";
      v.className = "verdict " + (ok ? "ok" : "fail");
    }
  }
}

function reveal() {
  if (answered) return;
  answered = true;
  const q = view[idx];
  const correctSet = new Set(q.correct);
  document.querySelectorAll(".option").forEach(el => {
    const i = parseInt(el.dataset.i, 10);
    if (correctSet.has(i)) el.classList.add("reveal-correct");
  });
}

function toggleBookmark() {
  const q = view[idx];
  if (!q) return;
  if (state.bookmarks.has(q.id)) state.bookmarks.delete(q.id);
  else state.bookmarks.add(q.id);
  saveState();
  document.getElementById("bookmarkBtn").classList.toggle("on");
  document.getElementById("bookmarkBtn").textContent = state.bookmarks.has(q.id) ? "★" : "☆";
  updateBadges();
}

function updateBadges() {
  document.getElementById("mistakesCount").textContent = state.mistakes.size;
  document.getElementById("bookmarksCount").textContent = state.bookmarks.size;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

// === Навигация ===
function next() { if (view.length) { idx = (idx + 1) % view.length; render(); } }
function prev() { if (view.length) { idx = (idx - 1 + view.length) % view.length; render(); } }

// === Инициализация ===
fetch("data/questions.json")
  .then(r => r.json())
  .then(data => {
    ALL = data;
    rebuildView();
  })
  .catch(e => {
    document.getElementById("card").innerHTML = `<div class="empty">Ошибка загрузки: ${e}</div>`;
  });

// === События UI ===
document.querySelectorAll(".modes button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".modes button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    mode = b.dataset.mode;
    idx = 0;
    rebuildView();
  });
});

document.getElementById("search").addEventListener("input", debounce(rebuildView, 200));
document.getElementById("shuffleQ").addEventListener("change", rebuildView);
document.getElementById("shuffleA").addEventListener("change", render);

document.getElementById("nextBtn").addEventListener("click", next);
document.getElementById("prevBtn").addEventListener("click", prev);

document.getElementById("jump").addEventListener("change", e => {
  const n = parseInt(e.target.value, 10);
  if (!n) return;
  // ищем по id
  const i = view.findIndex(q => q.id === n);
  if (i >= 0) { idx = i; render(); }
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (confirm("Сбросить весь прогресс (ошибки, закладки, статистику)?")) {
    state.mistakes.clear();
    state.correct.clear();
    state.bookmarks.clear();
    saveState();
    updateBadges();
    render();
  }
});

// Горячие клавиши
document.addEventListener("keydown", e => {
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key === "ArrowRight") next();
  else if (e.key === "ArrowLeft") prev();
  else if (e.key === "Enter") {
    if (mode === "test" && !answered) check();
    else next();
  }
  else if (e.key === "b" || e.key === "B" || e.key === "и" || e.key === "И") {
    toggleBookmark();
  }
  else if (/^[1-9]$/.test(e.key)) {
    const n = parseInt(e.key, 10);
    const els = document.querySelectorAll(".option");
    if (els[n-1]) els[n-1].click();
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
