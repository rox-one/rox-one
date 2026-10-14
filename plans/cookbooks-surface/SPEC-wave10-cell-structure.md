# SPEC: волна 10 — «Cell Structure» (структурные операции ячеек, Colab-паритет)

База: origin/main `a87b86505` (2026-10-14). Ветка волны: `feat/cookbooks-wave10` (воркдерево `~/Projects/rox-worktrees/cookbooks-wave10`).
Точка отката: main до слияния PR волны. Негоциируемые линии: точки отката волн 6–9 сохраняются.

Норматив: [PRD](PRD.md) · [SPEC](SPEC.md) (+Amd1) · [SPEC-wave7](SPEC-wave7-colab-ux.md) · [SPEC-wave9](SPEC-wave9-colab-controls.md) · [ADR 001](decisions/001-runtime-container-and-secrets.md).
Вендор-снапшот лаборатории: `apps/electron/resources/cookbooks/` — **read-only**; правки идут только через канон-репо `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks` + sync-команду из `PROVENANCE.md`.

## Цель

Закрыть гэп, отложенный волной 9: «Структурные операции над ячейками (add/delete/move/duplicate) — требуют мутаций документа в сайдкаре; отдельная волна» (SPEC-wave9 §Вне скоупа). Догнать Colab по редактированию структуры ноутбука: hover-вставка ячеек, per-cell меню (вверх/вниз/дублировать/удалить), `Ctrl+M`, управление фокусом/скроллом, защита от гонок с прогоном.

## Карта слайсов

| Слайс | Владеет | Файлы |
|---|---|---|
| P1 lab | сайдкар + ре-вендор + контракт | лаб: `src/rox_cookbooks/{notebooks,host,kernel}.py`, `tests/test_host.py`, `tests/test_notebooks.py`, `docs/electron-integration.md`; воркдерево: `apps/electron/resources/cookbooks/**` + `PROVENANCE.md` |
| P2 main | протокол + main + интеграционный тест | `packages/shared/src/protocol/channels.ts`, `packages/shared/src/protocol/routing.ts`, `apps/electron/src/shared/cookbooks.ts`, `apps/electron/src/shared/types.ts`, `apps/electron/src/shared/transport/channel-map.ts`, `apps/electron/src/main/handlers/cookbooks.ts`, `apps/electron/src/main/cookbooks-runtime.ts`, `apps/electron/src/main/__tests__/cookbooks-runtime.test.ts`, `apps/electron/src/main/__tests__/cookbooks-cells.integration.test.ts` (новый), `apps/electron/src/shared/__tests__/ipc-channels.generated.ts` |
| P3 renderer | страница + её тесты | `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx`, `apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` |
| P4 i18n | 12 локалей | `packages/shared/src/i18n/locales/*.json` (все 12) |

## Решения (зафиксировано)

1. **Единственный писатель — сайдкар.** Мутации — новыми HTTP-роутами лаборатории; main остаётся единственным HTTP-клиентом; write-back в канон-каталог запрещён (ADR §7; lab non-goal).
2. **Позиционная адресация + run-guard.** Ячейки адресуются индексом (стабильных `id` в вендорских ipynb нет — в этой волне не вводим). Любая мутация запрещена, пока для item есть активный прогон: сайдкар отвечает **409** `{"error":"notebook is running"}`; рендерер дополнительно блокирует контролы при `busy !== null`. Это закрывает гонку «вставка сдвигает индексы → персист вывода пишет не в ту ячейку» (`tests/test_notebook_persist.py:78-79`).
3. **Document-lock.** `LabHost._document_lock = threading.Lock()` (ThreadingHTTPServer конкурентен): им сериализуются `/save` и все четыре `/cells/*`. `/run*` в лок не берём (60-секундный прогон заблокировал бы сохранение) — гонку с ним закрывает run-guard (п.2).
4. **Ответ мутации → свежий документ.** Сайдкар: `{ok:true, index}`. Main после успеха перечитывает `GET /document/<itemId>` и отдаёт рендереру `{document, index}`; `index` — ячейка для фокуса (см. семантику).
5. **Один IPC-канал** `cookbooks-lab:mutate` с дискриминированным union (4 опа): минимум протокольной поверхности, один handler, один runtime-метод. Инвентарь каналов: 12 → 13 invoke.
6. **UI — disclosure, не портал.** Per-cell меню — кнопка «⋯», раскрывающая вторую строку действий внутри ячейки (без popover-порталов: стабильность happy-dom-тестов, никаких новых UI-примитивов). Вставка — hover-ряды «+ Код / + Текст» (Colab-жест); при пустом ноутбуке единственный ряд виден всегда.
7. **Клавиша — `Ctrl+M`** на всех платформах (как в Colab): `Cmd+M` на macOS — системный minimize; `CommandOrControl+M` зарезервирован голосовым вводом (`apps/electron/src/main/voice/command-input.ts:15`). Условие: `event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && key.toLowerCase()==='m'`.
8. **Автофлеш грязных правок.** Перед мутацией рендерер последовательно сохраняет ячейки, где `sources[i] !== doc.cells[i].source`; провал сохранения отменяет мутацию (notice). Правки не теряются.
9. **Счётчики/статусы.** После мутации `applyDocument` (существующий) сбрасывает сессионные `[N]`, статусы, режимы — честно, т.к. индексы сдвинулись.
10. **Только ipynb.** В плейбуке (`.md`) UI не рендерит вставки/меню; сайдкар отвечает 400.

