# SPEC: волна 13 — «Colab Convenience & Informativity» (командный режим, поиск/замена, автосохранение, статус-бар)

База: origin/main `435ca9f9f` (2026-10-15). Ветка волны: `feat/cookbooks-colab-ux2` (воркдерево `~/Projects/rox-worktrees/cookbooks-colab-ux2`).
Точка отката: main до слияния PR волны. Негоциируемые линии: точки отката волн 6–12 сохраняются.
Норматив: [PRD](PRD.md) · [SPEC](SPEC.md)(+Amd1) · [SPEC-wave7](SPEC-wave7-colab-ux.md) · [SPEC-wave9](SPEC-wave9-colab-controls.md) · [SPEC-wave10](SPEC-wave10-cell-structure.md) · [SPEC-wave11](SPEC-wave11-rich-output.md) · [ADR 001](decisions/001-runtime-container-and-secrets.md).
Вендор-снапшот лаборатории: `apps/electron/resources/cookbooks/` — **read-only**; правки идут только через канон-репо `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks` + sync-команду из `PROVENANCE.md`.

**Статус:** ⏳ W13 (этот файл — фриз скоупа 2026-10-15; батчи A/B/C/E — см. §Слайсы).

## Цель

Закрыть оставшиеся конвиниенс/информативные гэпы поверхности кукбуков против Google Colab. Уже сделано волнами 7/9/10/11 (md-рендер, [N], тайминги, Shift+Enter, стоп/Esc, оглавление, структура ячеек, rich-вывод). Остались: **командный режим** (перемещение и операции с ячейками без мыши), **поиск и замена по ячейкам** (Ctrl+F), **конвертация типа ячейки** (y/m — требует лаборатории), **md-микро** (двойной клик → правка; Shift+Enter → рендер), **автосохранение с индикатором + Ctrl+S**, **статус-бар** (последний прогон, размеры документа, состояние сохранения), **бейдж длительности прогона** у ячейки, **scroll-spy оглавления**, **«Перезапустить и выполнить»**.

## Решения (зафиксировано)

