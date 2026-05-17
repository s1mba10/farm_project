// ============================================================
// Фарм-тренажёр — фронтенд
// ============================================================

let ALL = [];
let view = [];
let idx = 0;
let mode = "learn";
let answered = false;
let selected = new Set();
let orderMap = [];

// Экзамен
let examState = null; // { questions: [...], current: 0, correctCount: 0, answered: false }

const LS_KEY = "farm_state_v2";
const LS_PREFS = "farm_prefs_v1";

// state.stats — Map<id, {ok, fail, streak}>
const state = loadState();
const prefs = loadPrefs();

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return {
      bookmarks: new Set(s.bookmarks || []),
      stats: new Map(Object.entries(s.stats || {}).map(([k,v]) => [parseInt(k,10), v])),
      attempts: new Map(Object.entries(s.attempts || {}).map(([k,v]) => [parseInt(k,10), v])),
    };
  } catch {
    return { bookmarks: new Set(), stats: new Map(), attempts: new Map() };
  }
}

function saveState() {
  const statsObj = {};
  state.stats.forEach((v, k) => { statsObj[k] = v; });
  const attemptsObj = {};
  state.attempts.forEach((v, k) => { attemptsObj[k] = v; });
  localStorage.setItem(LS_KEY, JSON.stringify({
    bookmarks: [...state.bookmarks],
    stats: statsObj,
    attempts: attemptsObj,
  }));
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFS) || "{}");
  } catch { return {}; }
}
function savePrefs() {
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
}

// === Helpers ===
function getStat(id) {
  return state.stats.get(id) || { ok: 0, fail: 0, streak: 0 };
}
function isMastered(id) {
  const s = getStat(id);
  return s.streak >= 3;  // 3 раза подряд = освоен
}
function isMistake(id) {
  const s = getStat(id);
  return s.fail > 0 && s.streak === 0;
}
function isHard(id) {
  const s = getStat(id);
  return s.fail >= 2;  // 2+ раз ошибался
}
function isPassed(id) {
  return state.attempts.has(id);
}

// Фильтр диапазона: применяется поверх любого режима.
function applyRange(arr) {
  const lo = Number.isFinite(prefs.rangeFrom) ? prefs.rangeFrom : -Infinity;
  const hi = Number.isFinite(prefs.rangeTo) ? prefs.rangeTo : Infinity;
  if (lo === -Infinity && hi === Infinity) return arr;
  return arr.filter(x => x.id >= lo && x.id <= hi);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

// === Filter view by mode ===
function rebuildView() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  let pool = ALL;

  if (mode === "mistakes") pool = ALL.filter(x => isMistake(x.id));
  else if (mode === "hard") pool = ALL.filter(x => isHard(x.id));
  else if (mode === "bookmarks") pool = ALL.filter(x => state.bookmarks.has(x.id));
  else if (mode === "passed") pool = ALL.filter(x => isPassed(x.id));

  pool = applyRange(pool);

  if (q) {
    pool = pool.filter(x =>
      x.question.toLowerCase().includes(q) ||
      x.options.some(o => o.toLowerCase().includes(q))
    );
  }

  if (prefs.shuffleQ) pool = shuffle(pool);

  view = pool;
  if (idx >= view.length) idx = 0;
  render();
}

