# SPEC: волна 11 — «Rich Output & Persistence» (rich-вывод display_data + сохранённые выводы при открытии)

База: origin/main `9f7bf9a0a` (2026-10-14). Ветка волны: `feat/cookbooks-wave11` (воркдерево `~/Projects/rox-worktrees/cookbooks-wave11`).
Точка отката: main до слияния PR волны. Негоциируемые линии: точки отката волн 6–10 сохраняются.
Норматив: PRD/SPEC(+Amd1)/SPEC-wave7/9/10 + ADR 001. Вендор-снапшот — read-only; правки через канон-лабораторию + sync (`PROVENANCE.md`).

## Цель
1) **Rich-вывод**: ячейка может вернуть `display_data` (image/png|jpeg|svg+xml, text/html, application/json, text/markdown, text/plain) — через наш `display()`-builtin, rich-репры (`_repr_html_`, `_repr_png_`, …) и **последнее выражение ячейки** (Jupyter/Colab-семантика `Out[]`), включая авто-flush matplotlib-фигур; записи персистятся в ipynb и рендерятся в приложении.
2) **Persistence**: при открытии документа рендер показывает сохранённые выводы (и не забывает сессионные до явной очистки/нового прогона); `[N]` счётчики сидятся из nbformat `execution_count`.

