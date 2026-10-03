> Historical source evidence retained from PR1444. Current recovery and fresh bounded results are recorded in [current integration](../../integration-history/runtime-map-current-20261003/README.md); none of the following historical statuses qualifies the current head.

# Независимая проверка runtime map

Проверка W8 выполнена на Linux x64, Bun 1.3.14, Node 22, Chromium 131.0.6778.33. Исходники проверяемой интеграции: `40e97e70dcc7f0566a330ede3ebd96a1e2a4076e`, затем `9dc30a7f4` и исправление reconciliation `ed5b47a44`. Финальный hash и результаты повторного прогона добавляются после интеграции.

Классы результатов разделены намеренно. `unit` проверяет договор и обработку фактических входных данных. `renderer-e2e` запускает production `ChatDisplay`, `ChatRuntimeSplit`, `RuntimeMapDock`, canonical ingress и настоящий persistent `RuntimeTraceService` в изолированном стенде. Исполнитель событий явно детерминированный тестовый; shell запускается реально, платных provider запросов нет. Это не installed-app smoke и не доказательство исполнения native workers.

## Выполненные команды

В командах ниже `bun` — закреплённый Bun 1.3.14; `node` — Node из runtime. Standalone browser установлен из Playwright 1.49.1 без изменения dependencies/lockfile проекта.

| Команда | Класс | Exit | Результат |
|---|---|---:|---|
| `bun test packages/core/src/runtime-trace packages/server-core/src/sessions/runtime-trace apps/electron/src/renderer/event-processor/__tests__/runtime-trace-ingress.test.ts apps/electron/src/renderer/components/runtime-map/__tests__ apps/electron/src/renderer/lib/__tests__/runtime-trace-navigation.test.ts apps/electron/src/renderer/lib/capability-catalog.test.ts apps/electron/src/renderer/lib/starter-prompts.test.ts packages/shared/src/capabilities/packs.test.ts` | unit | 0 | 76 pass, 0 fail, 279 assertions; `independent-unit.log` |
| `bun test tests/e2e/runtime-map/journal-harness.test.ts` | unit + actual shell/journal | 0 | 2 pass, 0 fail, 20 assertions |
| `bun run scripts/bench/runtime-map.ts` | unit projection benchmark | 0 | 10 000 events, 20 agents, depth 2, 221 nodes; `projection-benchmark.json` |
| `python3 tests/e2e/runtime-map/native-environment-probe.py` | environment | 0 | AF_UNIX creation blocked EPERM; IPv4 loopback available; `native-environment.json` |
| `ROX_TEST_BUN=<bun> node node_modules/@playwright/test/cli.js test --config tests/e2e/runtime-map/playwright.config.ts` | renderer-e2e, production bundle | pending final rerun | Stream, permission/draft, welcome/suggestion, measured large graph |

`bun run test` общего проекта не является успешным gate этой волны. Координатор сообщил остановку automatic security review из-за незапрошенного обращения Context7 с непроверенным payload; полный прогон не повторяется и ограничение не обходится. Изолированные offline gates выполняются отдельно.

## Матрица R01–R30

`PASS(unit)` и `PASS(renderer)` обозначают ровно указанный класс доказательства, а не непроверенный installed-app/live-provider сценарий. `PARTIAL` сохраняет конкретный пробел. `BLOCKED` нельзя закрыть synthetic fixture или screenshots.