// === Render ===
function render() {
  if (mode === "exam") return; // экзамен рендерится отдельно

  document.getElementById("examResult").hidden = true;
  document.getElementById("card").style.display = "";
  document.querySelector(".bottom-nav").style.display = "";

  updateBadges();
  updateProgress();

  const card = document.getElementById("card");
  card.classList.remove("animate-in");

  if (!view.length) {
    let msg = "<div class='big-emoji'>📭</div><div>Нет вопросов в этом режиме.</div>";
    if (mode === "mistakes") msg = "<div class='big-emoji'>🎉</div><div>Нет актуальных ошибок!</div><div class='muted small'>Молодец. Можешь продолжить учить или зайти в «Сложные».</div>";
    if (mode === "hard") msg = "<div class='big-emoji'>👍</div><div>Сложных вопросов пока нет.</div><div class='muted small'>Они появятся, если ошибёшься на одном вопросе 2+ раза.</div>";
    if (mode === "bookmarks") msg = "<div class='big-emoji'>⭐</div><div>Нет закладок.</div><div class='muted small'>Нажми ☆ на карточке вопроса, чтобы сохранить.</div>";
    card.innerHTML = `<div class="empty">${msg}</div>`;
    setActionButton(null);
    return;
  }

  const q = view[idx];
  answered = false;
  selected.clear();

  const optsIdx = q.options.map((_, i) => i);
  orderMap = prefs.shuffleA !== false ? shuffle(optsIdx) : optsIdx;

  const isBookmarked = state.bookmarks.has(q.id);
  const mastered = isMastered(q.id);
  const stat = getStat(q.id);

  card.innerHTML = `
    <div class="q-head">
      <div class="meta">
        <span class="badge-id">№ ${q.id}</span>
        ${q.type === "multi" ? `<span class="q-type-badge multi">несколько</span>` : ''}
        ${mastered ? `<span class="mastered-badge">✓ освоен</span>` : ''}
        ${stat.fail > 0 && !mastered ? `<span class="q-type-badge multi">ошибок: ${stat.fail}</span>` : ''}
      </div>
      <button class="bookmark-btn ${isBookmarked ? 'on' : ''}" id="bookmarkBtn" aria-label="Закладка">${isBookmarked ? '★' : '☆'}</button>
    </div>
    <div class="q-text">${escapeHtml(q.question)}</div>
    <div class="options" id="opts">
      ${orderMap.map((origI, dispI) => `
        <div class="option" data-i="${origI}" data-disp="${dispI}">
          <div class="num">${dispI + 1}</div>
          <div class="txt">${escapeHtml(q.options[origI])}</div>
        </div>`).join("")}
    </div>
    <div id="feedback"></div>
  `;
  card.classList.add("animate-in");

  card.querySelectorAll(".option").forEach(el => {
    el.addEventListener("click", () => onOptionClick(el));
  });

  document.getElementById("bookmarkBtn").addEventListener("click", toggleBookmark);

  // Кнопка действия внизу
  setActionButton(q.type === "multi" ? "check" : (mode === "test" ? "check" : "skip"));

  // Если на этот вопрос уже отвечали — восстанавливаем подсветку (свои + правильные)
  const prev = state.attempts.get(q.id);
  if (prev) replayAttempt(q, prev);
}

function replayAttempt(q, attempt) {
  answered = true;
  selected = new Set(attempt.selected);
  const correctSet = new Set(q.correct);
  document.querySelectorAll(".option").forEach(el => {
    el.classList.add("disabled");
    const i = parseInt(el.dataset.i, 10);
    const isCorrect = correctSet.has(i);
    const isSel = selected.has(i);
    el.classList.remove("selected");
    if (isSel && isCorrect) el.classList.add("correct");
    else if (isSel && !isCorrect) el.classList.add("wrong");
    else if (!isSel && isCorrect) el.classList.add("reveal-correct");
  });
  const fb = document.getElementById("feedback");
  if (attempt.ok) {
    fb.innerHTML = `<div class="feedback ok">✓ Верно!</div>`;
  } else if (!attempt.selected.length) {
    fb.innerHTML = `<div class="feedback fail">💡 Правильный ответ подсвечен зелёным. Эта попытка не зачитывается.</div>`;
  } else {
    fb.innerHTML = `<div class="feedback fail">✗ Неверно. Правильный ответ подсвечен зелёным.</div>`;
  }
  setActionButton(attempt.ok ? "next" : "next-fail");
}

// Управление главной кнопкой действия в нижней навигации
function setActionButton(state) {
  const btn = document.getElementById("actionBtn");
  btn.classList.remove("ok", "fail");
  btn.disabled = false;

  if (state === null) {
    btn.textContent = "Далее";
    btn.disabled = true;
  } else if (state === "skip") {
    btn.textContent = "Пропустить →";
  } else if (state === "check") {
    btn.textContent = view[idx]?.type === "multi" ? "Проверить" : "Показать ответ";
  } else if (state === "next") {
    btn.textContent = "Далее →";
    btn.classList.add("ok");
  } else if (state === "next-fail") {
    btn.textContent = "Далее →";
    btn.classList.add("fail");
  }
  btn.dataset.action = state || "";
}

function onActionClick() {
  const a = document.getElementById("actionBtn").dataset.action;
  if (a === "check") {
    if (!selected.size && !answered) {
      // в test-режиме без выбора — показываем правильный
      revealAnswer();
    } else {
      checkAnswer();
    }
  } else if (a === "next" || a === "next-fail" || a === "skip") {
    next();
  }
}

