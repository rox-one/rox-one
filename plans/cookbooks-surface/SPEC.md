# SPEC: «Cookbooks» — поверхность кукбуков (программа `cookbooks-surface`)

Нормативные требования: [PRD](PRD.md) · Решения: [ADR 001](decisions/001-runtime-container-and-secrets.md) · План: [PLAN](PLAN.md)

## Solution

Продукт получает нативную поверхность `cookbooks`: пункт в «Ещё» → честные состояния → **нативный React-интерфейс** (SPEC §Amendment 1) поверх локального сайдкара кукбуков. Main-процесс владеет жизненным циклом Python-процесса (резолв интерпретатора → спавн → разбор discovery-строки → health → рестарт/stop) и единственный знает URL с токеном; renderer получает только типизированный статус. Сайдкар вендорится в ресурсы приложения снапшотом с PROVENANCE. Секреты в v1 не передаются (Срез 2 — `POST /store`, отдельный PR). Никаких миграций, таблиц и серверного состояния.

**НЕ делаем:** iframe/`<webview>` (XFO: DENY), передачу токена в renderer, env-проброс секретов, изменения кода лаборатории, webui/CLI/облачные поверхности.

## Amendment 1 (2026-10-14, директива владельца) — НАТИВНЫЙ UI

**Решение изменено:** интерфейс поверхности «Кукбуки» — **нативный React в дизайн-системе ROX**. `WebContentsView`/веб-страница лаборатории в интерфейсе не используются (причина: визуальная и UX-чужеродность — лабораторный `lab.html` рисует собственную дизайн-систему, не ROX).

**Отменяется:** §Implementation Decisions п.3 (вид-менеджер `cookbooks-view.ts` — **удаляется**), §Renderer registration п.9 (mount/bounds/release), каналы `MOUNT`/`SET_BOUNDS`/`UNMOUNT`, партиция `persist:cookbooks-lab`, навигационный allowlist вида. Остальное (§Discovery, §Spawn, §Резолв python, §Состояния, runtime-супервизор, stop в quit) — без изменений.

**Новый контракт данных:** main — единственный HTTP-клиент сайдкара (токен не покидает main), renderer — типизированный IPC:

```ts
RPC_CHANNELS.cookbooksLab = {
  ENSURE:  'cookbooks-lab:ensure',    // () → CookbooksStatus
  STATUS:  'cookbooks-lab:status',    // () → CookbooksStatus
  RESTART: 'cookbooks-lab:restart',   // () → CookbooksStatus
  CATALOG: 'cookbooks-lab:catalog',   // () → CookbooksCard[]
  OPEN:    'cookbooks-lab:open',      // { itemId: string; newCopy?: boolean } → { copyId: string; document: CookbooksDocument }
  DOCUMENT:'cookbooks-lab:document',  // { itemId: string } → CookbooksDocument
  RUN:     'cookbooks-lab:run',       // { itemId: string; code: string; index: number } → CookbooksRunResult
  RUN_ALL: 'cookbooks-lab:run-all',   // { itemId: string; cells: { index: number; source: string }[] } → { cells: CookbooksRunCell[] }
  SAVE:    'cookbooks-lab:save',      // { itemId: string; index?: number; source?: string; text?: string } → void
  RESET:   'cookbooks-lab:reset',     // { itemId: string } → void
  STATUS_CHANGED: 'cookbooks-lab:status-changed',  // push: CookbooksStatus
}
```

DTO (в `apps/electron/src/shared/cookbooks.ts`; main маппит snake/camel ответы сайдкара в эти формы):

```ts
export interface CookbooksCard { id: string; title: string; vendor: string; kind: 'ipynb' | 'md'; secretsHave: string[]; secretsMissing: string[]; disabled: boolean; disabledReason: string | null }
export interface CookbooksOutput { text: string; traceback: string | null }
export interface CookbooksCell { cellType: 'code' | 'markdown'; source: string; outputs: CookbooksOutput[] }
export interface CookbooksDocument { itemId: string; kind: 'ipynb' | 'md'; title: string; supported: boolean; missing: string[]; cells: CookbooksCell[]; text: string | null }
export interface CookbooksRunResult { ok: boolean; stdout: string; error: string | null; timedOut: boolean; missing: string[] }
export interface CookbooksRunCell { index: number; status: 'ok' | 'error' | 'skipped'; stdout: string; error: string | null }
```

