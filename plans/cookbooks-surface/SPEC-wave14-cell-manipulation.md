# SPEC: волна 14 — «Cell Manipulation & Focus» (drag&drop, мультивыделение, undo/redo, fold, экспорт .py)

База: origin/main `a6aa6fe48` (2026-10-15). Ветка волны: `feat/cookbooks-w14` (воркдерево `~/Projects/rox-worktrees/cookbooks-w14`).
Точка отката: main до слияния PR волны (`git revert -m 1 <merge>`); точки отката волн 6–13 сохраняются.
Норматив: [PRD](PRD.md) · [SPEC](SPEC.md) · [SPEC-wave13](SPEC-wave13-colab-convenience.md) · [ADR 001](decisions/001-runtime-container-and-secrets.md).
Вендор-снапшот `apps/electron/resources/cookbooks/**` — **read-only**; лаборатория и вендор в этой волне не меняются.

**Статус:** ✅ влито в main — PR #2165 (merge `f56d3e747`; фича — `cd7f26803`, re-record — `d2519b5ac`). Фриз скоупа был 2026-10-15; слайсы A (рендер, батч 1) · B (модуль истории) · C (i18n) · D (shared+main) · E (рендер, батч 2) · F (fix-up: takeover Shift+Tab).

## Цель

Довести интерактивность и информативность поверхности кукбуков до Colab-паритета по **манипуляциям** и **фокусу**: перетаскивание ячеек мышью, мультивыделение и ячеечный буфер (copy/cut/paste), отмена/повтор структурных операций, сворачивание ячейки («скрыть код»), экспорт `.py`, `Alt+Enter` и Tab-индент, прогресс batch-прогона, нумерация оглавления, рендер `text/latex` в сохранённых выводах.

Уже есть (не трогаем, переиспользуем): командный режим (j/k/Enter/a/b/dd/y/m/Ctrl+M), find&replace, автосейв, статус-бар, длительности, outline+scroll-spy, структурные ops (up/down/add/delete/duplicate/convert), run/stop/run-all/«Перезапустить и выполнить», rich-output (W11), экспорт `.ipynb`.

## Решения (фриз)