function onOptionClick(el) {
  if (answered) return;
  const q = view[idx];
  const i = parseInt(el.dataset.i, 10);

  if (q.type === "multi") {
    if (selected.has(i)) {
      selected.delete(i);
      el.classList.remove("selected");
    } else {
      selected.add(i);
      el.classList.add("selected");
    }
  } else {
    // одиночный выбор — сразу проверяем
    document.querySelectorAll(".option.selected").forEach(o => o.classList.remove("selected"));
    selected.clear();
    selected.add(i);
    el.classList.add("selected");
    setTimeout(() => checkAnswer(), 80);
  }
}

function checkAnswer() {
  if (answered) return;
  const q = view[idx];
  if (!selected.size) return;

  answered = true;
  const correctSet = new Set(q.correct);
  const ok = correctSet.size === selected.size &&
             [...correctSet].every(x => selected.has(x));

  // Подсветка
  document.querySelectorAll(".option").forEach(el => {
    el.classList.add("disabled");
    const i = parseInt(el.dataset.i, 10);
    const isCorrect = correctSet.has(i);
    const isSel = selected.has(i);
    el.classList.remove("selected");
    if (isSel && isCorrect) el.classList.add("correct");
    else if (isSel && !isCorrect) el.classList.add("wrong");
    else if (!isSel && isCorrect) el.classList.add("reveal-correct");
  });

  // Подсказка
  const fb = document.getElementById("feedback");
  fb.innerHTML = ok
    ? `<div class="feedback ok">✓ Верно!</div>`
    : `<div class="feedback fail">✗ Неверно. Правильный ответ подсвечен зелёным.</div>`;

  // Обновляем статистику
  const cur = getStat(q.id);
  if (ok) {
    cur.ok++;
    cur.streak++;
  } else {
    cur.fail++;
    cur.streak = 0;
  }
  state.stats.set(q.id, cur);
  state.attempts.set(q.id, { selected: [...selected], ok });
  saveState();
  updateBadges();
  updateProgress();

  // Меняем верхние бейджи
  refreshTopBadges(q.id);

  // Действие = далее (с цветом)
  setActionButton(ok ? "next" : "next-fail");

  // Авто-переход
  if (prefs.autoAdvance && ok) {
    setTimeout(() => next(), 800);
  }
}

function revealAnswer() {
  if (answered) return;
  answered = true;
  const q = view[idx];
  const correctSet = new Set(q.correct);
  document.querySelectorAll(".option").forEach(el => {
    el.classList.add("disabled");
    const i = parseInt(el.dataset.i, 10);
    if (correctSet.has(i)) el.classList.add("reveal-correct");
  });
  document.getElementById("feedback").innerHTML =
    `<div class="feedback fail">💡 Правильный ответ подсвечен зелёным. Эта попытка не зачитывается.</div>`;
  setActionButton("next-fail");
  state.attempts.set(q.id, { selected: [], ok: false });
  saveState();
}

function refreshTopBadges(id) {
  const head = document.querySelector(".q-head .meta");
  if (!head) return;
  const stat = getStat(id);
  // Обновлять не критично, но красиво — оставим как есть до следующего рендера.
}

function toggleBookmark() {
  if (!view[idx]) return;
  const q = view[idx];
  if (state.bookmarks.has(q.id)) state.bookmarks.delete(q.id);
  else state.bookmarks.add(q.id);
  saveState();
  const b = document.getElementById("bookmarkBtn");
  if (b) {
    const on = state.bookmarks.has(q.id);
    b.classList.toggle("on", on);
    b.textContent = on ? "★" : "☆";
  }
  updateBadges();
}

function updateBadges() {
  document.getElementById("mistakesCount").textContent = ALL.filter(q => isMistake(q.id)).length;
  document.getElementById("hardCount").textContent = ALL.filter(q => isHard(q.id)).length;
  document.getElementById("bookmarksCount").textContent = state.bookmarks.size;
  document.getElementById("passedCount").textContent = state.attempts.size;
}

