# PRD: «Cookbooks» — поверхность кукбуков в ROX desktop (программа `cookbooks-surface`)

- **Версия:** 1.0 (2026-10-14Z)
- **База ревизии:** `c743d3ee1` (origin/main)
- **Статус:** DRAFT → adversarial self-check пройден (см. §Самопроверка), на ревью критика
- **Связанные документы:** [SPEC](SPEC.md) · [PLAN](PLAN.md) · [DECISIONS](decisions/) · контракт сайдкара (вендорится): `apps/electron/resources/cookbooks/ELECTRON-CONTRACT.md`

## 0. Суть

Дать продукту первую фронтовую интеграцию **кукбуков** — вендорских ноутбуков (openai, anthropic, pinecone, weaviate, langfuse, langchain), каталог которых уже реализован внешней лабораторией (`rox-one/rox-cookbooks-notebooks`, локальный Python-сайдкар с loopback HTTP API). Кукбуки становятся штатной поверхностью ROX desktop: сайдбар → каталог → личная копия → запуск клеток, с честными состояниями и секретами только из хранилища продукта.

## 1. Верифицированное текущее состояние (всё проверено в этом дереве)

**Есть в коде продукта (переиспользуем):**

| Что | Где (файл:строки) |
|---|---|
| Нативная поверхность в `WebContentsView`: создание, sync bounds, destroy, навигационная политика | `apps/electron/src/main/browser-pane-manager.ts:2484-2627, 2634-2667, 4447-4495`; хук аренды rect — `apps/electron/src/renderer/hooks/useNativeSurfaceBounds.ts:11-77` |
| Паттерн «main спавнит локальный сайдкар и открывает его URL» | `apps/electron/src/main/open-design-runtime.ts:392-1050`; окно-обёртка `apps/electron/src/main/open-design-window.ts:102-129` |
| Валидатор loopback-URL (только `http://127.0.0.1|<[::1]>:<port>`, без creds) | `apps/electron/src/shared/open-design.ts:40-83` |
| Супервизор с discovery-строкой из stdout, состояниями и backoff | `apps/electron/src/main/server-host.ts:47-136, 153-322` |
| Managed-процесс с HTTP health-поллингом | `packages/server-core/src/knowledge/process-manager.ts:227-249` |
| Выключение приложения (единый cleanup-хук) | `apps/electron/src/main/index.ts:2365-2478` (`performQuitCleanup`) |
| Чтение креденшелов (только main) | `packages/shared/src/credentials/manager.ts:972-980`; `packages/shared/src/secrets/chain.ts:64-166` |
| Блок-лист env для дочерних процессов | `packages/core/src/env/blocked-subprocess-env.ts:14-38` |
| Резолвер Python (managed через uv) | `packages/shared/src/toolchain/resolver.ts:97`; `manifest-data.ts:195-209`; `UV_PYTHON` — `apps/electron/src/main/index.ts:278-290` |
| Реестр навигации и роутинг поверхностей | `apps/electron/src/renderer/components/app-shell/primary-nav.ts:63-132`; `shared/routes.ts`, `shared/route-parser.ts:119-131, 174-183, 711-720, 945-948` |
| Образец UI-поверхности «из коробки» | Playbooks: `renderer/pages/playbooks/PlaybooksHomePage.tsx`, диспетчер `MainContentPanel.tsx:715`, флаги `packages/core/src/platform/workbench/flags.ts:22-309` |
| Панель-вкладка поверхности | `apps/electron/src/renderer/atoms/panel-stack.ts:16, 141-171`; `platform/SurfaceTabs.tsx:52-68` |
| Глифы (единый словарь) | `apps/electron/src/renderer/platform/glyphs.ts:69-155` (+ тест синхронности) |
| i18n: 12 локалей, ru — дефолт, гейты | `packages/shared/src/i18n/locales/*.json`; `validate:ci` (`package.json:74`) |
| Дизайн-токены/фокус/плотность | `DESIGN.md`; `packages/ui/src/styles/tokens/*`; `.stylelintrc.cjs:29-58` |