1. **Ноль новых IPC-каналов и ноль правок сайдкара/вендора.** Всё через существующие ops `CookbooksCellMutation` (`shared/cookbooks.ts:104-110`: add/delete/move/duplicate/convert) и существующие каналы `save`/`export`/`run-all`. Инвентарь `cookbooks-lab:*` (13 каналов) не меняется.
2. **Ноль новых зависимостей.** DnD — нативные HTML5-события; индент — пробелы; KaTeX — только через продуктовый `<Markdown>` (`$$`-обёртка), без прямого импорта katex.
3. **Мультивыделение.** Состояние: `selectedCell: number | null` (фокус/primary — существующее) + новое `selectionAnchor: number | null` (якорь диапазона). Выделенные = диапазон `min..max(anchor, focus)` при заданном anchor, иначе одиночный фокус. Жесты: клик по телу — одиночный (anchor=null); Shift+клик — задать/расширить диапазон (anchor = текущий фокус, если не задан); Shift+↑/↓ — расширить фокус, якорь сохраняется; j/k/↑/↓ и одиночные действия — сброс anchor. Визуал: у всех выделенных `data-selected="true"`, у фокуса `data-anchor="true"`; `aria-current` — на фокусе. Сброс выделения — Esc (низший приоритет в существующей цепочке Esc).
4. **Ячеечный буфер — внутренний (renderer state), не системный clipboard.** `CellBuffer = { cellType, source }[] | null`. Команды в командном режиме и в меню: copy (Ctrl+C), cut (Ctrl+X), paste (Ctrl+V / пункт меню). В режиме правки (textarea/activeElement — поле) Ctrl+C/X/V остаются нативными (не перехватываются). Paste вставляет после фокуса (в конец, если фокус последний/выделения нет) в порядке буфера последовательными `add`-ops; после вставки выделён вставленный диапазон. Copy/cut пустого выделения — no-op; paste при пустом буфере — notice `cookbooks.buffer.empty`.
5. **Undo/redo — только структурные операции.** Стек: глубина 50; запись = один жест (multi-delete/cut/paste = одна запись); очистка при смене документа (`copyId`/`applyDocument`) и при ошибке применения op. Контентные правки — нативный undo textarea (не трогаем). Гейт: при `busy` undo/redo недоступны (кнопки disabled, хоткеи no-op). Записи создают: add/delete/move/duplicate/convert/cut/paste. Ячейками управляет чистая логика модуля `cell-history.ts` (слайс B), применение ops — страница (слайс E).
6. **DnD.** Ручка `cookbooks-drag-handle-{i}` в гуттере (существующий левый гуттер ячейки). HTML5: `draggable` на ручке, `dragstart` кладёт индекс в `dataTransfer`; зоны сброса — существующие `InsertRow`-щели (перед каждой ячейкой + хвостовая) + сами article (по средней линии: above/below). Индикатор — линия над/под целью, атрибут `data-drop-position="above|below"` на article-цели. Drop → `mutate({op:'move', from, to})` (математика щель→индекс: `to = gap > from ? gap - 1 : gap`; `to === from` → no-op). При `busy` ручка неактивна (`aria-disabled`, курсор, no dragstart). Escape во время drag — отмена (dragend без drop). Клавиатурная альтернатива Alt+↑/↓ сохраняется.
7. **Fold ячейки.** Сессионное состояние `collapsedCells: Set<number>` (в `.ipynb` НЕ персистится — зафиксировать как ограничение в release-notes). Свёрнутая ячейка: скрыт редактор/рендер (вместо — одна строка-заглушка `cookbooks.cell.folded`), гуттер, ряд контролов, вывод и вывод-экшены остаются. Тумблер `cookbooks-fold-{i}` в ряду контролов, `aria-pressed`; article получает `data-collapsed="true"`. Сброс при смене документа.
8. **Экспорт.** Кнопка `cookbooks-export` становится триггером меню «Скачать» (testid сохраняется): пункты `cookbooks-export-ipynb` (текущее поведение) и `cookbooks-export-py`. Формат `.py`: построитель `buildPythonScript(...)` в `shared/cookbooks.ts` (слайс D), имя файла — как у `.ipynb`, с заменой расширения. Main: фильтр save-диалога выводится из расширения имени (ipynb → «Jupyter Notebook», py → «Python Script», иначе «All Files» `['*']`); сигнатура `exportNotebook` не меняется.
9. **Alt+Enter** = выполнить фокус-ячейку и вставить ниже новую code-ячейку (пустую) — Colab-паритет. **Tab/Shift+Tab** в textarea code-ячейки: при выделении — индент/деиндент каждой затронутой строки на 2 пробела; без выделения — вставка 2 пробелов в каретку (Tab) / удаление до 2 ведущих пробелов (Shift+Tab). `preventDefault` только когда фокус в textarea кода (md-редактор не трогаем).
10. **Прогресс batch.** Во время run-all в шапке (рядом с run-all) — `cookbooks-run-progress` «N/M» по активному batch (подмножества «выше/ниже» учитываются); по завершении скрывается, итог — существующий notice. Не показывается при одиночном run.
11. **`text/latex` в выводах** рендерится через продуктовый `<Markdown>` (`$$\n<data>\n$$`); эмиттер/сайдкар не трогаем — рендерится то, что уже приходит персистом из `.ipynb`. Пустой data — пропуск записи. Обновить комментарий-обоснование `RENDERABLE_MIMES` (P:316-324) — latex перестаёт быть «carried but not rendered».
12. **Оглавление:** нумерация `1`, `1.1`, `1.1.1` (счётчики по уровням с сбросом вложенных) + отступ по уровню. Логика — чистая функция `numberHeadings(headings)` в существующем `scroll-spy.ts`; рендер — в существующем outline-списке. Поведение scroll-spy/aria не меняется.

## F-спеки (что проверяемо)