Правила: все data-вызовы — только при `state==='running'` (иначе типизированная ошибка `CookbooksApiError{status:0,message:'runtime not running'}`); ошибки сайдкара пробрасываются как `CookbooksApiError { status: number; message: string }` (текст сайдкара — как есть, честно); renderer никогда не получает ни URL, ни токен (инвариант ужесточается: ни одно поле IPC не содержит подстроку `token=` или `http://`).

**Renderer (замена §Renderer registration п.9):** страница `CookbooksSurfacePage` строит нативный UI в токенах ROX: двухпанельная компоновка (каталог слева, документ справа), карточки каталога (title, vendor, kind-пилюля, чипы ключей, disabled-причина), документ: шапка (title, kind, действия «Запустить всё»/«Сбросить к оригиналу»/«Новая копия», статус), ячейки (textarea исходника `aria-label`, «Запустить»/«Сохранить», `pre` вывода с `data-status` и подписью), плейбук (one textarea + «Сохранить»), баннер недостающих ключей (интерполяция `{{keys}}`), компактная справка `<details>`. Клиентская фильтрация каталога по вводу (13 позиций, без бэкенд-поиска). Все строки — `t()`; стиль — только токены.

**i18n round 2 (ключи, ru/en авторитетны, значения — в таблице ниже):** `cookbooks.catalog.count`, `cookbooks.catalog.filterPlaceholder`, `cookbooks.card.kindNotebook`, `cookbooks.card.kindPlaybook`, `cookbooks.card.keysHave`, `cookbooks.card.keysMissing`, `cookbooks.card.fileMissing`, `cookbooks.actions.run`, `cookbooks.actions.runAll`, `cookbooks.actions.save`, `cookbooks.actions.reset`, `cookbooks.actions.newCopy`, `cookbooks.reset.confirm`, `cookbooks.output.hint`, `cookbooks.output.empty`, `cookbooks.output.skipped`, `cookbooks.status.running`, `cookbooks.status.cellOk`, `cookbooks.status.cellError`, `cookbooks.status.runAll`, `cookbooks.status.saved`, `cookbooks.status.cellSaved`, `cookbooks.status.opened`, `cookbooks.status.newCopy`, `cookbooks.status.reset`, `cookbooks.missingKeys`, `cookbooks.cell.sourceLabel`, `cookbooks.cell.outputLabel`, `cookbooks.playbook.textLabel`, `cookbooks.help.title`, `cookbooks.help.cookbook`, `cookbooks.help.copy`, `cookbooks.help.run`, `cookbooks.help.secrets`, `cookbooks.help.reset`, `cookbooks.help.timeout` (36 новых; ранее добавленные 10 — остаются).