**Есть во внешней лаборатории (вендорится сюда, ревизия — PROVENANCE):** Python-пакет `src/rox_cookbooks/` (10 модулей), `scripts/serve_lab.py` (спавнит `LabHost`, печатает одну строку `http://127.0.0.1:<port>/lab.html?token=<t>`), статичная страница `static/lab.html`, каталог `resources/cookbooks/` (13 позиций, 6 вендоров), probe `scripts/electron_handshake_probe.py` (12/12 на Python 3.9.6), контракт `docs/electron-integration.md`.

**Не существует в коде:** любые упоминания cookbooks/notebook/jupyter (grep по репо — только тексты скиллов gstack). Запусков Python из main-процесса сегодня нет ни одного; Python-скрипты продукта запускает агент через обёртки `apps/electron/resources/bin/*` (`exec "$CRAFT_UV" run --python 3.12 …`).

## 2. Проблема

Пользователь ROX не может открыть вендорские кукбуки из приложения. Лаборатория кукбуков живёт отдельным процессом вне продукта: её нужно вручную поднять, вручную пробросить токен/каталог, UI не связан с навигацией, темой, локалями и хранилищем секретов ROX. Дорого: каждая попытка «посмотреть кукбук» упирается в терминал и ручные шаги; продукт теряет оффлайн-ценность вендорского каталога.

## 3. Пользовательские истории

### 1. Кукбуки открываются из сайдбара и честно объясняют среду
Как пользователь desktop, я открываю «Кукбуки» из сайдбара, чтобы увидеть каталог, и получаю честный экран для любого состояния среды.
- [ ] В сайдбаре (группа «Ещё») есть пункт «Кукбуки» (`sidebar.cookbooks`), клик ведёт на маршрут `cookbooks`; пункт виден при включённом kill-switch флаге `cookbooks.v1` (по умолчанию включён).
- [ ] Пока идёт резолв Python/спавн сайдкара — состояние `starting` (заголовок + подпись из `cookbooks.state.*`), не пустой экран.
- [ ] Если Python (managed 3.12 или системный `python3 >= 3.9`) не найден — состояние `unavailable` с причиной `python-missing` и текстом, что сделать (переустановить ROX/установить Python), кнопка «Повторить» запускает перерезолв; ни спиннера, ни мёртвой кнопки.
- [ ] Если сайдкар упал 5 раз подряд — состояние `failed` с причиной и «Повторить»; авто-рестарты прекращены.
- [ ] После готовности — встроенный вид с каталогом: счёт карточек = 13 (данные `GET /catalog` сайдкара); кнопка «Обновить» перезапускает сайдкар.
- [ ] Все строки — через `t()`, ключи во всех 12 локалях (`ru` — дефолт), паритет/сортировка/покрытие зелёные.

### 2. Запуск клеток работает в живом сайдкаре и корректно умирает
Как пользователь, я открываю кукбук, запускаю клетку и вижу вывод — а когда закрываю приложение, процесс не остаётся висеть.
- [ ] Вид загружает `http://127.0.0.1:<port>/lab.html?token=<t>` как top-level `WebContentsView` (XFO: DENY это не блокирует); навигация вне `127.0.0.1:<port>` блокируется, `window.open` запрещён.
- [ ] Прогон клетки/«Запустить всё» в живом окне обновляет вывод/статусы (наблюдаемо: `pre.cellout` c `run-all ok`, статус «Запущено 1 ячеек…»).
- [ ] При выходе приложения процесс сайдкара получает SIGINT (POSIX) и завершается в пределах 5 с; `performQuitCleanup` останавливает рантайм идемпотентно. Windows: `kill()` без graceful (записано как ограничение v1).
- [ ] Убийство сайдкара извне (`kill -9`) приводит к рестарту с backoff 500 мс·2^n (кап 30 с), счётчик крашей сбрасывается после 60 с стабильной работы; состояние в UI обновляется push-событием без перезагрузки страницы.