1. **Никаких новых IPC-каналов.** Конвертация — новый op `convert` в существующем union `CookbooksCellMutation` (канал `cookbooks-lab:mutate` уже есть). Инвентарь каналов не меняется.
2. **Никаких новых зависимостей.** Всё — на существующих примитивах (`ACTION_CLASS`, токены, `<textarea>`, `lucide-react`).
3. **Клавиши — только на контейнере документа** (`section[data-testid=cookbooks-document]` + собственная панель поиска) — кроме `Ctrl/Cmd+F`. Причина: реестр действий слушает `keydown` **в capture-фазе на window** (`actions/registry.tsx:134`, `addEventListener(..., true)`) и `app.search` (`mod+f`, без флага) перехватывает событие раньше React — локальный обработчик секции его физически не увидит. Поэтому единственный легальный путь — публичный API реестра: `useAction('app.search', openFind, { enabled, priority: 20 })` (домашний прецедент — `TasksPage.tsx:757-759`; в `shell-shortcuts.ts` тот же приём назван «mode-aware takeover», но `useModeAwareTakeover` завязан на флаг `docs.shared.v1` (default OFF) — не используем). Код `definitions.ts`/`registry.tsx` не изменяется. `enabled()` = фокус внутри поверхности кукбуков и открыт ipynb-документ; иначе падает в штатный `app.search`. Тесты страницы оборачивают рендер в `ActionRegistryProvider` (прецедент: `pages/__tests__/catalog-detail-routes.test.tsx:26`).
4. **Командный режим** — состояние `selectedCell: number | null`; выделенной ячейкой может быть любая (код и текст). Вход: клик по телу ячейки вне контролов; Esc из редактора; выход — Enter/двойной клик (правка). Визуал: `outline outline-2 outline-foreground` на выбранной ячейке + `aria-current="true"`.
5. **Find & replace — это панель над скролл-областью документа** (не портал/диалог), видна только для `kind==='ipynb'`; фокус остаётся в поле поиска, совпадение показывается selection'ом в textarea целевой ячейки (md-ячейка при прыжке переводится в режим правки). Замена меняет только `sources` (ручной/авто-сейв доставляет запись — как обычная правка).
6. **Автосохранение** базируется на «серверном отпечатке» в `doc.cells[i].source` (и `doc.text`): после успешного `api.save` обновляем `doc` точечно (`{...cell, source}`), поэтому «грязность» = `sources[i] !== doc.cells[i].source` остаётся единственной формулой. Дебаунс 1000 мс; последовательные одиночные save по возрастанию индекса; single-flight; во время busy автосейв не блокируется (save не берёт run-guard).
7. **Статус-бар** — футер поверхности (одна строка, `text-caption numeric`), виден при открытом документе: состояние сохранения · размеры документа · последний прогон. Скрыт для состояний `starting/failed/...`.
8. **Длительность ячейки** — сессионная карта `durations: Record<number, number>` (только одиночные прогоны; у run-all общая длительность — она и так в статусе). Показ — под счётчиком `[N]` в гуттере, `title` = `cookbooks.cell.lastDuration`.
9. **Scroll-spy** оглавления: чистая функция `pickActiveEntry(offsets, scrollTop)`; активная запись подсвечивается `aria-current` + `text-foreground font-medium`. Пересчёт — `onScroll` скролл-контейнера с rAF-троттлингом.
10. **«Перезапустить и выполнить»** = `clearAllOutputs()` + `setRuns({})` + `runAllCells()` одним кликом (Colab «Restart and run all»; постоянного ядра нет — «перезапуск» здесь честно означает «стереть результаты и выполнить заново»).
11. **LaTeX** — проверка, а не разработка: убедиться живым смоуком, что `$…$`/`$$…$$` в md-ячейках рендерятся (Markdown minimal, rehype-katex). Если нет — зафиксировать в отчёте как гэп (не чинить вслепую).
12. **Правило T9 из W10 (автофлеш правок перед мутацией)** сохраняется; конвертация проходит через тот же `mutateCell` (флаш → mutate → applyDocument → фокус).

## F1 — Командный режим и клавиши

Контекст срабатывания команд (в `handleDocumentKeyDown` + обработчик панели поиска): target — НЕ `textarea/input/select`, панель поиска закрыта, меню `⋯` закрыто. Буквенные клавиши — строго без модификаторов (`!ctrl && !meta && !alt && !shift`).

| Клавиша | Действие |
|---|---|
| `↑` / `k` | выбрать предыдущую ячейку (если выбор пуст — последнюю; клампить на 0) |
| `↓` / `j` | выбрать следующую ячейку (если выбор пуст — первую; клампить на len−1) |
| `Enter` | правка выбранной: фокус в textarea (md — включить режим правки через `pendingFocusRef`) |
| `Shift+Enter` | если выбранная — код: `runCell(index)` и перевести выбор на следующую code-ячейку (редактор НЕ фокусируем) |
| `Ctrl/Cmd+Enter` | если выбранная — код: `runCell(index)` (выбор не меняется) |
| `a` / `b` | вставить code-ячейку выше/ниже выбранной (`mutateCell` add; существующий фокус на новую ячейку сохраняется) |
| `dd` | удалить выбранную: два `d` подряд с окном 900 мс (ref-метка); удаление — существующим путём с `window.confirm` |
| `y` / `m` | конвертировать выбранную в `code`/`markdown` (`op:'convert'`); если тип уже такой — no-op |
| `Ctrl/Cmd+S` | сохранить все «грязные» ячейки (и плейбук) — см. F5 |
| `Ctrl/Cmd+F` | открыть/сфокусировать панель поиска |
| `Esc` | приоритет: панель поиска → закрыть; меню `⋯` → закрыть; busy → `cancelRun()`; фокус в редакторе → `blur` + выбрать эту ячейку; иначе no-op |