## Решения (зафиксировано)
1. **Shadow-транспорт results-файлом** (детерминированно, kill-safe по образцу run-all): одиночный `/run` — stdin-payload становится объектом `{"code": str, "results": path, "secret_env": [names]}` (строковый payload `"<code>"` остаётся валидным — обратная совместимость); раннер пишет `{"displays":[...]}` в results-файл в `finally`. Kill/таймаут → файла нет → `displays=[]`.
2. **displayhook-семантика = только последнее top-level выражение** (Jupyter-парность), реализация — AST-обёртка: если `body[-1]` — `ast.Expr`, он заменяется на вызов `__rox_show__(<expr>)`; `None` не показывается. НЕ `compile(mode='single')` (дал бы мульти-дисплей и другие сюрпризы).
3. **`display(*objs, raw=False)`** инъектится в namespace: обычный объект → mime-бандл (все доступные `_repr_html_/_repr_svg_/_repr_png_/_repr_jpeg_/_repr_markdown_/_repr_json_` + `text/plain` через `repr()`); `raw=True` → аргумент уже является mime-бандлом `{mime: value}`.
4. **matplotlib**: в ребёнке `os.environ.setdefault("MPLBACKEND","Agg")` до exec; после ячейки (в `finally`, и на успехе, и на исключении) — если `matplotlib.pyplot` уже в `sys.modules`: сохранить все открытые фигуры (`savefig(BytesIO, format="png", bbox_inches="tight")`) как `image/png` display-записи и `close("all")`.
5. **Общий блок `_DISPLAY_HELPERS`** (module-level строка python-кода) подключается и в `_RUNNER`, и в `_RUN_ALL_DRIVER` — единый источник правды (формат записи, caps, redaction, flush).
6. **Формат записи display**: `{"mime": "<type>", "data": "<str>"}`: для `image/*` — **base64** (включая `image/svg+xml` — единообразие), для текстовых — сам текст. Порядок записей = порядок эмиссии; `text/plain` всегда присутствует (для репрезентаций и builtin display), если объект его дал.
7. **Redaction**: в ребёнке перед записью в файл (длины секретов из собственного env; имена — из payload) — только **текстовые** mime (`text/*`, `application/json`, `application/xml`, `application/x-yaml`); `image/*` не редактируем (документируем). Сайдкар повторно редактирует текстовые mime (defense in depth).
8. **Caps** (жёсткие, в ребёнке; сайдкар повторяет те же числа): на запись — 512 KiB; на ячейку/run — 1.5 MiB и ≤12 записей; run-all дополнительно общий бюджет 8 MiB. Превышение → вместо хвоста добавляется запись `{"mime":"text/plain","data":"…[display output truncated]"}`. Доп. cap на main/IPC НЕ вводим (IPv4 payload уже ограничен сайдкаром).
9. **Персист** (`notebooks.py::_apply_result`): порядок outputs = `stream(stdout)` → `display_data*` → `error`/`stream(stderr)`; `display_data` = `{"output_type":"display_data","metadata":{},"data":{mime: value}}`, где `application/json` сохраняется **распарсенным** (json.loads при успехе, иначе строкой), остальное — строка (base64 для картинок). `execution_count` инкремент — как сегодня.
10. **Host**: `safe`-whitelist `/run` (+`displays`), per-cell record `/run-all` (+`displays`); `document_payload` уже отдаёт сырые outputs — не меняется.
11. **DTO** (`shared/cookbooks.ts`):
```ts
export interface CookbooksDisplay { mime: string; data: string }
export interface CookbooksOutput { text: string; traceback: string | null; displays: CookbooksDisplay[] }
// CookbooksRunResult и CookbooksRunCell: + displays: CookbooksDisplay[] (аддитивно; отсутствие = [])
// CookbooksCell: + executionCount: number | null (из nbformat execution_count)
```
12. **Main-маппинг**: `mapOutput` — `text`/`traceback` как сегодня + `displays` из `data` (строки; не-строки → JSON.stringify); `mapCell` — `executionCount`; `mapRunResult`/`mapRunCell` — пасс-through `displays` (валидация: массив `{mime,data}` строк, иначе `[]`).
13. **Renderer — рендер** (`CellOutput`): внешний `<div>` сохраняет `data-testid="cookbooks-output-{i}"`, `data-status`, `data-collapsed`, `aria-label`; внутри `<pre>` (текст, как сегодня) + rich-записи ПОСЛЕ текста. На запись выбирается ОДИН mime по приоритету: `text/html` → `image/svg+xml` → `image/png` → `image/jpeg` → `application/json` → `text/markdown` → `text/plain`. Рендер: img → `<img src="data:{mime};base64,{data}" alt={t(cookbooks.output.imageAlt)} loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-[var(--radius-control)] border border-border-subtle"/>`; HTML → `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" title={t(cookbooks.output.frameTitle)} srcDoc={data} className="w-full min-h-[120px] rounded-[var(--radius-control)] border border-border-subtle bg-white"/>` (прецедент — `WidgetFrame.tsx:183-190`: allow-scripts БЕЗ allow-same-origin); JSON → pretty `<pre>` (try JSON.parse → stringify 2); markdown → существующий `<Markdown mode="minimal">`; svg/png/jpeg — data-URL как выше.
14. **Renderer — текст/копирование**: `outputText` — если после join пусто, но есть displays: взять `text/plain` выбранной записи; иначе `t('cookbooks.output.richPlaceholder')`. `copyOutput`/коллапс не меняются (ключуются от outputText).
15. **Renderer — сидинг** (`applyDocument`): для каждой ячейки с непустыми `outputs`: `outputs[i] = { index, status: 'saved', stdout: join(non-empty texts, '\n'), error: first non-null traceback ?? null, displays: flatMap(displays) }`; `runs[i] = executionCount ?? 0` (если ≥1). Тип статуса: `CookbooksCellStatus` += `'saved'`. Сессионная запись run/clear перезаписывает/удаляет (как сейчас — `clearOutput` удаляет локально; после mutate/reset сидинг повторяется из свежего документа — ожидаемо).
16. **Экспорт** (`buildNotebookExport`): вход ячейки += `displays?: CookbooksDisplay[]`; после stream-записей добавляются `{output_type:'display_data', metadata:{}, data:{[mime]: data}}` (значения-строки; для `application/json` — parse-в-объект при успехе). Рендер-экспорт передаёт сессионные displays.
17. **i18n** (3 ключа ×12; ru/en заморожены):
| Ключ | ru | en |
|---|---|---|
| cookbooks.output.imageAlt | График из ячейки | Plot from the cell |
| cookbooks.output.frameTitle | HTML-вывод ячейки | Cell HTML output |
| cookbooks.output.richPlaceholder | [графический вывод] | [graphical output] |
18. **Контракт**: `docs/electron-integration.md` — §3.5 (+displays в /run и /run-all), новый §3.8 «Rich displays (display_data)»: protocol results-файла, mime-набор, приоритет, caps, redaction-политика (image не редактируется), matplotlib-механика, оговорка про os.write. Ре-вендор + манифест.
19. **`--cdp` флаг** (`scripts/dev-isolated.ts`, оркестратор inline): `--cdp[=PORT]` → ставит `CRAFT_REMOTE_DEBUGGING_PORT` (default 9227), если не задан; docstring + вывод `--print`; проверить `bun scripts/dev-isolated.ts --print --cdp`.