function updateProgress() {
  const masteredCount = ALL.filter(q => isMastered(q.id)).length;
  const total = ALL.length;
  const pct = total ? (masteredCount / total) * 100 : 0;
  document.getElementById("progressFill").style.width = pct + "%";

  const pt = document.getElementById("progressText");
  if (mode === "exam" && examState) {
    pt.textContent = `${examState.current + 1}/${examState.questions.length} · экзамен`;
  } else if (view.length) {
    pt.textContent = `${idx + 1}/${view.length} · ✓${masteredCount}`;
  } else {
    pt.textContent = `✓${masteredCount}/${total}`;
  }
}

// === Навигация ===
function next() {
  if (!view.length) return;
  idx = (idx + 1) % view.length;
  render();
}
function prev() {
  if (!view.length) return;
  idx = (idx - 1 + view.length) % view.length;
  render();
}

// === Экзамен ===
const EXAM_SIZE = 30;
function startExam() {
  // Берём EXAM_SIZE случайных вопросов, по возможности с упором на не освоенные.
  // Если задан диапазон — экзамен только по нему.
  const inRange = applyRange(ALL);
  const notMastered = inRange.filter(q => !isMastered(q.id));
  const base = notMastered.length >= EXAM_SIZE ? notMastered : inRange;
  const pool = base.length ? base : ALL;
  const questions = shuffle(pool).slice(0, EXAM_SIZE);
  examState = { questions, current: 0, correctCount: 0, answered: false };
  renderExam();
}

function renderExam() {
  document.getElementById("examResult").hidden = true;
  const card = document.getElementById("card");
  card.style.display = "";
  document.querySelector(".bottom-nav").style.display = "";

  if (!examState || examState.current >= examState.questions.length) {
    finishExam();
    return;
  }

  const q = examState.questions[examState.current];
  const optsIdx = q.options.map((_, i) => i);
  orderMap = shuffle(optsIdx);
  selected.clear();
  answered = false;

  card.classList.remove("animate-in");
  card.innerHTML = `
    <div class="q-head">
      <div class="meta">
        <span class="badge-id">Экзамен · ${examState.current + 1} / ${examState.questions.length}</span>
        <span class="q-type-badge ${q.type}">${q.type === "multi" ? "Несколько ответов" : "Один ответ"}</span>
        <span class="q-type-badge">✓ ${examState.correctCount}</span>
      </div>
    </div>
    <div class="q-text">${escapeHtml(q.question)}</div>
    <div class="options">
      ${orderMap.map((origI, dispI) => `
        <div class="option" data-i="${origI}">
          <div class="num">${dispI + 1}</div>
          <div class="txt">${escapeHtml(q.options[origI])}</div>
        </div>`).join("")}
    </div>
    <div id="feedback"></div>
  `;
  card.classList.add("animate-in");

  card.querySelectorAll(".option").forEach(el => {
    el.addEventListener("click", () => examOptionClick(el));
  });

  setActionButton(q.type === "multi" ? "check" : "skip");
  updateProgress();
}

function examOptionClick(el) {
  if (examState.answered) return;
  const q = examState.questions[examState.current];
  const i = parseInt(el.dataset.i, 10);

  if (q.type === "multi") {
    if (selected.has(i)) { selected.delete(i); el.classList.remove("selected"); }
    else { selected.add(i); el.classList.add("selected"); }
  } else {
    document.querySelectorAll(".option.selected").forEach(o => o.classList.remove("selected"));
    selected.clear();
    selected.add(i);
    el.classList.add("selected");
    setTimeout(() => examCheck(), 80);
  }
}

function examCheck() {
  if (examState.answered) return;
  if (!selected.size) return;
  const q = examState.questions[examState.current];
  examState.answered = true;

  const correctSet = new Set(q.correct);
  const ok = correctSet.size === selected.size && [...correctSet].every(x => selected.has(x));
  if (ok) examState.correctCount++;

  document.querySelectorAll(".option").forEach(el => {
    el.classList.add("disabled");
    const i = parseInt(el.dataset.i, 10);
    const isC = correctSet.has(i);
    const isS = selected.has(i);
    el.classList.remove("selected");
    if (isS && isC) el.classList.add("correct");
    else if (isS && !isC) el.classList.add("wrong");
    else if (!isS && isC) el.classList.add("reveal-correct");
  });

  // обновим общую стату пользователя
  const cur = getStat(q.id);
  if (ok) { cur.ok++; cur.streak++; } else { cur.fail++; cur.streak = 0; }
  state.stats.set(q.id, cur);
  saveState();

  document.getElementById("feedback").innerHTML = ok
    ? `<div class="feedback ok">✓ Верно</div>`
    : `<div class="feedback fail">✗ Неверно</div>`;

  setActionButton(ok ? "next" : "next-fail");
}