| Ключ | ru | en |
|---|---|---|
| cookbooks.catalog.count | Кукбуков: {{count}} | Cookbooks: {{count}} |
| cookbooks.catalog.filterPlaceholder | Поиск: тема, вендор, название | Search: topic, vendor, title |
| cookbooks.card.kindNotebook | ноутбук | notebook |
| cookbooks.card.kindPlaybook | плейбук | playbook |
| cookbooks.card.keysHave | ключ есть | key present |
| cookbooks.card.keysMissing | нет ключа | key missing |
| cookbooks.card.fileMissing | файл не найден | file missing |
| cookbooks.actions.run | Запустить | Run |
| cookbooks.actions.runAll | Запустить всё | Run all |
| cookbooks.actions.save | Сохранить | Save |
| cookbooks.actions.reset | Сбросить к оригиналу | Reset to original |
| cookbooks.actions.newCopy | Новая копия | New copy |
| cookbooks.reset.confirm | Сбросить копию к оригиналу? Правки будут потеряны. | Reset the copy to the original? Your edits will be lost. |
| cookbooks.output.hint | Вывод появится после запуска ячеек | Output appears after you run cells |
| cookbooks.output.empty | (пусто) | (empty) |
| cookbooks.output.skipped | (пропущено) | (skipped) |
| cookbooks.status.running | выполняется… | running… |
| cookbooks.status.cellOk | Ячейка {{index}}: успешно | Cell {{index}}: success |
| cookbooks.status.cellError | Ячейка {{index}}: ошибка | Cell {{index}}: error |
| cookbooks.status.runAll | Запущено {{count}} ячеек: {{ok}} успешно · {{failed}} с ошибкой · {{skipped}} пропущено | Ran {{count}} cells: {{ok}} ok · {{failed}} failed · {{skipped}} skipped |
| cookbooks.status.saved | Сохранено | Saved |
| cookbooks.status.cellSaved | Ячейка {{index}} сохранена | Cell {{index}} saved |
| cookbooks.status.opened | Открыто | Opened |
| cookbooks.status.newCopy | Новая копия | New copy |
| cookbooks.status.reset | Сброшено к оригиналу | Reset to original |
| cookbooks.missingKeys | Не хватает ключей ROX: {{keys}}. Добавьте их в ROX и запустите ячейку заново. Не вставляйте ключи в ноутбук. | Missing ROX keys: {{keys}}. Add them in ROX and rerun the cell. Do not paste keys into the notebook. |
| cookbooks.cell.sourceLabel | Исходник ячейки {{index}} | Cell {{index}} source |
| cookbooks.cell.outputLabel | Вывод ячейки {{index}} | Cell {{index}} output |
| cookbooks.playbook.textLabel | Текст плейбука | Playbook text |
| cookbooks.help.title | Справка | Help |
| cookbooks.help.cookbook | Кукбук — вендорский ноутбук или плейбук из каталога; каталог доступен только для чтения. | A cookbook is a vendor notebook or playbook from the catalog; the catalog is read-only. |
| cookbooks.help.copy | Личная копия — ваша рабочая копия; правки сохраняются в неё, оригинал не меняется. | A personal copy is your working copy; edits are saved into it and the original stays untouched. |
| cookbooks.help.run | «Запустить всё» выполняет ячейки по порядку в одном процессе; при ошибке выполнение останавливается. | “Run all” executes cells in order in one process; on error it stops. |
| cookbooks.help.secrets | Ключи ROX подставляются в окружение ядра и маскируются в выводе; в ноутбук ничего не записывается. | ROX keys are injected into the kernel environment and masked in output; nothing is written into the notebook. |
| cookbooks.help.reset | Сброс возвращает копию к оригиналу каталога; правки теряются. | Reset returns the copy to the catalog original; edits are lost. |
| cookbooks.help.timeout | Тайм-аут ячейки — 60 секунд. | Cell timeout is 60 seconds. |

## Implementation Decisions (seams)

