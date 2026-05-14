# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, vanilla-JS PWA ("Фарм-тренажёр") for drilling ~1990 pharmacology multiple-choice questions in Russian. Mobile-first, installable, works offline. No build step, no bundler, no test suite, no linter, no package manager. The UI strings and content are Russian — keep new user-facing text Russian to match.

## Running

```bash
# Docker (nginx on :8080)
docker compose up -d --build
docker compose down

# Without Docker (Service Worker requires http://, not file://)
python3 -m http.server 8080
```

## Re-parsing source questions

`parse_questions.py` regenerates `questions.json` from the original MyTestXPro `.docx`. It has **hardcoded absolute paths** (`SRC = /mnt/user-data/uploads/...`, `OUT = /home/claude/...`) that reflect the environment where it was first run — edit them before running locally. Requires `pip install python-docx`.

Two manual data fixes are documented in `README.md` (§ "Известное") and live only in `questions.json`, not the parser: question №471 (correct answer reset to first), question №744 (only 3 options in source). Re-parsing will clobber these — re-apply by hand.

## Architecture

Three layers, all static:

- **`index.html`** — single page with topbar, sidebar (mode picker + settings + import/export), search/jump row, question card, exam result panel, bottom nav. All DOM elements are referenced by ID from `app.js`; renaming an ID will silently break behavior.
- **`app.js`** — entire app logic in one file, no modules. Top-level globals (`ALL`, `view`, `idx`, `mode`, `state`, `prefs`, `examState`) drive everything. On load, `fetch("data/questions.json")` populates `ALL`, then `rebuildView()` applies the current mode filter + optional shuffle into `view`, then `render()` draws the card. The exam mode is a parallel render path (`renderExam`/`examCheck`/`examNext`/`finishExam`) that does **not** go through `rebuildView` and writes to the same `card` element.
- **`sw.js`** — precaches a fixed asset list under cache name `farm-v2`, then stale-while-revalidate on GET. **Bump the `CACHE` constant** when you ship changes to `app.js` / `styles.css` / `index.html`, or returning users will keep seeing the old version.

### Question schema (`data/questions.json`)

```js
{ id: number, question: string, type: "single" | "multi",
  options: string[], correct: number[] /* indices into options */ }
```

`type` is derived: `parse_questions.py` upgrades any question with >1 correct index to `"multi"`.

### Persistence

Two localStorage keys, both versioned in the key name — changing the schema means bumping the suffix and handling migration (or accepting wiped state):

- `farm_state_v2` — `{ bookmarks: number[], stats: { [id]: {ok, fail, streak} } }`. `streak` ≥ 3 → "освоен" (mastered), `fail` ≥ 2 → "сложный" (hard), `fail > 0 && streak === 0` → "ошибка" (mistake). These predicates (`isMastered`/`isHard`/`isMistake` in `app.js`) define the filter logic for the three corresponding modes.
- `farm_prefs_v1` — `{ shuffleQ, shuffleA, autoAdvance, theme }`.

### Modes

Mode is a single string (`learn` | `test` | `mistakes` | `hard` | `bookmarks` | `exam`) selected via `.mode-btn[data-mode]` in the sidebar. `learn` vs `test` only differs at the action-button level (`setActionButton`): `test` shows "Показать ответ" / "Проверить" first; `learn` defaults to "Пропустить →". `exam` short-circuits `rebuildView` entirely.

### Duplicate `questions.json`

`questions.json` exists both at repo root and at `data/questions.json` (identical contents). The app and `sw.js` only ever load `data/questions.json`; the Dockerfile only copies `data/`. The root copy is unused — keep the `data/` one authoritative if you regenerate.