function examNext() {
  examState.current++;
  examState.answered = false;
  renderExam();
}

function finishExam() {
  const total = examState.questions.length;
  const ok = examState.correctCount;
  const pct = Math.round((ok / total) * 100);
  document.getElementById("examCorrect").textContent = ok;
  document.getElementById("examTotal").textContent = total;
  document.getElementById("examPercent").textContent = pct + "%";
  const v = document.getElementById("examVerdict");
  if (pct >= 90) { v.textContent = "🏆 Отлично!"; v.className = "exam-verdict ok"; }
  else if (pct >= 70) { v.textContent = "👍 Хорошо"; v.className = "exam-verdict ok"; }
  else if (pct >= 50) { v.textContent = "📚 Надо повторить"; v.className = "exam-verdict"; }
  else { v.textContent = "💀 Завал, учим ещё"; v.className = "exam-verdict fail"; }

  document.getElementById("card").style.display = "none";
  document.querySelector(".bottom-nav").style.display = "none";
  document.getElementById("examResult").hidden = false;
  updateBadges();
  updateProgress();
}

// === Темы ===
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  document.getElementById("themeBtn").textContent = t === "light" ? "☀️" : "🌙";
  prefs.theme = t;
  savePrefs();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#f6f8fa" : "#0f1419");
}

// === Загрузка ===
fetch("data/questions.json")
  .then(r => r.json())
  .then(data => {
    ALL = data;

    // применим сохранённые prefs к UI
    document.getElementById("shuffleQ").checked = !!prefs.shuffleQ;
    document.getElementById("shuffleA").checked = prefs.shuffleA !== false;
    document.getElementById("autoAdvance").checked = !!prefs.autoAdvance;
    document.getElementById("rangeFrom").value = Number.isFinite(prefs.rangeFrom) ? prefs.rangeFrom : "";
    document.getElementById("rangeTo").value   = Number.isFinite(prefs.rangeTo)   ? prefs.rangeTo   : "";

    // тема: сохранённая или системная
    const sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefs.theme || (sysDark ? "dark" : "light"));

    rebuildView();
  })
  .catch(e => {
    document.getElementById("card").innerHTML = `<div class="empty"><div class='big-emoji'>⚠️</div>Ошибка загрузки: ${e}</div>`;
  });

// === Привязка UI ===

// Sidebar
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("overlay").classList.add("show");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
}
document.getElementById("menuBtn").addEventListener("click", openSidebar);
document.getElementById("closeMenuBtn").addEventListener("click", closeSidebar);
document.getElementById("overlay").addEventListener("click", closeSidebar);

// Mode buttons
document.querySelectorAll(".mode-btn").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    mode = b.dataset.mode;
    idx = 0;
    closeSidebar();
    if (mode === "exam") {
      startExam();
    } else {
      rebuildView();
    }
  });
});

// Range filter
function onRangeChange() {
  const fEl = document.getElementById("rangeFrom");
  const tEl = document.getElementById("rangeTo");
  let f = parseInt(fEl.value, 10);
  let t = parseInt(tEl.value, 10);
  if (Number.isFinite(f) && Number.isFinite(t) && f > t) {
    // swap, чтобы поле «от» не было больше «до»
    [f, t] = [t, f];
    fEl.value = f; tEl.value = t;
  }
  prefs.rangeFrom = Number.isFinite(f) ? f : null;
  prefs.rangeTo   = Number.isFinite(t) ? t : null;
  savePrefs();
  idx = 0;
  rebuildView();
}
document.getElementById("rangeFrom").addEventListener("change", onRangeChange);
document.getElementById("rangeTo").addEventListener("change", onRangeChange);
document.getElementById("rangeClear").addEventListener("click", () => {
  document.getElementById("rangeFrom").value = "";
  document.getElementById("rangeTo").value = "";
  prefs.rangeFrom = null;
  prefs.rangeTo = null;
  savePrefs();
  idx = 0;
  rebuildView();
});

// Settings
document.getElementById("shuffleQ").addEventListener("change", e => {
  prefs.shuffleQ = e.target.checked; savePrefs(); rebuildView();
});
document.getElementById("shuffleA").addEventListener("change", e => {
  prefs.shuffleA = e.target.checked; savePrefs(); render();
});
document.getElementById("autoAdvance").addEventListener("change", e => {
  prefs.autoAdvance = e.target.checked; savePrefs();
});