1. **IPC-неймспейс — существующий RPC-слой → `RPC_CHANNELS.cookbooksLab`** (`packages/shared/src/protocol/channels.ts`, рядом с `browserPane`/`extensionSurface`), классификация в `packages/shared/src/protocol/routing.ts` (`LOCAL_ONLY_CHANNEL_LIST` — все каналы локальные, привязка к 127.0.0.1-процессу), методы в `ElectronAPI` (`apps/electron/src/shared/types.ts`), записи в `apps/electron/src/transport/channel-map.ts` (точечные ключи `invoke(...)`), регистрация хендлеров — новый `apps/electron/src/main/handlers/cookbooks.ts` + строка в `apps/electron/src/main/handlers/index.ts`. Почему: это единственный существующий слой каналов; exhaustiveness-тест `routing.ts:4-8` сам поймает забытую классификацию.
2. **Супервизор — адаптация `ServerSupervisor`** (`apps/electron/src/main/server-host.ts:47-136, 153-322`) в новый `apps/electron/src/main/cookbooks-runtime.ts`: те же состояния/бэкофф/парсинг stdout, но: свой парсер строки, без `app.relaunch` при give-up, graceful-stop = SIGINT (POSIX). Почему: паттерн уже проверен на носителе сервера; изобретать второй супервизор запрещено.
3. **[ОТМЕНЕНО Amendment 1 — не реализуется]** **Вид — собственный минимальный менеджер `apps/electron/src/main/cookbooks-view.ts`** по образцу `extension-surface`/`browser-pane-manager` (`createEmbeddedInstance` семантика), но: единственный синглтон-вид на окно, партиция `persist:cookbooks-lab`, навигационный allowlist по origin текущей сессии, `setWindowOpenHandler → deny`, `setPermissionRequestHandler → deny`. Почему не переиспользовать `browser-pane-manager` целиком: у него браузерная семантика (история/cookies/попапы как панели), для лаборатории это лишний риск.
4. **Рендерная поверхность — существующий pattern «нативная поверхность»** (routes → parser → types/guard → route-pages → MainContentPanel → panel-stack → SurfaceTabs → primary-nav → glyphs). Точные шаги — §Renderer registration. Почему: соответствие 9 существующим поверхностям; fallback «route-unavailable» (`MainContentPanel.tsx:937-956`) обязан не срабатывать.
5. **[ОТМЕНЕНО Amendment 1 — mount/bounds не используются]** **Bounds — существующий хук** `apps/electron/src/renderer/hooks/useNativeSurfaceBounds.ts:11-77` (передаём наш `setBounds`; rect-тип — тот же, что принимает `browserPane.syncBounds`, не изобретать новый). Почему: аренда/скрытие/overlay-сброс уже решены там.
6. **Флаг — kill-switch в существующем реестре** `packages/core/src/platform/workbench/flags.ts`: `cookbooksV1: 'cookbooks.v1'` + `WORKBENCH_FEATURE_FLAGS` запись `{ defaultValue: true, dependencies: [], rollbackSafe: true }`. Гейт — `shellFlag` пункта навигации (как `developers`/`playbooks` `primary-nav.ts:129-130`). Почему: рубрика «каждый флаг — решение»; выключение = поверхность исчезает без правок кода.
7. **i18n — только через `t()`**, ключи `cookbooks.*` + `sidebar.cookbooks` в 12 локалях (`packages/shared/src/i18n/locales/*.json`), ASCII-сортировка (`bun scripts/sort-locales.ts --check`). Почему: `validate:ci` гейты.
8. **Вендоринг — снапшот в `apps/electron/resources/cookbooks/` + запись в упаковку**: `apps/electron/resources/AGENTS.md` (таблица «Other Files» — новый раздел) и убедиться, что `apps/electron/electron-builder.yml` включает `resources/cookbooks/**/*` (по образцу строки `resources/scripts/**/*`, yml:47) **и** `scripts/copy-assets.ts` копирует каталог в `dist/resources/` (проверить фактически; при исключающем списке — добавить). Почему: `getBundledAssetsDir()` — единственный runtime-контракт путей.
9. **Выключение — `performQuitCleanup()`** (`apps/electron/src/main/index.ts:2365-2478`): остановка рантайма (`stopAll()`), идемпотентно. Почему: единственная гарантированная точка quit-цикла.

## Data & API contracts

### Discovery-строка (заморожена)

```
http://127.0.0.1:<port>/lab.html?token=<token>
```

```ts
// apps/electron/src/shared/cookbooks.ts (новый; единственный общий модуль контракта)
export type CookbooksState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'
export type CookbooksFailureReason =
  | 'python-missing'   // интерпретатор не найден ни в одном источнике
  | 'spawn-failed'     // spawn бросил или процесс умер до ready-строки (pre-ready, попытки исчерпаны)
  | 'ready-timeout'    // строка не пришла за preReadyTimeoutMs
  | 'crashed'          // > maxCrashes падений после готовности
export interface CookbooksStatus {
  state: CookbooksState
  reason: CookbooksFailureReason | null
  port: number | null      // заполнен только в 'running'; ТОКЕНА ЗДЕСЬ НЕТ И НЕ БУДЕТ
}
export interface CookbooksStartup { port: number; token: string; url: string } // main-only; url — полный
export function parseCookbooksStartupLine(line: string): CookbooksStartup | null
// isAllowedCookbooksNavigation — ОТМЕНЕНО Amendment 1 (навигационный allowlist вида удалён вместе с видом)
```

Правила парсера: строка целиком матчится `^http://127\.0\.0\.1:(\d{1,5})/lab\.html\?token=([A-Za-z0-9_-]{24,})$`; порт 1–65535 (иначе `null`); при нескольких матчах в буфере — первый; ничего не логируется. *(Навигационный валидатор вида — ОТМЕНЕНО Amendment 1.)*