| # | Фича | Слайс | Acceptance (наблюдаемое) |
|---|---|---|---|
| F1 | DnD-перестановка | A | drag ручки 0 на щель после 2 → ровно один `mutate{op:'move',from:0,to:1}`; линия-индикатор; busy → dragstart не начинается |
| F2 | Мультивыделение + буфер | A | Shift+клик 0..2 → `data-selected` на 0,1,2; Ctrl+C → notice «скопировано: 3»; вставка после 3 → три `add`-ops; cut → delete-ops (одна история); dd удаляет все выделенные |
| F3 | Alt+Enter | A | run фокус-ячейки + `add` code-ячейки сразу ниже, фокус на новой |
| F4 | Прогресс run-all | A | во время batch `cookbooks-run-progress` = «N/M», монотонно; после — скрыт |
| F5 | cell-history модуль | B | чистые функции: push/undo/redo/bound/clear/invertOps; тесты |
| F6 | Undo/redo UI | E | Ctrl+Z после move возвращает порядок (один inverse-mutate); кнопки disabled при busy; смена документа чистит стек |
| F7 | Fold | E | тумблер скрывает редактор, вывод виден; `data-collapsed`; повторный клик разворачивает |
| F8 | Экспорт .py | D+E | меню «Скачать» → «Скрипт (.py)»: контент = code-ячейки + md-комментарии + `# %%`-маркеры; save-диалог с фильтром `py` |
| F9 | Tab-индент | E | Tab в code-textarea вставляет 2 пробела; с выделением — индент строк; Shift+Tab — деиндент |
| F10 | text/latex вывод | E | сохранённый latex-вывод рендерится (`.katex` в `cookbooks-output-{i}`) |
| F11 | Нумерация оглавления | E | записи «1. Заголовок», «1.1 Подзаголовок» с отступом |

## i18n (новые ключи; ru/en заморожены, остальные 10 — перевод в стиле файла; существующие `cookbooks.*` переиспользовать, не дублировать)

| Ключ | ru | en |
|---|---|---|
| cookbooks.cell.dragHandle | Перетащить ячейку | Drag cell |
| cookbooks.cell.fold | Свернуть код | Hide code |
| cookbooks.cell.unfold | Показать код | Show code |
| cookbooks.cell.folded | Код скрыт | Code hidden |
| cookbooks.cellmenu.copy | Копировать ячейку | Copy cell |
| cookbooks.cellmenu.cut | Вырезать ячейку | Cut cell |
| cookbooks.cellmenu.paste | Вставить после | Paste after |
| cookbooks.buffer.copied | Ячеек скопировано: {{count}} | Copied cells: {{count}} |
| cookbooks.buffer.cut | Ячеек вырезано: {{count}} | Cut cells: {{count}} |
| cookbooks.buffer.pasted | Ячеек вставлено: {{count}} | Pasted cells: {{count}} |
| cookbooks.buffer.empty | Буфер ячеек пуст | Cell buffer is empty |
| cookbooks.undo | Отменить | Undo |
| cookbooks.redo | Вернуть | Redo |
| cookbooks.undo.done | Отменено: {{action}} | Undone: {{action}} |
| cookbooks.redo.done | Возвращено: {{action}} | Redone: {{action}} |
| cookbooks.op.add | вставка ячейки | cell insert |
| cookbooks.op.delete | удаление | delete |
| cookbooks.op.move | перемещение | move |
| cookbooks.op.duplicate | дублирование | duplicate |
| cookbooks.op.convert | смена типа | type change |
| cookbooks.op.paste | вставка из буфера | paste |
| cookbooks.export.menu | Скачать | Download |
| cookbooks.export.ipynb | Ноутбук (.ipynb) | Notebook (.ipynb) |
| cookbooks.export.py | Скрипт Python (.py) | Python script (.py) |
| cookbooks.run.progress | Выполнено {{done}} из {{total}} | {{done}} of {{total}} done |
| cookbooks.run.progressAria | Прогресс выполнения | Run progress |
| cookbooks.shortcuts.altEnter | Alt+Enter — выполнить и вставить код ниже | Alt+Enter — run and insert below |
| cookbooks.shortcuts.multi | Shift+клик или Shift+↑↓ — выделить диапазон ячеек | Shift+click or Shift+↑↓ — extend cell selection |
| cookbooks.shortcuts.cellBuffer | Ctrl+C / Ctrl+X / Ctrl+V — копировать, вырезать, вставить ячейки | Ctrl+C / Ctrl+X / Ctrl+V — copy, cut, paste cells |
| cookbooks.shortcuts.undo | Ctrl+Z / Ctrl+Shift+Z — отменить или вернуть операцию | Ctrl+Z / Ctrl+Shift+Z — undo or redo |
| cookbooks.shortcuts.tab | Tab / Shift+Tab — отступ в коде | Tab / Shift+Tab — indent code |
| cookbooks.shortcuts.drag | Перетащите ячейку за ручку — изменить порядок | Drag the cell handle to reorder |