Гейты: навигация/выбор — без гейтов; `Enter`/операции — `ipynb`; мутирующие (`a/b/dd/y/m`) — `busy === null`; запуски (`Shift/Ctrl+Enter`) — как у существующих run-действий (`busy === null`, ячейка code).
Клик по телу `<article>` (target не внутри `button/textarea/input/a`) → `setSelectedCell(index)` + фокус на `<article tabIndex={-1}>` (класс `outline-none`). `section` получает `tabIndex={-1}` + `outline-none`.

## F2 — Find & replace (Ctrl+F)

Панель `data-testid="cookbooks-find"` — **нескроллящаяся строка над скролл-секцией**: секунда документа оборачивается в колонку `<div className="flex min-h-0 flex-1 flex-col">{findOpen && <FindBar/>}<section …/></div>` (сама `section` с `data-testid="cookbooks-document"`, ref и `onKeyDown` не меняется). Стиль: `flex flex-wrap items-center gap-1.5 border-b border-border-subtle bg-surface-hover px-3 py-1.5`.

Состав: `<input data-testid=cookbooks-find-input>` · счётчик `cookbooks-find-count` (`{{current}} из {{total}}`; при 0 — `cookbooks.find.noMatches`) · `cookbooks-find-prev` (▲) · `cookbooks-find-next` (▼) · `cookbooks-find-case` (`aria-pressed`, текст `Aa`) · `flex-1` · `<input data-testid=cookbooks-find-replace-input>` · `cookbooks-find-replace` · `cookbooks-find-replace-all` · `cookbooks-find-close` (✕). Все кнопки — `type="button"`, `aria-label`/`title` из i18n; высота полей — как у `cookbooks-filter`.

Семантика:
- область поиска — `sources` всех ячеек ipynb в порядке документа (md-ячейки включительно);
- матчи — непустой запрос, регистронечувствительно по умолчанию; неперекрывающиеся, слева направо; multi-line запрос допустим (поиск подстроки);
- `Enter`/`Shift+Enter` в поле запроса = next/prev; обёртка по кругу; `current` клампится и пересчитывается при изменении матчей;
- прыжок: ячейка матча переводится в режим правки (md — тоже), затем `setSelectionRange(start, end)` без фокуса (фокус остаётся в поле поиска) + `scrollToCell`; фокус возвращается в поле поиска из кнопок (next/prev не крадут фокус — `preventDefault` на mousedown не нужен, но после клика вернуть фокус на input);
- `Заменить` — текущий матч в своей ячейке (`replaceMatch(source, start, end, replacement)`), матчи пересчитываются;
- `Заменить всё` — по всем ячейкам (`replaceAllInSources`), notice `cookbooks.find.replaced {count}`; при count=0 — no-op;
- `Esc`/`✕` — закрыть панель (запрос сохраняется); повторный `Ctrl+F` — открыть и сфокусировать;
- смена документа (`applyDocument`) закрывает панель и чистит запрос.

**Модуль `find-replace.ts` (чистый, новый файл)**:
```ts
export interface CookbooksFindMatch { cell: number; start: number; end: number }
export function computeMatches(
  sources: ReadonlyArray<string | undefined>,
  query: string,
  caseSensitive: boolean,
): CookbooksFindMatch[]
export function replaceMatch(source: string, start: number, end: number, replacement: string): string
export function replaceAllInSources(
  sources: ReadonlyArray<string | undefined>,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { updates: Record<number, string>; count: number }
```
Требования: query === '' → `[]`/`{updates:{},count:0}`; пустые/undefined источники пропускаются; не перекрывать совпадения (шаг = query.length); case-insensitive — сравнение lowercase, offsets по оригиналу; `replaceAllInSources` строит новый текст ячейки одним проходом и возвращает только затронутые ячейки.

## F3 — Конвертация типа ячейки (лаборатория + main + renderer)