## Контракт HTTP (лаборатория, канон → ре-вендор)

| Метод | Путь | Тело | 200 | Ошибки |
|---|---|---|---|---|
| POST | `/cells/add` | `{itemId, cellType:"code"\|"markdown", index:int, source?:string}` | `{ok:true, index:<вставленной>}` | 400 |
| POST | `/cells/delete` | `{itemId, index:int}` | `{ok:true, index:<фокус>}` | 400 |
| POST | `/cells/move` | `{itemId, from:int, to:int}` | `{ok:true, index:to}` | 400 |
| POST | `/cells/duplicate` | `{itemId, index:int}` | `{ok:true, index:index+1}` | 400 |

Общие обвязки `do_POST` (Host-allowlist 403, токен 401, тело ≤2 MiB 413) — без изменений. **409** `{"error":"notebook is running"}` — при активном прогоне item. Порядок валидации: itemId → item в каталоге (400) → kind==ipynb (400 «not a notebook») → парс полей (400) → bounds (400) → run-guard (409).

Семантика `index`:
- **add**: `0 <= index <= len` (len — до вставки; `len` — в конец). `source` по умолчанию `""`; не-строка → 400; `cellType` вне `{"code","markdown"}` → 400.
- **delete**: `0 <= index < len`. Ответный index = `min(index, len-2)` (позиция следующей ячейки); при `len===1` → `-1`.
- **move**: `0 <= from,to < len`; `from===to` — успех no-op; семантика как array.move (remove → insert по `to`).
- **duplicate**: `0 <= index < len`; `copy.deepcopy` ячейки, вставка в `index+1`; если у ячейки есть строковый `id` — новый `uuid.uuid4().hex[:12]` (уникальность nbformat-4.5).

Детали сайдкара:
- `kernel.py`: `ActiveRuns.active(key: str) -> int` — количество живых прогонов под локом.
- `notebooks.py`: `Notebook.delete_cell(index) -> int`, `Notebook.move_cell(from_index, to_index) -> int`, `Notebook.duplicate_cell(index) -> int` (+ `import uuid`). Существующие `add_code_cell`/`add_markdown_cell`/`save` — переиспользовать.
- `host.py`: `_document_lock` в `__init__`; четыре роута после `/save`; `/save` и `/cells/*` под локом; run-guard: `if lab.runs.active(item_id): 409`.
- `docs/electron-integration.md` (канон лаборатории): таблица §3.5 + новый раздел «Cell mutations» + 409 в таблицу статусов.
- Ре-вендор: sync-команда `PROVENANCE.md`; регенерация sha256-манифеста; обновить «Snapshot date» в PROVENANCE.md.

## Контракт shared/main/IPC (P2)