## Testid-контракт (новые)

`cookbooks-drag-handle-{i}`, `cookbooks-fold-{i}`, `cookbooks-cellmenu-copy-{i}`, `cookbooks-cellmenu-cut-{i}`, `cookbooks-cellmenu-paste-{i}`, `cookbooks-undo`, `cookbooks-redo`, `cookbooks-export-py` (+ существующий триггер `cookbooks-export`; существующий сценарий клика по нему в тестах обновить на «открыть меню → ipynb»), `cookbooks-run-progress`.
Атрибуты: `data-selected` (расширение на все выделенные), `data-anchor` (фокус), `data-collapsed`, `data-drop-position`.

## Слайсы и владение

| Слайс | Владеет | Файлы | Зависит |
|---|---|---|---|
| A (рендер, батч 1) | F1+F2+F3+F4; новый модуль `cell-selection.ts` | `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx`; новые: `.../cookbooks/cell-selection.ts`, `.../cookbooks/__tests__/cell-selection.test.ts`; `.../cookbooks/__tests__/CookbooksSurfacePage.test.tsx` (дописывает кейсы) | фриз этого SPEC |
| B (модуль) | F5 (`cell-history.ts`) | новые: `apps/electron/src/renderer/pages/cookbooks/cell-history.ts`, `.../cookbooks/__tests__/cell-history.test.ts` | фриз интерфейса из этого SPEC |
| C (i18n) | ключи W14 | `packages/shared/src/i18n/locales/*.json` (12) | таблица i18n из этого SPEC |
| D (shared+main) | F8 (построитель + фильтр) | `apps/electron/src/shared/cookbooks.ts`; `apps/electron/src/main/cookbooks-runtime.ts` (только `exportNotebook`); тесты: `apps/electron/src/shared/__tests__/cookbooks-export.test.ts`, `apps/electron/src/main/__tests__/cookbooks-runtime.test.ts` (дописывают кейсы) | — |
| E (рендер, батч 2) | F6+F7+F8-ui+F9+F10+F11 | тот же файл страницы; `.../cookbooks/scroll-spy.ts` (+`numberHeadings`); page-тесты (дописывает кейсы) | A (один писатель страницы), B (модуль), D (построитель) |

**Интерфейс `cell-history.ts` (фриз для B/E):**
```ts
export type HistoryOp =
  | { kind: 'add'; index: number; cellType: 'code' | 'markdown'; source: string }
  | { kind: 'delete'; index: number; cellType: 'code' | 'markdown'; source: string }
  | { kind: 'move'; from: number; to: number }
  | { kind: 'duplicate'; index: number }
  | { kind: 'convert'; index: number; fromType: 'code' | 'markdown'; toType: 'code' | 'markdown' }
export interface HistoryEntry { labelKey: string; undo: HistoryOp[]; redo: HistoryOp[] }
export interface History { past: HistoryEntry[]; future: HistoryEntry[] }
export const HISTORY_LIMIT = 50
export function createHistory(limit?: number): History
export function pushEntry(h: History, e: HistoryEntry): History          // чистит future, капает limit
export function undoStep(h: History): { history: History; entry: HistoryEntry } | null
export function redoStep(h: History): { history: History; entry: HistoryEntry } | null
export function canUndo(h: History): boolean
export function canRedo(h: History): boolean
export function invertOp(op: HistoryOp): HistoryOp                       // add<->delete, move(from,to)->move(to,from), convert(a,b)->convert(b,a); duplicate -> null
```
Порядок применения multi-op: page применяет `undo[]` последовательно; для delete-групп — по убыванию индекса (гарантируется построением записи на странице).

**Интерфейс `cell-selection.ts` (фриз для A):**
```ts
export interface CellSelection { focus: number; anchor: number | null }
export function normalizeSelection(sel: CellSelection | null, count: number): CellSelection | null
export function selectedIndices(sel: CellSelection | null, count: number): number[]
export function extendSelection(sel: CellSelection, focus: number): CellSelection   // задаёт/двигает focus, сохраняет/инициализирует anchor
export function collapseSelection(sel: CellSelection | null): CellSelection | null  // anchor -> null (одиночный фокус)
export function clampIndex(i: number, count: number): number
```

