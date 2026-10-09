# Локальный контекст браузера (Browser Intelligence Pipeline) — 2026-10-09

Владелец: пользователь (заказчик). Исполнитель: агент-оркестратор + параллельные сессии.
Источник: интеграционная волна 2026-10-09 (пакет `@rox/browser-intel` + слой Electron).
Статус: фича в main + доводка поверхностей настроек/гейтов в этой волне.
Назначение: справочная записка — что это, где живёт код, какие данные и гейты.

## 0. Что это
- Локальный, включаемый по согласию конвейер: строит приватный когнитивный профиль пользователя из локальной истории браузера и подмешивает его агенту.
- Данные не покидают устройство: чтение только локальных хранилищ браузеров; наружу ничего не отправляется.
- Профиль инжектится в системный контекст OMP-агента как блок `<user_cognitive_profile>`.

## 1. Стадии конвейера (`packages/browser-intel/src/pipeline.ts`)
Порядок фиксирован; каждая стадия деградирует независимо, ошибки собираются в `PipelineResult.errors` (не исключение).
- `detect` — обнаружение установленных браузеров и корней профилей.
- `scan` — перечисление профилей (только `ok`/`running`; фильтр `profileIds`/`vendors`).
- `stage` — теневая копия БД профиля в песочницу (для залоченных запущенным браузером файлов).
- `hindsight` — форензик-движок Hindsight по каждому скопированному профилю → SQLite-таймлайн.
- `ingest` — разбор таймлайна и запись визитов/URL в центральную БД.
- `unfurl` — декодирование URL (в Worker Thread) → графы `unfurl_details`.
- `aggregate` — пересборка роллапов `timeline_daily/monthly/yearly`.
- `synthesize` — синтез слотов профиля + запись `user_cognitive_profile.txt`.
- Согласие проверяется в начале: без `consent` конвейер выходит, не касаясь ни одного файла браузера (и `runIntelligencePipelineIfConsented` возвращает `null`).

## 2. Где живёт код
- Пакет: `packages/browser-intel/src/`
  - `acquisition/{browserDetector,profileScanner,shadowCopy}.ts` — обнаружение, сканирование, теневое копирование.
  - `hindsight/{runner,bridge,parser}.ts` — запуск pyhindsight и разбор вывода.
  - `workers/{unfurlWorker,unfurlCore}.ts` — цикл декодирования URL и `worker_threads`-обвязка.
  - `insights/{aggregate,synthesis,cognitiveProfile}.ts` — метрики, слоты, рендер и кэш блока.
  - `db/{database,repositories,schema.sql}` — SQLite-хранилище; `types.ts`, `paths.ts`, `state.ts`, `url.ts`.
- Electron main: `apps/electron/src/main/browser-intel/index.ts` (рантайм, таймеры, воркер), `browser-intel/worker.ts` (entry воркера).
- IPC-хендлеры: `apps/electron/src/main/handlers/browser-intel.ts`.
- Renderer: onboarding `components/onboarding/BrowserIntelOptIn.tsx` и `BrowserIntelProgress.tsx`; настройки `pages/settings/PrivacySettingsPage.tsx` + `pages/settings/BrowserIntelSettingsSection.tsx`.
- Инжект в промпт: `packages/shared/src/agent/cognitive-profile.ts` (реестр провайдера + санитайзер), потребитель — `packages/shared/src/agent/omp-agent.ts` (`buildCraftContextPrompt`).

## 3. Данные на диске (`paths.ts`, каталог конфига ROX)
- `<config>/browser-intel.json` — согласие, `consentAt`, `lastRunAt`, `lastResult`, `error`, `revision` (атомарная запись, режим 0600).
- `<config>/cache/browser_staging/<slug>-<hash>/` — теневые копии профилей; копируются и спутники SQLite (`-wal`, `-shm`, `-journal`); потоки 1 MiB, лимит 512 МиБ на файл; удаление только внутри staging-root.
- `<config>/intelligence/intelligence.db` — WAL + `synchronous=NORMAL`, `busy_timeout=5000`; таблицы `browser_profiles`, `dim_urls`, `fact_visits`, `unfurl_details`, `timeline_daily|monthly|yearly`, `user_profile_slots`, `intelligence_meta`; DDL из `schema.sql` (пакуется `scripts/copy-assets.ts` в `dist/resources/browser-intel/`).
- `<config>/intelligence/user_cognitive_profile.txt` — готовый блок (атомарно, 0600); путь чтения без доступа к БД (лок-фри старт).
- Каталог конфига: `resolveConfigDir()` из `@rox/shared/config` — переопределяется `ROX_CONFIG_DIR` / `CRAFT_CONFIG_DIR`; иначе видимый `~/rox` в профиле при наличии, иначе скрытый каталог по умолчанию.