### 3. Токен не покидает main-процесс
Как security-ревьюер, я подтверждаю, что bearer-токен сайдкара не утекает в renderer, DOM, логи и файлы.
- [ ] URL с токеном известен только `apps/electron/src/main/cookbooks-runtime.ts`; `ElectronAPI.cookbooks` не содержит полей с токеном или полным URL (проверяется тестом на подстроку `token=` в рендерных тип-модулях/каналах).
- [ ] Логи main не содержат подстроки `token=` (редакция на месте: печатается только `127.0.0.1:<port>`).
- [ ] Секреты (API-ключи вендоров) в v1 среза не передаются вовсе: клетки без ключей получают дружелюбную ошибку лаборатории; мост секретов — Срез 2 (описан в [SPEC](SPEC.md) §Secrets Bridge, реализуется отдельным PR).

### 4. Консистентность продукта
Как мейнтейнер, я вижу фичу, вписанную в существующие системы, а не рядом с ними.
- [ ] Флаг `cookbooks.v1` зарегистрирован в `packages/core/src/platform/workbench/flags.ts` (defaultValue `true`, rollbackSafe `true` — kill-switch: выключение скрывает пункт сайдбара и поверхность).
- [ ] Стиль — только токены (`var(--*)`), размеры — `--control-*`; `bun run lint:css`, `lint:ui-tokens`, `lint:i18n:*` зелёные; stylelint-гвард не ослаблен.
- [ ] Типы и сборка: `bun run typecheck:all` 0 ошибок; затронутые тесты и новые RED-first тесты зелёные; `knownRed` не вырос.
- [ ] В `apps/electron/resources/release-notes/next.md` добавлен пункт о новой поверхности.
- [ ] Документация: PRD/SPEC/PLAN/ADR лежат в `plans/cookbooks-surface/`; ERD-срез — в ADR (§Data model).

## 4. Функциональные требования по поверхностям

**Desktop UI (apps/electron, renderer):** пункт навигации, поверхность `cookbooks` с честными состояниями (`starting | ready | unavailable | failed`, плюс `stopped`), kill-switch флаг, i18n 12/12, вкладка в panel-stack, глубокая ссылка `cookbooks` (deep-link из main через `parseNavigationStateKey`).
**IPC (main↔renderer):** неймспейс `cookbooks` — `ensure/status/restart/mount/setBounds/unmount` + push `statusChanged`; все каналы LOCAL_ONLY; renderer получает только `{state, detail?, reasonCode?}` — без URL/токена; исключение — сам вид создаётся в main.
**Main (runtime):** вендоренный сайдкар (`apps/electron/resources/cookbooks/**`); резолвер Python (managed 3.12 → `UV_PYTHON` → `python3` из PATH); спавн `-u serve_lab.py --workspace <configDir>/cookbooks/workspace`; парсинг и валидация discovery-строки; health-poll `GET /lab.html`; рестарт-политика (backoff, кап крашей); stop в `performQuitCleanup`.
**Вендоренный сайдкар:** snapshot лаборатории (package + serve_lab.py + resources + static + probe) с `PROVENANCE.md` (sha256-манифест) и `ELECTRON-CONTRACT.md`; изменения лаборатории — только через её репозиторий, здесь — синк-команда в PROVENANCE.
**Не входит:** webui/viewer/CLI/server-поверхности; облачные запуски (`cloudRuns`); любые миграции workspace-service; изменения кода лаборатории.

## 5. Non-goals

- **Секретный мост** (POST /store из ROX-креденшелов) — Срез 2, отдельный PR: PRD описывает только v1-контракт «без секретов честно». Причина: security-чувствительный маппинг таксономий креденшелов — отдельная ревью-поверхность.
- **Запуск кукбуков в webui/облаке** — не в этом PRD; канал — `cloudRuns` (см. `plans/next-program/decisions/004-web-modes.md`).
- **Индексация каталога в глобальный поиск ROX** (`search_document`) — вне среза (нет требования; каталог — read-only снапшот).
- **Персистентная история запусков в БД продукта** — v1: журнал принадлежит лаборатории (файлы копий); таблицы workspace-service не добавляются (см. ADR §Data model).
- **Кросс-платформенный graceful stop** — v1: POSIX SIGINT; Windows — зафиксированное ограничение.
- **Публикация/подпись релиза** — ручной OPS-чеклист, вне агентского среза.