### Состояния и тайминги (заморожены)

```
idle → starting → running → stopping → stopped
        starting ↺ (backoff) ... ≤ maxCrashes
starting|running → failed(reason)
failed|stopped → starting (только ручной restart())
```

`preReadyMaxAttempts=2`, `preReadyTimeoutMs=10_000`, `readyTimeoutMs=30_000` (повторные ready), `backoffBaseMs=500`, `backoffMaxMs=30_000`, `stableAfterMs=60_000`, `maxCrashes=5`, `shutdownGraceMs=5_000`, `killHardTimeoutMs=2_000`, health-poll `GET /lab.html` каждые 300 мс (дедлайн = соответствующий timeout). Все значения инъектируемы (тесты).

### Резолв Python (порядок заморожен)

1. Managed: резолвер тулчейна (`packages/shared/src/toolchain/resolver.ts:97` — `findExecutable('python3')`; использовать существующий API, не хардкодить пути).
2. `process.env.UV_PYTHON` (если файл существует и исполняем).
3. `python3` в `PATH` (поиск по `PATH`-сегментам).
4. Не найдено → `failed(python-missing)` без спавна (страница покажет `cookbooks.pythonMissing.*`).
Минимум для сайдкара — 3.9 (проверено: лаборатория работает на 3.9.6). Запуск клеток требует ≥3.11 — это внутренняя честная ошибка лаборатории, не гейт резолвера.

### Спавн (заморожен)

- Аргументы: `[ /*python*/ '-u', <resources>/cookbooks/scripts/serve_lab.py, '--workspace', <configDir>/cookbooks/workspace ]`.
- cwd: `<resources>/cookbooks/`.
- env — allowlist: `PATH` (через `withToolchainPathPrefix`), `HOME`, `TMPDIR`, `LANG`, `LC_ALL`; больше ничего. Секреты/`ROX_*` не пробрасываются (блок-лист `packages/core/src/env/blocked-subprocess-env.ts:14-38` не ослабляется).
- stderr: кольцо ≤ 8 КиБ; перед логированием редакция `token=[^\s&]+` → `token=***`; stdout не логируется целиком, только распознанная строка → только `127.0.0.1:<port>`.

### IPC (заморожены имена)

```ts
RPC_CHANNELS.cookbooksLab = {
  ENSURE:      'cookbooks-lab:ensure',       // () → CookbooksStatus   (идемпотентно; резолв+спавн при необходимости)
  STATUS:      'cookbooks-lab:status',       // () → CookbooksStatus
  RESTART:     'cookbooks-lab:restart',      // () → CookbooksStatus   (stop+ensure)
  // MOUNT/SET_BOUNDS/UNMOUNT — отменены Amendment 1 (актуальный контракт — §Amendment 1).
  STATUS_CHANGED: 'cookbooks-lab:status-changed', // push: CookbooksStatus
}
export interface ElectronAPI { /* … */ cookbooksLab: {
  ensure(): Promise<CookbooksStatus>; status(): Promise<CookbooksStatus>; restart(): Promise<CookbooksStatus>
  // mount/setBounds/unmount — отменены (Amendment 1); data-plane каналы — в §Amendment 1.
  onStatusChanged(cb: (s: CookbooksStatus) => void): () => void
} }
```

Все каналы — `LOCAL_ONLY`. Инвариант: ни одно поле IPC-контракта не содержит токен или полный URL (тест). *(SurfaceRect/mount-часть отменены Amendment 1.)*

Поведение data-plane (реакция на уход из `running`, типы ошибок) — по §Amendment 1; mount-поведение отменено.

### Renderer-состояния страницы (заморожены)

```ts
type CookbooksPageUi =
  | { kind: 'starting' }                                  // idle|starting; заголовок+хинт, спиннер
  | { kind: 'ready' }                                     // running; нативный UI (§Amendment 1)
  | { kind: 'unavailable'; reason: 'python-missing' }     // заголовок+хинт+«Повторить»
  | { kind: 'failed' }                                    // failed (кроме python-missing) + «Повторить»
  | { kind: 'stopped' }                                   // stopped; «Повторить»
```
«Повторить» = `restart()`; «Обновить» (в шапке состояния ready — опционально, если вписывается в дизайн поверхности; обязателен только один контрол в ready — допустимо без шапки) — не обязателен. Запрещено: пустой экран, спиннер без текста, мёртвая кнопка.