## Слайсы
| Слайс | Файлы | Ключевое |
|---|---|---|
| P1 lab | канон `src/rox_cookbooks/{kernel,notebooks,host}.py`, `tests/test_display.py` (новый), `tests/test_multi_kernel.py` (обновить 8→9 ключей), `tests/test_notebook_persist.py` (+display-кейсы), `docs/electron-integration.md`; воркдерево `apps/electron/resources/cookbooks/**` + `PROVENANCE.md` | helpers, AST-обёртка, results-транспорт, run-all displays, caps/redaction, персист display_data, whitelist, ре-вендор |
| P2 main | `apps/electron/src/main/cookbooks-runtime.ts`, `apps/electron/src/shared/cookbooks.ts`, `apps/electron/src/shared/types.ts`, тесты (`cookbooks-runtime.test.ts`, `cookbooks-export.test.ts`) | DTO, mapOutput/mapCell/mapRunResult/mapRunCell, экспорт display_data |
| P3 renderer | `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx`, `.../__tests__/CookbooksSurfacePage.test.tsx` | CellOutput div+rich, outputText fallback, applyDocument сидинг + [N] из executionCount |
| P4 i18n | `packages/shared/src/i18n/locales/*.json` (12) | 3 ключа (ru/en заморожены) |

## Тесты
**Лаборатория** (unittest; запуск оркестратором): `test_display.py` — протокол раннера через `subprocess.run([sys.executable,"-c",kernel._RUNNER], input=json.dumps(payload))` (venv НЕ нужен): (1) `display(obj)` → бандл; (2) rich-репры (`_repr_html_`/`_repr_png_`) + text/plain; (3) только последнее выражение; `None` → отсутствие записи; (4) redaction текстовых mime; (5) caps (запись/ячейка/12); (6) matplotlib-flush через инжект-стаб (`sys.modules["matplotlib.pyplot"]` из самой ячейки); (7) legacy str-payload; (8) base64 для image/*. Плюс `test_notebook_persist.py`: displays→display_data (порядок stream→display→error; JSON распарсен); `test_multi_kernel.py`: ключи записи 8→9.
**Electron**: main — mapOutput display_data/executionCount, run/rслall displays passthrough + мусорный ввод → []; export display_data; renderer — рендер img/iframe(атрибуты)/json/markdown, сидинг при открытии (текст+displays+[N]), copy-фолбэк по richPlaceholder, коллапс не сломан; интеграционный `cookbooks-display.integration.test.ts` (реальный сайдкар): `display({"image/png": TINY}, raw=True)` → `displays[0].mime=="image/png"`; `1+1` → text/plain «2»; перечитать документ → `outputs[i]` содержит display_data.

## Гейты (оркестратор)
tsc electron+shared; focused bun:test (11 существующих + новый display-integration); lab unittest (полный) + probe 0 failed + манифест OK; i18n parity/sorted/coverage/budget + sort-locales; ratchets none new; живой smoke CDP: display-cell (image+html+json) → рендер → перезапуск/повторное открытие → выводы на месте, [N] из execution_count.

## Вне скоупа (w12+)
Стриминг/SSE вывода, интерактивные виджеты, latex-рендер (переносим записью, не рендерим), stdin/`input()`, постоянное ядро, find/replace.