**Лаборатория (канон → ре-вендор).** Новый op:
- `POST /cells/convert` тело `{itemId: string, index: int, cellType: "code"|"markdown"}` → `200 {ok: true, index}`.
- Ошибки: 400 `missing itemId` / catalog / `not a notebook` / `cellType must be 'code' or 'markdown'` / `index must be an integer` / `cell index out of range`; 409 `{"error":"notebook is running"}`; 404 прочие пути. Порядок валидации — как у `/cells/*` (itemId → каталог → ipynb → поля → bounds → run-guard).
- `notebooks.py::Notebook.convert_cell(index: int, cell_type: str) -> int`: тот же тип → no-op success; `code → markdown`: source сохраняется, `outputs`/`execution_count` удаляются (md-ячейка: `{cell_type, metadata, source}`); `markdown → code`: добавляются `execution_count: None`, `outputs: []`; `id` ячейки (nbformat 4.5) сохраняется, если был.
- host.py: `/cells/convert` в allowlist + ветка парсинга (`cellType` + `index`); docs/electron-integration.md §3.7 — строка convert; lab-тесты: `tests/test_host.py` (200/400/409 кейсы), `tests/test_notebooks.py` (`convert_cell` семантика).

**Shared/main.** В union:
```ts
| { op: 'convert'; index: number; cellType: 'code' | 'markdown' }
```
`cookbooks-runtime.ts::apiMutate` — case `'convert'` → `POST /cells/convert` → перечитать `GET /document/<itemId>` → `{document, index}` (как остальные опа). Интеграционный тест `cookbooks-cells.integration.test.ts`: code→md теряет outputs, md→code сохраняет source, повторная конвертация — no-op.

**Renderer.** Пункт в меню `⋯` — `cookbooks-convert-{i}`, текст зависит от типа (`→ Текст` для кода, `→ Код` для текста; ключи `cookbooks.actions.toCode`/`toText`); после конвертации ячейка остаётся в фокусе (существующий `pendingFocusRef`), md открывается в режиме правки. Гейты: `busy === null`, `doc.kind === 'ipynb'`.

## F4 — md-микро

- `CellMarkdown` получает опциональный `onActivate?: () => void`; на обёртке — `onDoubleClick={onActivate}` + `title={t('cookbooks.cell.editHint')}` только когда `onActivate` задан (md-ячейки; rich-дисплеи НЕ получают).
- Двойной клик по md-ячейке в режиме чтения → `setEditingCells(i,true)` + `pendingFocusRef.current = i`.
- В редакторе md-ячейки `Shift+Enter` и `Ctrl/Cmd+Enter` → сохранить ячейку (`api.save`) и выйти в режим чтения (существующий notice `cookbooks.status.cellSaved`); ошибка save — остаёмся в правке, notice с ошибкой. Для плейбука: `Shift+Enter`/`Ctrl/Cmd+Enter` в его textarea → `savePlaybook()` + `setPlaybookEditing(false)`.

## F5 — Автосохранение, индикатор, Ctrl+S

- «Грязные» ячейки: `sources[i] !== doc.cells[i].source`; плейбук: `playbookText !== (doc.text ?? '')`.
- После успешного `api.save` ячейки — точечное обновление `doc` (отпечаток сервера): `setDoc(prev => ({...prev, cells: prev.cells.map((c,idx) => idx===i ? {...c, source} : c)}))` (и `text` для плейбука). Это же делает ручной «Сохранить» честным для индикатора.
- Эффект автосейва: при изменении `sources/playbookText/doc` — сброс таймера; «грязно» → `saveState='dirty'`; таймер 1000 мс → flush: последовательные `api.save` по возрастанию индекса (плейбук — после ячеек); single-flight (ref); во время flush `saveState='saving'`; успех → `'saved'` + `lastSavedAt=performance.now()`; ошибка → `'error'` + один `toast.error(t('cookbooks.save.error'))` на эпизод (реарм после успеха). Пока `busy !== null` таймер откладывается (пере-взводится после завершения действия — кнопки в этот момент всё равно disabled); `Ctrl/Cmd+S` в busy — no-op.
- `Ctrl/Cmd+S` — немедленный flush (тот же core); при отсутствии грязных — no-op (без notice).
- Индикатор — сегмент статус-бара (F6) + `title` с временем; другие точки не дублируем.
- Границы: смена документа не флашит (окно потерь минимизировано автосейвом); после `applyDocument` — `saveState='saved'`.

## F6 — Статус-бар