### i18n-ключи (заморожены значения ru/en; 10 ключей)

| Ключ | ru | en |
|---|---|---|
| `cookbooks.action.refresh` | Обновить | Refresh |
| `cookbooks.action.retry` | Повторить | Retry |
| `cookbooks.failed.hint` | Локальный процесс лаборатории остановился. Нажмите «Повторить» — мы перезапустим его. | The local lab process stopped. Press Retry to restart it. |
| `cookbooks.failed.title` | Среда кукбуков не запустилась | The cookbooks runtime did not start |
| `cookbooks.pythonMissing.hint` | Кукбукам нужен Python 3.9+. Установите Python или переустановите ROX и нажмите «Повторить». | Cookbooks need Python 3.9+. Install Python or reinstall ROX, then retry. |
| `cookbooks.pythonMissing.title` | Не найден Python | Python not found |
| `cookbooks.starting.hint` | Запускаем локальную среду ноутбуков. Это займёт пару секунд. | Starting the local notebook runtime. This takes a moment. |
| `cookbooks.starting.title` | Готовим кукбуки… | Preparing cookbooks… |
| `cookbooks.title` | Кукбуки | Cookbooks |
| `sidebar.cookbooks` | Кукбуки | Cookbooks |

Остальные 10 локалей — перевод по смыслу (en/ru авторитетны); ключи в каждой локали в ASCII-порядке. Если panel-stack требует отдельный label-ключ для вкладки — переиспользовать `cookbooks.title` (не плодить новый).

## Testing Decisions

RED-first (тест пишется до реализации, падение фиксируется):

1. `apps/electron/src/main/__tests__/cookbooks-runtime.test.ts` (новый; prior-art — тесты супервизора рядом, искать `__tests__/server-host*.test.ts`, иначе `packages/server-core/src/knowledge/__tests__/`): парсер строки (валид/мусор/чужие host/схема/порт/токен-набор), запрет токена в статусе и логах (редакция stderr), машина состояний с инъектированным fake-спавном (ready → running; таймаут → failed(ready-timeout); 5 крашей → failed(crashed); restart из failed), бэкофф-арифметика, stop-последовательность SIGINT→grace→kill.
2. `apps/electron/src/main/__tests__/cookbooks-sidecar.integration.test.ts` (новый): **реальный** спавн вендоренного сайдкара найденным Python: ready-строка распарсена; `GET /lab.html` → 200; `GET /catalog` без токена → 401, с `Authorization: Bearer` → 200 и 13 items; SIGINT → exit 0 в пределах 5 с. Если Python нет вовсе — `test.skip('python-not-found')` с честной причиной (локально обязателен зелёным).
3. `apps/electron/src/shared/__tests__/route-parser-cookbooks.test.ts` (новый; prior-art `route-parser-pages.test.ts`): round-trip `'cookbooks'` ↔ `CookbooksNavigationState`, guard, detail-вариант (если добавляется `cookbooks/{docId}` — только если поддержан; v1 — без параметра).
4. `apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` (новый): рендер всех 5 состояний из моков `window.electronAPI.cookbooksLab`; «Повторить» вызывает `restart()`; в DOM нет подстроки `token=`; a11y: у спиннера есть текст.
5. i18n — существующие гейты (`locale-parity`, `i18n-keys-coverage`, `lint:i18n:*`); новых тестов не требуется.

Храповик: новые пути не входят в `knownRed`; потолок не поднимается.

## File map