// Theme
document.getElementById("themeBtn").addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
});

// Export / Import / Reset
document.getElementById("exportBtn").addEventListener("click", () => {
  const statsObj = {};
  state.stats.forEach((v, k) => { statsObj[k] = v; });
  const attemptsObj = {};
  state.attempts.forEach((v, k) => { attemptsObj[k] = v; });
  const data = { bookmarks: [...state.bookmarks], stats: statsObj, attempts: attemptsObj, exported: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `farm-progress-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importFile").click();
});
document.getElementById("importFile").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.bookmarks) state.bookmarks = new Set(d.bookmarks);
      if (d.stats) {
        state.stats.clear();
        Object.entries(d.stats).forEach(([k,v]) => state.stats.set(parseInt(k,10), v));
      }
      if (d.attempts) {
        state.attempts.clear();
        Object.entries(d.attempts).forEach(([k,v]) => state.attempts.set(parseInt(k,10), v));
      }
      saveState();
      updateBadges();
      render();
      alert("Прогресс импортирован ✓");
    } catch (err) { alert("Ошибка чтения файла: " + err); }
  };
  r.readAsText(f);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("Сбросить весь прогресс (статистику и закладки)?")) return;
  state.bookmarks.clear();
  state.stats.clear();
  state.attempts.clear();
  saveState();
  updateBadges();
  rebuildView();
});

// Search & jump
document.getElementById("search").addEventListener("input", debounce(rebuildView, 200));
document.getElementById("jump").addEventListener("change", e => {
  const n = parseInt(e.target.value, 10);
  if (!n) return;
  // переключаемся в режим "учить" и ищем
  if (mode !== "learn" && mode !== "test") {
    mode = "learn";
    document.querySelectorAll(".mode-btn").forEach(x => x.classList.remove("active"));
    document.querySelector('.mode-btn[data-mode="learn"]').classList.add("active");
    rebuildView();
  }
  const i = view.findIndex(q => q.id === n);
  if (i >= 0) { idx = i; render(); }
  e.target.value = "";
});

// Bottom nav — единственная action-кнопка; навигация назад/вперёд по свайпам и ←/→
document.getElementById("actionBtn").addEventListener("click", () => {
  if (mode === "exam") {
    const a = document.getElementById("actionBtn").dataset.action;
    if (a === "check") {
      if (!selected.size) examNext();
      else examCheck();
    } else { examNext(); }
    return;
  }
  onActionClick();
});

// Exam result buttons
document.getElementById("examRestart").addEventListener("click", startExam);
document.getElementById("examExit").addEventListener("click", () => {
  mode = "learn";
  document.querySelectorAll(".mode-btn").forEach(x => x.classList.remove("active"));
  document.querySelector('.mode-btn[data-mode="learn"]').classList.add("active");
  document.getElementById("examResult").hidden = true;
  rebuildView();
});

// Клавиатура
document.addEventListener("keydown", e => {
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key === "ArrowRight") {
    if (mode === "exam" && examState && examState.answered) examNext();
    else next();
  }
  else if (e.key === "ArrowLeft") {
    if (mode !== "exam") prev();
  }
  else if (e.key === "Enter") {
    document.getElementById("actionBtn").click();
  }
  else if (e.key === "b" || e.key === "B" || e.key === "и" || e.key === "И") {
    if (mode !== "exam") toggleBookmark();
  }
  else if (/^[1-9]$/.test(e.key)) {
    const n = parseInt(e.key, 10);
    const els = document.querySelectorAll(".option");
    if (els[n-1]) els[n-1].click();
  }
});

// Свайпы для мобильной навигации
let touchStartX = null, touchStartY = null, touchStartT = 0;
const cardEl = document.getElementById("card");
cardEl.addEventListener("touchstart", e => {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartT = Date.now();
}, { passive: true });
cardEl.addEventListener("touchend", e => {
  if (touchStartX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const dt = Date.now() - touchStartT;
  touchStartX = null;
  if (dt > 500) return;
  if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
  if (mode === "exam") {
    if (dx < 0 && examState && examState.answered) examNext();
    return;
  }
  if (dx < 0) next(); else prev();
}, { passive: true });

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// === Service Worker (PWA) ===
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