## 4. Согласие и UX
- Onboarding: чекбокс «Включить…» (`BrowserIntelOptIn`) + прогресс (`BrowserIntelProgress`); оптимистичная запись с откатом и повтором.
- Настройки → Приватность: секция `BrowserIntelSettingsSection` — тумблер согласия, «Индексировать сейчас», «Остановить индексацию», счётчики (профили/URL/визиты/слоты/размер БД), дата последнего запуска, список выученных слотов.
- Отзыв согласия: немедленно удаляет кэш профиля (`clearCognitiveProfileCache`) и прерывает идущий запуск (`cancelBrowserIntelRun`).
- Таймеры: отложенный первый запуск через **30 c** после старта, повтор каждые **6 ч** (оба `.unref()`); включение в онбординге планирует первый запуск в текущей сессии.

## 5. IPC
- Каналы `browserIntel:{getState,setConsent,getStats,getSlots,startRun,cancelRun,progress,stateChanged}` (`packages/shared/src/protocol/channels.ts`).
- Все помечены **LOCAL_ONLY** (`protocol/routing.ts`) — никогда не проксируются на удалённый сервер; доступ `localElectron`.
- `progress` и `stateChanged` рассылаются broadcast'ом (`{ to: 'all' }`) из подписки `onBrowserIntelEvent`, чтобы окна синхронизировались.
- Мост в renderer опциональный: каждая функция проверяется на существование; без `getBrowserIntelState` секция/шаг деградируют в ничего.

## 6. Троттлинг unfurl
- Батчи по **100** URL; фиксированный минимум **150 мс** между батчами.
- Адаптивный сон до целевой доли CPU **15%** одного ядра (`cpuMs * (1/s − 1)`), минимум 150 мс, потолок 5000 мс.
- Абсолютный `AbortSignal` учитывается и в цикле, и в sleep; воркер чтит `abort`-сообщение.

## 7. Гейты
- `typecheck:all` включает `packages/browser-intel` (`bun run tsc --noEmit`).
- `test:browser-intel` — `bun test packages/browser-intel` + тесты main-рантайма, handlers и секции настроек.
- `smoke:browser-intel-worker` — `build:main-worker` (esbuild → `dist/browser-intel-worker.cjs`), затем `node scripts/browser-intel-worker-smoke.mjs`: позитивный прогон воркера + негативный контроль (`workerData` с живым `DatabaseSync` синхронно бросает `DataCloneError`).
- `validate:dev` = typecheck + shared/connection-fabric/config-isolation/doc-tools + `test:browser-intel` + `smoke:browser-intel-worker`; `validate:ci` добавляет i18n parity/sorted/coverage.
- В `test:doc-tools` уже включён `test_hindsight_runner_smoke` (Python/pyhindsight).

## 8. Известные ограничения
- Синтез слотов сейчас **детерминированный**: конвейер не передаёт `SynthesisCompletion`, поэтому `synthesizeSlots` кладёт кандидатов `deriveSlotCandidates` и помечает результат `degraded: true` (модельный шов есть в API, но не подключён).
- Hindsight требует Python ≥3.11 + `pyhindsight` + `ccl_chromium_reader`; таймаут запуска 900 c; профиль без читаемого стора (Safari, только Crashpad) пропускается — это не ошибка.
- Точка инжекта: `getCognitiveProfileBlock()` вызывается при каждом спавне OMP; санитайз per-call (снятие control-символов, строки >400 символов отбрасываются, блок ≤8000 символов, нейтрализация wrapper-тегов) — недоверенный ввод.
- Метрики визитов — окно 30 дней; закладки считаются по всей БД; `stats` читаются через короткоживущее read-only соединение (отсутствующая БД → фолбэк).