Футер поверхности (при открытом документе), `data-testid="cookbooks-statusbar"`:
`flex items-center gap-3 border-t border-border-subtle px-3 py-1 text-caption text-muted-foreground numeric`.
- `cookbooks-save-state`: точка (`size-1.5 rounded-full`, `bg-success` / `bg-status-warning` / `bg-destructive` / `bg-muted-foreground`) + текст (`cookbooks.save.saved {time}` / `cookbooks.save.dirty {count}` / `cookbooks.save.saving` / `cookbooks.save.error`); `title` — `lastSavedAt` в `toLocaleTimeString()`.
- `flex-1` распорка.
- `cookbooks-statusbar-cells` — `cookbooks.statusbar.cells {total, code}` (для ipynb; для плейбука сегмент не рендерим).
- `cookbooks-last-run` — `cookbooks.statusbar.lastRun {time, ok, failed, duration}`; обновляется после каждого `runCell`/`runAllCells` (для одиночного: ok/failed по результату, duration — замер клиента; для батча — суммарные счётчики). До первого прогона сегмента нет.

## F7 — Длительность прогона у ячейки

- Источник №1 — сайдкар: per-cell `duration_ms` уже приходит в записях `/run-all` (`host.py:495`), но main его отбрасывает (`mapRunCell`). Волна добавляет `durationMs?: number` в `CookbooksRunCell` и маппинг в main (**слайс B**). Источник №2 — клиентский `performance.now()` для одиночного `/run` (в ответе `/run` длительности нет).
- `durations: Record<number, number>` (ms) — заполняется в `runCell` (клиентский замер, в `finally`, даже при отмене/ошибке) и в `runAllCells` (`cell.durationMs ?? клиентский общий замер не пишем`); очищается в `applyDocument`. Рендер — **слайс E**.
- В гуттере под счётчиком: `<span data-testid="cookbooks-duration-{i}" title={t('cookbooks.cell.lastDuration', {duration})} class="font-mono text-caption numeric text-text-secondary">{formatDuration(ms)}</span>`; рендер — только при наличии записи; место не прыгает (гуттер уже колоночный `gap-1`).

## F8 — Scroll-spy оглавления

- Модуль `scroll-spy.ts`: `export function pickActiveEntry(offsets: readonly number[], scrollTop: number): number | null` — последний `i`, где `offsets[i] <= scrollTop + 4`; пустой вход → `null`; если ни один не подошёл → `0`.
- Рендер: `onScroll` на скролл-секции документа (rAF-троттлинг, cleanup), offsets — `testId` записей оглавления (`getBoundingClientRect().top - sectionRect.top + section.scrollTop`); активная кнопка оглавления — `aria-current="true"` + `text-foreground font-medium` (иначе `text-muted-foreground`).

## F9 — «Перезапустить и выполнить»

Кнопка в документ-шапке: `data-testid="cookbooks-restart-run-all"`, `cookbooks.actions.restartRunAll`, гейты `canRunAll && busy === null`. Клик: `clearAllOutputs()` → `setRuns({})` → `void runAllCells()`.

## F10 — LaTeX (только проверка; по recon — уже работает)

