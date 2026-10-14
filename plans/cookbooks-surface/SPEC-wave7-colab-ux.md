# SPEC — волна 7: «Colab-UX» для поверхности кукбуков

Нормативные документы программы: [PRD](PRD.md) · [SPEC](SPEC.md) (+Amendment 1) · [ADR 001](decisions/001-runtime-container-and-secrets.md).
**База:** origin/main `2d756b0a0` (содержит PR #1956). **Ветка:** `feature/cookbooks-colab-ux`, воркдерева `~/Projects/rox-worktrees/cookbooks-colab-ux`.
**Статус:** ✅ DONE — влито в main: PR #1972 @ `24147e9f8` (2026-10-14). Точка отката: `24147e9f8^1`.
Цель: сделать поверхность удобнее и информативнее в духе Google Colab — **строго в дизайн-системе ROX**, без новых зависимостей и без изменений main/IPC/i18n-контракта прошлых волн.

## Решения (recon-факты, использовать как есть)

- **Markdown:** канонический компонент `Markdown` из `@/components/markdown` (re-export `@rox/ui`, `packages/ui/src/components/markdown/Markdown.tsx:802`). Код-блоки — `CodeBlock` (shiki, кнопка Copy) оттуда же. `mode="minimal"` для md-ячеек, `mode="full"` для плейбука. Ссылки санитизированы ядром (`defaultUrlTransform`); `rehype-raw` включён в каноне продукта (data-политика: вендоренный/пользовательский контент; это существующее продуктовое решение — новых механизмов не вводим).
- **Копирование:** `navigator.clipboard.writeText` в try/catch → `toast.success(t('toast.copied'))` / `toast.error(t('toast.copyFailed'))` (ключи существуют) — паттерн `TaskActionMenu.tsx:118-124`; либо `CopyButton` из `@rox/ui` (`packages/ui/src/components/overlay/CopyButton.tsx:14`). Копирующий вызов — инъектируемый (prop-override) для тестов (образец `EntityCard.tsx:38-44`).
- **Длительность:** `formatDuration(ms)` из `@rox/ui` (`packages/ui/src/components/chat/turn-utils.ts:1000-1015`; «1.2s», «1m 5s»). Свой форматтер не добавлять.
- **Sticky:** `sticky top-0 z-sticky bg-background/95 backdrop-blur` (+ `border-b border-border/40`); числовые z-index запрещены (токены `packages/ui/src/styles/tokens/z.css`).
- **Клавиши:** локальные обработчики на контейнере документа (React `onKeyDown`), **не** глобальные `window`-слушатели; показывать подписи через `formatHotkeyDisplay` при необходимости. Реестр `actions/*` не трогать.
- **Скролл:** контейнер документа — `[data-testid="cookbooks-document"]` (уже существует, `CookbooksSurfacePage.tsx:594-598`). `scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' })`.

## Фичи (R1–R7, заморожены)

**R1 — markdown-рендер.** md-ячейки (`cellType === 'markdown'`) и плейбук (`kind === 'md'`): режим чтения — `<Markdown>` (`minimal`/`full`); локальная кнопка-переключатель «Просмотр»/«Изменить» (`cookbooks.cell.readMode`/`cookbooks.cell.editMode`); в режиме правки — существующий `textarea`; «Сохранить» — существующим save (статусы не менять); после save рендер обновляется. Код-ячейки — как были (textarea всегда). Рендер — `MemoizedMarkdown` или мемоизация per-cell (без лишних перерисовок).

**R2 — счётчики выполнений (сессия).** Слева у ячейки — бейдж `[N]` (`[ ]` до первого прогона), N — локальный счётчик сессии: одиночный `run` увеличивает только свою ячейку; `runAll` увеличивает каждую исполненную (`ok|error`) ячейку на 1 в порядке документа; `skipped` — без инкремента. Честная пометка: счётчик локальный (не персистится); `aria-label` = `cookbooks.cell.runs`.

**R3 — тайминги.** Вокруг `run`/`runAll` замер `performance.now()` → `formatDuration`:
- статус успеха/ошибки: `cookbooks.status.cellOk/cellError` c `{{duration}}`;
- run-all: `cookbooks.status.runAll` c `{{duration}}` (общая);
- во время выполнения — тикающий статус `cookbooks.status.runningElapsed` (обновление 250 мс), только для активного действия.
Класс `numeric` для чисел.

**R4 — busy ячейки.** Во время `run` — спиннер (`Loader2`, `icon-empty animate-spin motion-reduce:animate-none`) в гуттере ячейки, её run/save disabled; во время `runAll` — спиннер у всех исполняемых code-ячеек, их действия disabled; общий busy по-прежнему блокирует header-действия.

**R5 — клавиши (Colab-паритет).** `onKeyDown` на контейнере документа:
- `Shift+Enter` (target — `textarea`): запустить текущую ячейку → фокус в `textarea` следующей code-ячейки (если есть);
- `Ctrl/Cmd+Enter` (target — `textarea`): запустить ячейку, фокус остаётся;
- `Ctrl/Cmd+Shift+Enter` (target — где угодно в контейнере): `runAll` (только ipynb+supported);
- `preventDefault` при обработке; в busy — no-op для комбинаций, запускающих работу.
Подписи — в справке (R7) и `title` кнопки «Запустить».

**R6 — информативная шапка и конвиниенс.**
- Шапка документа — `sticky` (см. решения), в ней: title, kind-пилюля, copyId, **`cookbooks.header.cells`** («Ячеек: {{count}}»).
- Автоскролл: при `runAll` — к первой code-ячейке; после завершения — к первой ячейке с `status === 'error'`, если есть.
- Гуттер ячейки: бейдж счётчика (R2) + спиннер (R3; занятое место, без прыжков layout).
- Действия вывода: «Копировать вывод» (`cookbooks.cell.copyOutput`; текущий вывод ячейки) и «Очистить вывод» (`cookbooks.cell.clearOutput`; сброс к hint) — только когда вывод есть.

**R7 — справка и a11y.** В `<details>`-справку — блок «Клавиши» (`cookbooks.help.shortcutsTitle` + 3 строки R5). Все новые контролы — `type="button"`, доступные имена из i18n; спиннеры `aria-hidden`; `role="status"` у статуса сохраняется; фокус-стили — системные.

## i18n round 3 (14 ключей; ru/en — заморожены, остальные 10 — перевод)

| Ключ | ru | en |
|---|---|---|
| cookbooks.cell.editMode | Изменить | Edit |
| cookbooks.cell.readMode | Просмотр | View |
| cookbooks.cell.clearOutput | Очистить вывод | Clear output |
| cookbooks.cell.copyOutput | Копировать вывод | Copy output |
| cookbooks.cell.runs | Выполнений: {{count}} | Runs: {{count}} |
| cookbooks.header.cells | Ячеек: {{count}} | Cells: {{count}} |
| cookbooks.status.runningElapsed | выполняется… {{duration}} | running… {{duration}} |
| cookbooks.help.shortcutsTitle | Клавиши | Keyboard shortcuts |
| cookbooks.help.shortcutRun | Shift+Enter — запустить ячейку и перейти к следующей | Shift+Enter — run the cell and move to the next one |
| cookbooks.help.shortcutRunStay | Ctrl/Cmd+Enter — запустить ячейку, не уходя с неё | Ctrl/Cmd+Enter — run the cell without leaving it |
| cookbooks.help.shortcutRunAll | Ctrl/Cmd+Shift+Enter — запустить все ячейки | Ctrl/Cmd+Shift+Enter — run all cells |

**Изменяются (значения) в 3 существующих ключах (все 12 локтей):**
- `cookbooks.status.cellOk` → ru: `Ячейка {{index}}: успешно · {{duration}}` · en: `Cell {{index}}: success · {{duration}}`
- `cookbooks.status.cellError` → ru: `Ячейка {{index}}: ошибка · {{duration}}` · en: `Cell {{index}}: error · {{duration}}`
- `cookbooks.status.runAll` → ru: `Запущено {{count}} ячеек: {{ok}} успешно · {{failed}} с ошибкой · {{skipped}} пропущено · {{duration}}` · en: `Ran {{count}} cells: {{ok}} ok · {{failed}} failed · {{skipped}} skipped · {{duration}}`

## File map (волна 7)

| Путь | Действие | Владелец |
|---|---|---|
| `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx` | Modify (R1–R7) | E-ux |
| `apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` | Modify (RED-first расширение) | E-ux |
| `apps/electron/src/renderer/pages/cookbooks/**` (доп. модули: чистые хелперы run-состояния, при желании `CookbookCell.tsx`) | Create (по необходимости) | E-ux |
| `packages/shared/src/i18n/locales/*.json` (12) | Modify (11 новых + 3 правки) | E-i18n3 |

## Testing decisions (RED-first)

Тест-харнесс — существующий (`CookbooksSurfacePage.test.tsx:14-63`: `useDomForFile`, `setupI18n`, динамический import, `Reflect.deleteProperty(window,'electronAPI')`). Кейсы (≥12 новых):
1. md-ячейка в режиме чтения рендерит markdown (fixture `# Заголовок` → в DOM есть `h1`), textarea отсутствует; кнопка «Изменить» → textarea; «Просмотр» → снова рендер.
2. Плейбук: read-mode рендерит `mode="full"`, edit → textarea, save → статус `status.saved`.
3. Счётчики: до прогона `[ ]`; после одиночного run — `[1]`; второй run — `[2]`; run-all инкрементит исполненные, skipped — нет.
4. Тайминги: статус после run содержит duration-суффикс (`/·\s.*s/` при `formatDuration`); во время выполнения — `runningElapsed` (fake timers: `vi.useFakeTimers` + `advanceTimersByTime` внутри `act`, паттерн `WidgetCard.test.tsx`).
5. Busy: спиннер в ячейке во время run; run/save disabled; после — enabled.
6. Клавиши: `textarea.focus()` + `dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', shiftKey:true, bubbles:true}))` → вызван `run`, фокус на следующей textarea; `metaKey` вариант — run без смены фокуса; `meta+shift` на контейнере → `runAll`; busy → no-op.
7. Copy: клик → `clipboard.writeText` (мок/inject) + toast; Clear: вывод → hint.
8. Шапка: `Ячеек: N` из документа; sticky-классы присутствуют (`sticky top-0 z-sticky`).
9. Справка: присутствуют 3 строки клавиш.
10. Автоскролл: `scrollIntoView` вызван при runAll (мок Element.prototype.scrollIntoView) и после ошибки — к первой error-ячейке.
Все — падающие до реализации (RED evidence в отчёт). Существующие 24 кейса должны остаться зелёными (3 key-правки затронут ожидания — обновить их вместе с i18n).

## Out of scope

- Добавление/удаление/перемещение ячеек, персист стриминга run-all по ячейкам, персист счётчиков, изменения лаборатории/main/IPC, реестр actions, новые зависимости.
- Локали: правит только E-i18n3; страница использует финальные значения (см. таблицу).

## Acceptance

```bash
cd /Users/t/Projects/rox-worktrees/cookbooks-colab-ux
/opt/homebrew/bin/bun test apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx   # зелёный
/opt/homebrew/bin/bun scripts/sort-locales.ts --check
cd apps/electron && /opt/homebrew/bin/bun run tsc --noEmit 2>&1 | grep cookbooks || echo NO-COOKBOOKS-TS-ERRORS
```
G5 (lead): живой smoke — md-рендер, Shift+Enter-прогон, счётчик `[1]`, duration в статусе, скриншоты.