- `packages/shared/src/protocol/channels.ts`: `MUTATE: 'cookbooks-lab:mutate'` в блоке `cookbooksLab` (после EXPORT, до STATUS_CHANGED).
- `packages/shared/src/protocol/routing.ts`: строка `'cookbooks-lab:mutate'` в LOCAL_ONLY-список кукбуков (:540-552).
- `apps/electron/src/shared/cookbooks.ts`:
```ts
export type CookbooksCellMutation =
  | { op: 'add'; cellType: 'code' | 'markdown'; index: number; source?: string }
  | { op: 'delete'; index: number }
  | { op: 'move'; from: number; to: number }
  | { op: 'duplicate'; index: number }
export type CookbooksMutateInput = { itemId: string } & CookbooksCellMutation
export interface CookbooksMutateResult { document: CookbooksDocument; index: number }
```
- `apps/electron/src/shared/types.ts` → в `cookbooksLab` (:2209-2244): `mutate(args: CookbooksMutateInput): Promise<CookbooksMutateResult>` + doc-комментарий.
- `apps/electron/src/shared/transport/channel-map.ts` (:616-628): +1 запись.
- `apps/electron/src/main/handlers/cookbooks.ts`: `HANDLED_CHANNELS` + `server.handle(RPC_CHANNELS.cookbooksLab.MUTATE, (_ctx, input: CookbooksMutateInput) => runtime.apiMutate(input))`.
- `apps/electron/src/main/cookbooks-runtime.ts`: `apiMutate(input: CookbooksMutateInput): Promise<CookbooksMutateResult>` — switch по `op` → `POST /cells/{op}` (тело `{itemId, ...}` без `undefined`-полей) → ждать `{ok:true, index:number}` → `GET /document/<itemId>` → существующий `mapDocument` → `{document, index}`. Ошибки — существующий `CookbooksApiError` (не глотать status/message).
- `apps/electron/src/shared/__tests__/ipc-channels.generated.ts`: добавить `'cookbooks-lab:mutate'` и увеличить `EXPECTED_CHANNEL_COUNT` (оркестратор затем нормализует `bun scripts/ipc-inventory.ts`).

## Контракт renderer (P3)

- Новые testid: `cookbooks-insert-{i}`, `cookbooks-insert-code-{i}`, `cookbooks-insert-text-{i}`, `cookbooks-menu-{i}`, `cookbooks-menu-row-{i}`, `cookbooks-move-up-{i}`, `cookbooks-move-down-{i}`, `cookbooks-duplicate-{i}`, `cookbooks-delete-{i}`.
- **InsertRow** (внутренний компонент файла): рендерится для i=0..len (перед каждой ячейкой и после последней; при `len===0` — единственный ряд); классы: `group/insert flex h-6 items-center justify-center gap-2 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none`, при `len===0` — `opacity-100`; две кнопки `type="button"` с `ACTION_CLASS`, label `t('cookbooks.insert.code')` / `t('cookbooks.insert.text')`.
- **Меню**: `const [menuOpen, setMenuOpen] = useState<number | null>(null)`; кнопка «⋯» (`aria-label=t('cookbooks.actions.menu')`) в строке действий ячейки; раскрытая строка (`cookbooks-menu-row-{i}`) под header-строкой: Вверх (disabled `i===0`), Вниз (disabled `i===len-1`), Дублировать, Удалить. Все — disabled при `busy!==null` c `title={t('cookbooks.actions.busyHint')}`. Удалить → `window.confirm(t('cookbooks.cell.deleteConfirm'))` (паттерн `resetToOriginal` :737-745); отказ — no-op. Закрытие меню: повторный клик, любое действие, `applyDocument` (добавить `setMenuOpen(null)`), Esc (приоритет: открытое меню — закрыть и `preventDefault`; иначе существующая логика stop).
- **Мутация** (`mutateCell(mutation)`): guard `if (!openItemId || busy !== null) return`; `runWithBusy('mutate', …)`: (1) flush — для каждого i, где `(sources[i] ?? doc.cells[i].source) !== doc.cells[i].source`, sequential `api.save({itemId, index:i, source:sources[i] ?? ''})` (порядок по возрастанию i); (2) `const result = await api.mutate({itemId, ...mutation})`; (3) `applyDocument(result.document)`; (4) `pendingFocusRef.current = result.index`. Ошибка на любом шаге → throw в runWithBusy → notice, мутация не выполняется.
- **Фокус/скролл**: `const pendingFocusRef = useRef<number | null>(null)`; эффект c deps `[doc, editingCells]`: если ref не null и найден `[data-testid="cookbooks-source-{i}"]` → `ref.current !== null` снять + `scrollToCell(i)` + `field.focus()`; если поля нет (md в read-режиме) — подождать следующего прохода. Для md-вставки мутация дополнительно `setEditingCells((p)=>({...p,[i]:true}))`. `index===-1` (пустой ноутбук после delete) — ref сбросить, фокуса нет.
- **Ctrl+M** в `handleDocumentKeyDown` (:589-636): только `doc?.kind==='ipynb' && doc.supported && busy===null`; target с `data-cell-index` → вставка в `index+1` (код), иначе в конец (`doc.cells.length`); `event.preventDefault()`.
- `SHORTCUT_KEYS` (:71-77) += `'cookbooks.help.shortcutInsert'` (существующий рендер списка справки).
- Комментарии в стиле файла («Wave 10: …»).