**Владелец E-main:**
| Путь | Действие |
|---|---|
| `apps/electron/resources/cookbooks/**` (src/rox_cookbooks/**, resources/cookbooks/**, scripts/serve_lab.py, scripts/electron_handshake_probe.py, PROVENANCE.md, ELECTRON-CONTRACT.md) | Create (вендор-снапшот) |
| `apps/electron/src/shared/cookbooks.ts` | Create (типы/парсер/валидатор) |
| `apps/electron/src/main/cookbooks-runtime.ts` | Create |
| `apps/electron/src/main/cookbooks-view.ts` | Не создаётся — отменено Amendment 1 |
| `apps/electron/src/main/handlers/cookbooks.ts` | Create |
| `apps/electron/src/main/handlers/index.ts` | Modify (+регистрация) |
| `apps/electron/src/main/index.ts` | Modify (+init, +stop в performQuitCleanup) |
| `apps/electron/src/shared/types.ts` | Modify (ElectronAPI.cookbooksLab, CookbooksNavigationState, isCookbooksNavigation, key-parser ветки) |
| `packages/shared/src/protocol/channels.ts` | Modify (+cookbooksLab) |
| `packages/shared/src/protocol/routing.ts` | Modify (+LOCAL_ONLY классификация) |
| `apps/electron/src/transport/channel-map.ts` | Modify (+7 записей) |
| `apps/electron/resources/AGENTS.md` | Modify (+раздел cookbooks) |
| `apps/electron/electron-builder.yml` (+`scripts/copy-assets.ts`, если требуется) | Modify (include resources/cookbooks) |
| `apps/electron/src/main/__tests__/cookbooks-runtime.test.ts`, `.../cookbooks-sidecar.integration.test.ts` | Create (RED-first) |

**Владелец E-ui:**
| Путь | Действие |
|---|---|
| `apps/electron/src/shared/routes.ts` | Modify (`view.cookbooks()`) |
| `apps/electron/src/shared/route-parser.ts` | Modify (union/prefix/parse/build) |
| `apps/electron/src/renderer/components/app-shell/route-pages.ts` | Modify (+loader `cookbooks`) |
| `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` | Modify (+ветка isCookbooksNavigation) |
| `apps/electron/src/renderer/atoms/panel-stack.ts` | Modify (PanelType `cookbooks` + mapping) |
| `apps/electron/src/renderer/platform/SurfaceTabs.tsx` | Modify (tabIcon) |
| `apps/electron/src/renderer/components/app-shell/primary-nav.ts` | Modify (+entry; shellFlag) |
| `apps/electron/src/renderer/platform/glyphs.ts` | Modify (концепт `cookbooks`; синхронно GLYPHS+GLYPH_NAMES) |
| `packages/core/src/platform/workbench/flags.ts` | Modify (флаг `cookbooks.v1`) |
| `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx` | Create |
| `apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` | Create (RED-first) |
| `apps/electron/src/shared/__tests__/route-parser-cookbooks.test.ts` | Create (RED-first) |
| `apps/electron/resources/release-notes/next.md` | Modify (+bullet) |

**Владелец E-i18n:**
| Путь | Действие |
|---|---|
| `packages/shared/src/i18n/locales/*.json` (12 файлов) | Modify (10 ключей каждый) |

## Renderer registration (точные шаги, порядок обязателен)

1. `routes.ts`: `view.cookbooks: () => 'cookbooks' as const` (рядом с `:210-211`).
2. `route-parser.ts`: литерал `'cookbooks'` в `NavigatorType` (`:119-131`), префикс в `COMPOUND_ROUTE_PREFIXES` (`:174-183`), ветка parse (`:711-720`-стиль) и build (`:945-948`).
3. `shared/types.ts` (E-main): `CookbooksNavigationState { navigator: 'cookbooks' }` + union + guard `isCookbooksNavigation` + ветки `parseNavigationStateKey`/`getNavigationStateKey` (round-trip держит тест п.3 Testing).
4. `route-pages.ts`: `cookbooks: () => import('@/pages/cookbooks/CookbooksSurfacePage')`; добавить `'cookbooks'` в `RAIL_SURFACE_ROUTES`, если список — для рельсовых поверхностей (свериться с комментарием рядом).
5. `MainContentPanel.tsx`: `lazyRoutePage` + ветка `if (isCookbooksNavigation(navState))`, рендер `<CookbooksSurfacePage />` (обёртка — как у соседних веток).
6. `panel-stack.ts`: `PanelType` + case в `getPanelTypeFromRoute`; `SurfaceTabs.tsx`: иконка в `tabIcon`.
7. `primary-nav.ts`: `{ id: 'cookbooks', linkId: 'nav:cookbooks', group: 'more', labelKey: 'sidebar.cookbooks', icon: GLYPHS.cookbooks, route: () => routes.view.cookbooks(), isActive: isCookbooksNavigation, shellFlag: WORKBENCH_FLAG.cookbooksV1, preload: 'cookbooks' }` (позиция — рядом с `playbooks`, `:130`).
8. `glyphs.ts`: концепт `cookbooks` (предложение: Lucide `BookOpen`), синхронно в `GLYPHS` и `GLYPH_NAMES`.
9. **[ОТМЕНЕНО Amendment 1]** Страница — нативный UI (§Amendment 1): `ensure()` на mount, подписка `onStatusChanged`, data-plane вызовы при `running`; mount/bounds не используются.

## Rollback strategy

- Точка отката: `origin/main @ c743d3ee1` (зафиксирована до волны; см. PLAN).
- Ветка-срез `feature/cookbooks-surface` — кандидат на самостоятельный откат; откат = `git revert -m 1 <merge-sha>` (force запрещён).
- Что остаётся после отката: `<configDir>/cookbooks/workspace/**` (личные копии пользователя) — данные не удаляются, поверхность исчезает; повторное включение вернёт копии.
- Миграций нет — откат данных не требуется.

## Out of scope

- Срез 2 «Secrets bridge» (`POST /store`): таблица маппинга lab-ключ → креденшел ROX, пуш по mount/focus; отдельный PR + security-ревью. Здесь только зарезервировано место в рантайме (метод `pushStore()` не создаётся в v1).
- Windows graceful-stop (v1 — `kill()`; ADR §4).
- Деплой/release (G7): канал desktop — release-пайплайны; агент доводит до PR/merge, публикация — по пайплайну/человеком (human checklist: подпись).
- Любые правки кода лаборатории — только её репозиторий; здесь — снапшот.

## Acceptance criteria (нумерованные)

1. `bun run typecheck:all` → 0 ошибок (машинный вывод приложен к PR).
2. `bun test apps/electron/src/main/__tests__/cookbooks-runtime.test.ts` → зелёный; тот же тест красный до реализации (RED evidence).
3. `bun test apps/electron/src/main/__tests__/cookbooks-sidecar.integration.test.ts` → зелёный на этой машине (реальный Python): ready-строка, `/lab.html` 200, `/catalog` 401/200, SIGINT exit 0.
4. `bun test apps/electron/src/shared/__tests__/route-parser-cookbooks.test.ts` и `apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` → зелёные; в DOM-разметке тестов нет `token=`.
5. `bun run lint:i18n:parity && bun run lint:i18n:sorted && bun run lint:i18n:coverage && bun run lint:i18n:budget` → все 4 зелёные.
6. `bun run lint:css` и `bun run lint:ui-tokens` → без новых нарушений (stylelint-гвард не ослаблен).
7. Вендоренный probe: `python3 apps/electron/resources/cookbooks/scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed`.
8. G5 smoke: `bun run electron:dev` → сайдбар «Ещё» → «Кукбуки» → каталог виден (скриншот с SHA ревизии в PR); закрыть приложение → `pgrep -f serve_lab.py` пуст.
9. Kill-switch: с выключенным флагом `cookbooks.v1` (workbench-flags.json) пункт навигации отсутствует; с включённым — присутствует (наблюдение + юнит `primary-nav` при наличии prior-art).
10. Ни в `apps/electron/src/renderer/**`, ни в `apps/electron/src/shared/cookbooks.ts` нет подстроки `token=` рядом со значением (тест/греп в PR).

## Further notes

- Инструменты на этой машине: `bun` — `/opt/homebrew/bin/bun` (1.4.2); Python для интеграционного теста — системный (`/usr/bin/python3`, 3.9.6) или managed; в проде — `getBundledAssetsDir()`+токенчейн.
- Рабочее дерево волны: `~/Projects/rox-worktrees/cookbooks-surface` (ветка `feature/cookbooks-surface` от `origin/main @ c743d3ee1`).
- Исполнители не коммитят и не запускают полные гейты; коммит/гейты/PR — лид (см. PLAN §Waves).
- Найденные флейки/расхождения среды — в PR как наблюдение (lane-process §7), не «чинить» молча.