## 6. Метрики успеха

| Метрика | Как измеряется | Порог |
|---|---|---|
| Типы | `bun run typecheck:all` | 0 ошибок |
| Тесты | `bun test apps/electron/src/main/__tests__/cookbooks-*.test.ts` + затронутые наборы | зелёные; RED-first evidence в PR |
| i18n | `bun run lint:i18n:parity && lint:i18n:sorted && lint:i18n:coverage && lint:i18n:budget` | все 4 зелёные |
| Храповик | `scripts/test-baseline.json` | `knownRed` не вырос |
| Рантайм | `electron:dev` → поверхность «Кукбуки» → скриншот с SHA; `bun test` интеграционного теста сайдкара | каталог виден; процесс остановлен при quit |
| Сайдкар | вендоренный `electron_handshake_probe.py` | `[SUMMARY] 0 failed` |
| Готовность | лог main: время от mount до `ready` | наблюдaемо, < 5 с на этой машине (после прогрева — < 2 с) |

## 7. Риски

| Риск | Вероятность/влияние | Снижение |
|---|---|---|
| Разнородная Python-среда (нет 3.12 managed, нет `python3`) | С/С | Резолвер с цепочкой и `unavailable(python-missing)` + «Повторить»; тест на каждый исход |
| Токен утечёт в лог/renderer | В/В | Токен остаётся в main; тест на отсутствие `token=` в renderer-типах/каналах; редакция логов |
| CI-флейк интеграционного теста (Python отсутствует на ранере) | С/Н | Skip с причиной `python-not-found` только при полном отсутствии; локально тест обязателен (G5) |
| Размер вендоренного дерева | В/Н | Только runtime-файлы (без tests/docs лаборатории), ~200 КБ |
| Windows-специфика остановки | С/Н | Явное ограничение v1 в ADR и PR; `kill()` как деградация |
| Гонка с параллельными лейнами в `main/index.ts` | С/С | Минимальные точечные правки (2-3 строки) + `update-branch` перед merge |

**Hard stops:** нет. `gh` доступен (`agisota`, scopes `repo`, `workflow`); секретов сверх существующих не требуется; данные не разрушаются.

## 8. Открытые вопросы

Блокирующих нет. Все 16 вопросов контракта §7 закрываются инженерными решениями в [ADR](decisions/001-runtime-container-and-secrets.md) (стоп-класс ④ не задействован — юридических/продуктовых решений не требуется; секретный мост вынесен в отдельный срез со своим security-ревью).

## Состязательная самопроверка (5 проверок, результат)

1. **Может ли критерий пройти на пустом дереве?** Нет: истории 2–3 требуют реального спавна Python-сайдкара, валидной discovery-строки и живого HTTP-ответа `/catalog`; «спиннер»-заглушка критерий не проходит (состояния типизированы и наблюдаемы).
2. **История, закрываемая заглушкой?** История 1 усилена счётом 13 карточек из реального API и проверкой каждого honest-состояния отдельным тестом; история 4 — машинными гейтами (i18n/lint/typecheck), а не декларацией.
3. **Утверждения без пути?** Пройдено: §1 весь со `файл:строки`; §3 acceptance ссылаются на конкретные каналы/состояния из SPEC.
4. **Ломает ли PRD храповик/OPS?** Нет: новых красных не вводит, потолок не поднимает; подпись/публикация — human-checklist (§5).
5. **Найдётся ли реализация, удовлетворяющая PRD буквально и нарушающая SPEC?** Контракт закрыт в SPEC (имена каналов, типы состояний, пути, RED-тесты); «просто iframe» невозможен (XFO: DENY), «просто файл» невозможен (нужен процесс) — лазеек нет.

## Дальше

[SPEC](SPEC.md): решения-симы, контракты данных/IPC, карта файлов, RED-first тесты, rollback. ADR: [decisions/001-runtime-container-and-secrets.md](decisions/001-runtime-container-and-secrets.md) — контейнер вида, транспорт токена, discovery, shutdown, рестарт-политика, персистентность и ERD-срез.