## i18n (10 ключей; ru/en заморожены, остальные 10 локалей — перевод в стиле файла)

| Ключ | ru | en |
|---|---|---|
| `cookbooks.insert.code` | Код | Code |
| `cookbooks.insert.text` | Текст | Text |
| `cookbooks.actions.menu` | Действия ячейки | Cell actions |
| `cookbooks.actions.moveUp` | Вверх | Move up |
| `cookbooks.actions.moveDown` | Вниз | Move down |
| `cookbooks.actions.duplicate` | Дублировать | Duplicate |
| `cookbooks.actions.delete` | Удалить | Delete |
| `cookbooks.actions.busyHint` | Дождитесь завершения выполнения | Wait for the current run to finish |
| `cookbooks.cell.deleteConfirm` | Удалить ячейку? Действие нельзя отменить. | Delete this cell? This cannot be undone. |
| `cookbooks.help.shortcutInsert` | Ctrl+M — вставить ячейку ниже | Ctrl+M — insert a cell below |

Локали: `ar,de,en,es,fr,hu,ja,ko,pl,ru,zh-Hans,zh-Hant`; плоский JSON, ключи в алфавитном порядке (нормализует `bun run sort-locales` — оркестратор).

## Тесты

**Лаборатория** (unittest; запуск оркестратором: `cd /Users/t/Projects/2026-10-13-rox-cookbooks-notebooks && PYTHONPATH=src python3 -m unittest discover -s tests -v`):
1. `tests/test_notebooks.py`: delete/move/duplicate — возвращаемые индексы, delete→пусто (-1), move identity, duplicate deepcopy (правка копии не меняет оригинал) + id-перегенерация.
2. `tests/test_host.py`: 4 роута — успех и формы ответов; 400: bad cellType / bad index / out-of-range / unknown item / md-item; края bounds (add index==len ✓, delete index==len ✗); 409 при зарегистрированном `RunHandle` (register → 409 → release → успех); 401 без токена — общая обвязка.
3. Существующие наборы — без регрессий.

**Electron** (bun:test):
4. `cookbooks-runtime.test.ts`: `apiMutate` — 4 опа → правильные path/body; после опа документ перечитывается (2 запроса); результат `{document,index}`; 400/409 → `CookbooksApiError` с message сайдкара.
5. `CookbooksSurfacePage.test.tsx`: вставка (3 позиции), flush-before-mutate (порядок save→mutate), abort при провале save (mutate не вызван), меню (края disabled, вызовы опов), delete confirm false/true, busy-лок (кнопки disabled во время прогона), Ctrl+M (из textarea и из пустого фокуса), фокус+scroll после add, плейбук без вставок/меню, справка = все строки SHORTCUT_KEYS.
6. `cookbooks-cells.integration.test.ts` (новый; паттерн `cookbooks-cancel.integration.test.ts`): add→duplicate→move→delete по реальному документу; 409 во время `sleep`-прогона; гейт по `/cells/add` в host.py и detectPython.

## Гейты (оркестратор)

tsc electron+shared; focused bun:test (8 существующих + новые); lab unittest; probe `[SUMMARY] 0 failed` (канон + вендор); sha256-манифест вендора совпадает; i18n parity/sorted/coverage/budget + `sort-locales`; ratchets UI-token/ESLint — none new; `bun scripts/ipc-inventory.ts` (нормализация); живой smoke CDP.

## Вне скоупа (кандидаты волны 11+)

Rich-вывод (изображения/HTML: display_data в раннере), find/replace, streaming/SSE, очередь выполнения, variable inspector, стабильные `id` ячеек в DTO, показ persisted-outputs при открытии документа.