| ID | Статус | Выполненное доказательство | Ограничение / необходимая проверка |
|---|---|---|---|
| R01 | PASS(renderer), повторение ratio pending | Real ChatDisplay остаётся слева и mounted once; Dock справа; lower composer; stream video | Installed desktop отсутствует; исправление исходного 71/29 на 42/58 проверяется финальным assertion |
| R02 | PARTIAL(renderer) | Draft и attachment сохраняются при 3 close/open; pending permission не подтверждается; mount=1 | Credential prompt и исходная scroll позиция полного ChatPage отдельно не проверены |
| R03 | PARTIAL(renderer) | Dotted canvas, группы, light stream/dark permission screenshots | Архивные visual references не materialized; полный visual comparison и 1920/200% ещё не выполнены |
| R04 | PARTIAL(unit) | Typed original/effective snapshot fixture, collector сохраняет context snapshot; payload viewer читает отдельные части | Сопоставление с настоящим dispatch payload native child заблокировано R11 |
| R05 | PASS(unit), native PARTIAL | Unknown metrics не становятся 0; context occupancy использует подтверждённое input/window; observer readback проверяет identity | Live-provider модель и native child readback не подтверждены данным renderer стендом |
| R06 | PARTIAL(unit) | Manifest types/version/blocks сохраняются без text parsing; старые snapshots immutable | Полный captured provider manifest rules/memory/source/attachment всех native descendants требует R11 |
| R07 | PARTIAL(unit) | Manual launch real begin; typed launch identity есть в service | Отдельные real scheduled/channel executions не запускались |
| R08 | PASS(unit) | Real TaskRunner DAG test публикует dependencies; projection удерживает версии/tasks/replay | Runtime UI использует fixture DAG; installed workflow runner smoke отсутствует |
| R09 | PASS(unit) | Acceptance только от durable verification VERDICT; node completion не равен passed | Отдельный remote/live project check не запускался |
| R10 | PARTIAL(unit) | Collector parent/child identity, late run routing, renderer child aliases | Actual production spawn_session parent→child loop в renderer стенде не запускался |
| R11 | BLOCKED(native-fixture) | Закреплённый OMP 18.4.12 actual parent/task loop останавливается в NativeFileLock.tryAcquire EPERM | Требуется успешный native gate на среде с разрешёнными Unix sockets; fixture не является заменой |
| R12 | PARTIAL(unit) | Depth 2 typed assignment/native mapping; distinct run/agent identities и late generation проверены | Actual restricted grandchild permissions/model/context остаются блокированы R11 |
| R13 | PASS(unit/renderer) | Parent lane layout below root, source-time compatibility; renderer canvas lane output | Настоящие native parallel workers blocked R11 |
| R14 | PASS(unit) | Catalog availability/selection/recorded hits не превращаются в applied; high-risk packs не включаются автоматически | Actual provider emitting loaded/applied доступен только при соответствующих observations |
| R15 | PASS(unit + journal) | Actual collector inputs/results; huge result externalized; modelContent отдельно; bounded RPC reference | Реальный external MCP аккаунт не подключался |
| R16 | PARTIAL(unit + actual shell) | Real bash stdout=`fixture`, stderr=`fixture stderr`, exit=0; cancellation/late-output/retry projection tests; inert viewer scrub | Отдельный real nonzero/cancel process lifecycle в browser не запускался |
| R17 | PASS(unit) | Provider reasoning и summary не объединяются в вымышленную цепь; complete replacement; unknown honest | Live-provider reasoning не запрашивалось |
| R18 | PASS(unit) | Usage interim/final dedup, parent aggregate separate, clock domain/negative duration unknown | Нет заявлений о точных отсутствующих provider tokens/times |
| R19 | PARTIAL(unit/renderer) | Result виден одновременно в настоящем чате и Dock; old evidence refs map to correlated node | Полный artifact file readback от production agent не выполнен |
| R20 | PARTIAL(renderer) | 16 canonical journal events через SSE одновременно обновляют actual ChatDisplay и Dock; video | Полный ChatPage bidirectional event→scroll transition ещё не подтверждён этим изолированным mounting harness |
| R21 | PASS(unit), UI PARTIAL | Cancellation sticks after late output, retries retain failed attempt, queue/waiting distinct; pending permission toggles no responses | Credential/resume installed workflow не запускался |
| R22 | PASS(unit + real journal) | Actual collector instance restart; snapshot/cursor exact; torn/corrupt journal partial; legacy stored fields only | Installed app process kill/restart отдельно не выполнен |
| R23 | PASS(renderer/unit) | Opening/search/list filters не увеличивают starts/tool/provider calls; ingress shared readers no new subscriptions | Full workflow editor actions не входят в read-only map test |
| R24 | PARTIAL(code review) | Старый SessionWorkflowEditor остаётся и передаётся в explicit editor slot | Round-trip старых pins/branch documents не выполнен W8 |
| R25 | PASS(unit), visual PARTIAL | Actual temp store pack install/readback; partial mismatch не success; capability identity/filter tests | Catalog production route screenshot/multiselect smoke отсутствует |
| R26 | PASS(unit), live auth untested | Actual source config write/readback; failed/revoked/expired не connected; intersects category/transport/status | Сторонние аккаунты не подключались; real OAuth lifecycle без запроса пользователя не выполняется |
| R27 | PASS(renderer), theme PARTIAL | Existing ROX asset в actual empty ChatDisplay; grey suggestions над lower composer screenshot | Dedicated dark empty screenshot ещё не зафиксирован |
| R28 | PASS(renderer/unit) | Suggestion inserts draft, retains attachment, sends=0, provider=0; original text append idempotency test; hide while streaming | Standalone full App header-suggestion interaction не проверен |
| R29 | FAIL(renderer perf), PARTIAL(a11y) | Keyboard separator, narrow chat preservation, bounded 200-node window, huge payload paging; pan p95 16.8ms | Event→visible paint p95 превышал 150ms; reconciliation исправление перепроверяется; ~200 window nodes, только 2–3 DOM cards visible благодаря viewport culling |
| R30 | PASS(unit/journal), upgrade PARTIAL | Wrong workspace rejection, opaque refs/session ownership, traversal/tamper/symlink denial, nested credential scrub, stale snapshot generation | Full upgrade→rollback installed smoke/publication RPC separately not executed |

## Производительность и ограничения

`projection-benchmark.json` измеряет только core projection. Его p95 нельзя выдавать за renderer latency. Browser measurement начинается непосредственно перед canonical ingress; MutationObserver подтверждает видимый текст того же node, следующий animation frame фиксирует paint opportunity. Транспортная/SSE задержка в этот бюджет не входит. Pan frame timestamps снимаются во время реальных pointer moves по production ReactFlow.

Исправленный initial split ratio и flow reconciliation переданы владельцу W4; итоговая метрика должна заменить pre-fix числа только после повторного прогона. Финальный report сохраняет отсутствие macOS/Windows installed-app smoke и paid/live-provider checks. Native Unix lock EPERM не обходился; integrity guards, model readback и permission responses не менялись.

## Воспроизведение

1. Установить project dependencies закреплённым Bun согласно lockfile.
2. Установить browser из repo Playwright 1.49.1 (`node node_modules/@playwright/test/cli.js install chromium`).
3. Запустить приведённую Playwright команду. Она создаёт только временную test session, production renderer bundle под node_modules cache и loopback server.
4. `browser-results.json` и `browser-artifacts/` содержат raw results, screenshots, WebM и failure traces. Они не являются persisted credentials или user data.

Полная приёмка R01–R30 не заявляется, пока строки BLOCKED/FAIL/PARTIAL не закрыты координатором проверкой соответствующего класса.