**Правила волны:** исполнители только правят свои файлы; гейты/тесты/форматтеры НЕ запускают (их гоняет оркестратор по объединению); коммиты — только оркестратор; `bun` — `/opt/homebrew/bin/bun`; файлы соседей не трогать; существующие тесты не удалять (только дописывать/обновлять по контракту выше).

## Тесты (что обязаны появиться)

- `cell-selection.test.ts`: диапазон/одиночный, extend (anchor init/idempotent), clamp за границы, normalize (null/пустой документ), selectedIndices порядок.
- `cell-history.test.ts`: push/canUndo/canRedo, future чистится при push, лимит 50 (старейшие отбрасываются), undoStep/redoStep (порядок стеков, null на пустых), invertOp (все kind + duplicate → null), createHistory.
- `CookbooksSurfacePage.test.tsx` (+A): dragstart/dragover/drop → мутация move (индексы from/to корректны при drop выше/ниже), busy-гейт DnD; Shift+клик диапазон + Ctrl+клик toggle + Esc-сброс; Ctrl+C/Ctrl+V (многоячеечная вставка, фокус на вставленном), cut = delete, dd-мультиудаление; Alt+Enter (run + add ниже); прогресс «N/M» в run-all (мок-сайдкар) и скрытие после.
- `CookbooksSurfacePage.test.tsx` (+E): undo/redo кнопками и Ctrl+Z/Ctrl+Shift+Z (move/add/delete/convert; busy disabled; очистка при смене документа; toast с labelKey), fold (data-collapsed, скрытие редактора, сохранение вывода), меню экспорта (.py контент+имя; ipynb-пункт на месте), Tab/Shift+Tab индент, `text/latex` рендер (.katex), нумерация outline.
- `scroll-spy.test.ts` (+): `numberHeadings` (нумерация уровней, сброс вложенных, h1/h2/h3, без заголовков).
- `cookbooks-export.test.ts` (+D): buildPythonScript (code+md-комментарии, `# %%`, финальный \n, пустые ячейки, title в шапке).
- `cookbooks-runtime.test.ts` (+D): exportNotebook — фильтр по расширению (ipynb/py/неизвестное), defaultPath, canceled.

## Гейты волны (оркестратор)

1. `bun test` — фокусные наборы: страница кукбуков, cell-selection, cell-history, scroll-spy, export, runtime; соседние затронутые.
2. `cd apps/electron && bun run tsc --noEmit` + `bun run typecheck:all` (агрегат) → 0.
3. i18n: `bun run sort-locales` → `lint:i18n:parity && lint:i18n:sorted && lint:i18n:coverage && lint:i18n:budget`.
4. **Bundle-size**: `bun run electron:build:renderer` → `bun scripts/check-bundle-size.ts --check`; при перерасходе (ожидаем ~30 ключей × 12) — санкционированный re-record `--update` по канону CONTRIBUTING (+ тесты гейта).
5. Ratchets: `lint:ui-tokens`, ESLint — none new; `bun scripts/test-all.ts --ratchet` (knownRed не растёт).
6. Вендоренный probe (страховка, сайдкар не менялся): `python3 apps/electron/resources/cookbooks/scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed`.
7. Живой смоук (CDP): DnD (перетащить ячейку), мультивыделение + copy/paste, undo/redo, fold, Alt+Enter, Tab-индент, меню «Скачать» (.py-файл на диске), прогресс run-all, latex-вывод, нумерация оглавления; скриншоты `~/Pictures/Shots/Agents/cookbooks-wave14/`.
8. PR → CI (required 6/6) → merge; журнал `docs/plans/lane-process.md` §4 + PLAN.md.

## Вне скоупа (w15+)

Стриминг вывода (SSE), постоянное ядро/сессия, инспектор переменных, stdin/`input()`, виджеты и формы `#@param`, сниппеты, ресурс-метр RAM/CPU, командная палитра поверхностей, стабильные `id` ячеек в DTO, экспорт HTML/PDF, редактор с подсветкой (CodeMirror) — всё вне W14; drag-перетаскивание группы ячеек и «свернуть все» — вне W14 (только одиночный DnD и точечный fold); inline-`$…$`-математика — продуктовое решение `math-options.ts` (не трогаем).