Recon-факт: `remark-math` включён во всех режимах с `singleDollarTextMath:false` (`Markdown.tsx:854-865`, `math-options.ts:7-9`), KaTeX грузится лениво — `$$…$$` и ```math-фенсы рендерятся в md-ячейках и плейбуках уже сейчас; инлайновый `$…$` намеренно не математика. Живой смоук: подтвердить `$$…$$` в md-ячейке и зафиксировать в отчёте. Изменений кода нет.

## i18n (27 ключей; ru/en заморожены, остальные 10 локалей — перевод в стиле файла)

| Ключ | ru | en |
|---|---|---|
| cookbooks.find.placeholder | Искать в ячейках | Find in cells |
| cookbooks.find.count | {{current}} из {{total}} | {{current}} of {{total}} |
| cookbooks.find.noMatches | Нет совпадений | No matches |
| cookbooks.find.next | Следующее совпадение | Next match |
| cookbooks.find.previous | Предыдущее совпадение | Previous match |
| cookbooks.find.caseSensitive | Учитывать регистр | Match case |
| cookbooks.find.replacePlaceholder | Заменить на | Replace with |
| cookbooks.find.replace | Заменить | Replace |
| cookbooks.find.replaceAll | Заменить всё | Replace all |
| cookbooks.find.close | Закрыть поиск | Close find |
| cookbooks.find.replaced | Заменено: {{count}} | Replaced: {{count}} |
| cookbooks.help.shortcutFind | Ctrl/Cmd+F — поиск и замена по ячейкам; Esc — закрыть | Ctrl/Cmd+F — find and replace in cells; Esc — close |
| cookbooks.help.shortcutSelect | Esc — выйти из правки · ↑/↓ или j/k — выбрать ячейку · Enter — вернуться в правку | Esc — exit editing · ↑/↓ or j/k — select a cell · Enter — back to editing |
| cookbooks.help.shortcutEdit | a — вставить код выше · b — вставить код ниже · dd — удалить ячейку | a — insert code above · b — insert code below · dd — delete the cell |
| cookbooks.help.shortcutType | y — сделать ячейку кодом · m — сделать её текстом | y — turn the cell into code · m — turn it into text |
| cookbooks.help.shortcutSave | Ctrl/Cmd+S — сохранить изменения | Ctrl/Cmd+S — save changes |
| cookbooks.save.saved | Сохранено · {{time}} | Saved · {{time}} |
| cookbooks.save.dirty | Не сохранено: {{count}} | Unsaved: {{count}} |
| cookbooks.save.saving | Сохранение… | Saving… |
| cookbooks.save.error | Ошибка сохранения | Save failed |
| cookbooks.statusbar.cells | Ячеек: {{total}} · кода: {{code}} | Cells: {{total}} · code: {{code}} |
| cookbooks.statusbar.lastRun | Прогон в {{time}}: {{ok}} успешно · {{failed}} с ошибкой · {{duration}} | Run at {{time}}: {{ok}} ok · {{failed}} failed · {{duration}} |
| cookbooks.cell.lastDuration | Последний прогон: {{duration}} | Last run: {{duration}} |
| cookbooks.cell.editHint | Двойной клик — редактировать | Double-click to edit |
| cookbooks.actions.toCode | Сделать кодом | Turn into code |
| cookbooks.actions.toText | Сделать текстом | Turn into text |
| cookbooks.actions.restartRunAll | Перезапустить и выполнить | Restart and run all |

`SHORTCUT_KEYS` (страница) += `shortcutFind, shortcutSelect, shortcutEdit, shortcutType, shortcutSave` (после существующих).
Порядок и сортировка ключей в файлах — как у соседей (`sort-locales`); ru — дефолт.

## Testid-контракт (новые)

`cookbooks-find`, `cookbooks-find-input`, `cookbooks-find-count`, `cookbooks-find-prev`, `cookbooks-find-next`, `cookbooks-find-case`, `cookbooks-find-replace-input`, `cookbooks-find-replace`, `cookbooks-find-replace-all`, `cookbooks-find-close`, `cookbooks-convert-{i}`, `cookbooks-duration-{i}`, `cookbooks-statusbar`, `cookbooks-save-state`, `cookbooks-statusbar-cells`, `cookbooks-last-run`, `cookbooks-restart-run-all`.
Существующие — без изменений: `cookbooks-cell-{i}` получает `data-selected` и `aria-current`; md-обёртка (`cookbooks-markdown-{i}`) — `title`-хинт.

## Слайсы и владение

| Слайс | Владеет | Файлы | Зависит |
|---|---|---|---|
| A (renderer, batch 1) | F1+F2+F4 + F3(renderer-часть) | `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx`; новые: `.../cookbooks/find-replace.ts`, `.../__tests__/find-replace.test.ts`; `.../__tests__/CookbooksSurfacePage.test.tsx` | интерфейсы F2/F3 из этого SPEC (фриз) |
| B (lab+main) | F3 + F7-main (`durationMs`) | канон `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks`: `src/rox_cookbooks/{host,notebooks}.py`, `tests/{test_host,test_notebooks}.py`, `docs/electron-integration.md`; воркдерево: `apps/electron/resources/cookbooks/**` + `PROVENANCE.md` (ре-вендор командой из PROVENANCE §Sync + манифест + дата снапшота); `apps/electron/src/shared/cookbooks.ts`; `apps/electron/src/main/cookbooks-runtime.ts`; `apps/electron/src/main/__tests__/{cookbooks-runtime.test.ts,cookbooks-cells.integration.test.ts}` | — |
| C (i18n) | ключи W13 | `packages/shared/src/i18n/locales/*.json` (12) | таблица i18n из SPEC (фриз) |
| E (renderer, batch 2) | F5+F6+F7+F8+F9 | тот же файл страницы; новые: `.../cookbooks/scroll-spy.ts`, `.../__tests__/scroll-spy.test.ts`; `apps/electron/resources/release-notes/next.md` | стартует ПОСЛЕ A (один писатель страницы) |

Правила исполнения: исполнители не коммитят и не гоняют полные гейты (только свои фокусные тесты); `bun` — `/opt/homebrew/bin/bun`, python — `/usr/bin/python3`; файлы соседей не трогать; коммиты и гейты — за оркестратором.

## Тесты (что обязаны появиться)

- `find-replace.test.ts`: матчи (регистр, пустой запрос, multi-line, неперекрытие), replaceMatch, replaceAllInSources (счётчик, только изменённые ячейки).
- `CookbooksSurfacePage.test.tsx` (+ кейсы A): командный режим (выбор кликом/j/k/стрелками, Enter-фокус, Shift+Enter-прогон+шаг, a/b/dd, y/m → вызов `mutate` с convert, gates busy/тип), find-панель (открытие Ctrl+F, счётчик, next/prev-обёртка, замена/заменить всё, Esc, сброс при смене документа), md-микро (двойной клик → textarea; Shift+Enter в md → save + read-mode).
- `CookbooksSurfacePage.test.tsx` (+ кейсы E): автосейв (debounce + фейк-таймеры, flush, «грязно/сохранено»), Ctrl+S, статус-бар (сегменты, время lastRun), бейдж длительности, scroll-spy (`aria-current` при scroll с мок-геометрией), restart-run-all (outputs очищены, ран-олл стартовал).
- `scroll-spy.test.ts`: pickActiveEntry (границы, пусто, до первого).
- main: `cookbooks-runtime.test.ts` (convert маршрут/ошибки), `cookbooks-cells.integration.test.ts` (+convert E2E реальный сайдкар).
- lab: `test_host.py` (+convert 200/400/409), `test_notebooks.py` (+convert_cell).

## Гейты волны (оркестратор)

1. `bun test` — фокусные наборы: страница кукбуков, find-replace, scroll-spy, runtime, cells-integration; соседние затронутые.
2. `cd apps/electron && bun run tsc --noEmit` (или `typecheck:electron`) → 0; `typecheck:shared` если задет shared.
3. i18n: `bun run lint:i18n:parity && lint:i18n:sorted && lint:i18n:coverage && lint:i18n:budget` + `bun scripts/sort-locales.ts --check`.
4. Лаборатория: `python3 -m unittest` (полный) + `python3 scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed`; вендор-манифест OK.
5. Ratchets: `lint:ui-tokens`, ESLint — none new.
6. Живой смоук (CDP): командный режим (Esc/j/k/Enter), Ctrl+F и замена, автосейв-индикатор, статус-бар, длительность, конвертация y/m, scroll-spy, LaTeX-ячейка; скриншоты в `~/Pictures/Shots/Agents/cookbooks-wave13/`.
7. PR → CI → merge (lane-process §1–§6), журнал в `docs/plans/lane-process.md` §4 + статус-журнал в PLAN.md.

## Вне скоупа (w14+)

Стриминг вывода (SSE), интерактивные виджеты, постоянное ядро, stdin/`input()`, variable inspector, стабильные `id` ячеек в DTO, drag-and-drop ячеек, командная палитра поверхностей, экспорт в .py/HTML/PDF, undo/redo поверх ячеек.
