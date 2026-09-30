# ROX: незавершённые работы и восстановление — 30 сентября 2026

Репозиторий: https://github.com/rox-one/rox-one. Срез первичного GitHub-аудита: 11:08 UTC; дополнительный срез: 12:11 UTC; свежий GitHub readback: 15:19 UTC. Исполнение восстановления и отдельные доказательства обновляются по мере доставки. Состояние программы не равно состоянию отдельного теста или PR.

## 1. Что обнаружено

| Направление | Реальное состояние на момент аудита | Остаток и владелец |
| --- | --- | --- |
| Основной репозиторий | Локальный и удалённый main совпадают: `f63294ba4fffa7238b46b24e918925a313ad0b12`, 99 коммитов с 28 сентября | Старое требование синхронизации main уже выполнено; сохранить пользовательские изменения |
| Единый остаток | 297 строк: 231 issue, 3 прежних PR, 52 Macro WP, 11 сквозных операций | 143 compound packages уже входят в эти строки; не прибавлять их повторно |
| Macro/Suite/Lark/Code Intelligence | Документы, планы и issues доставлены; реализация продолжается у существующего compound lead | Latest ledger:143 packages,130 `NOT_STARTED`,6 `IMPLEMENTATION_RUNNING`,7 `ROOT_INTEGRATION`; все143 fullDoD `NOT_VERIFIED` |
| September | 109 tasks, 489 требований, 464 ребра зависимостей; существующий native lead активно меняет working union | 21 `IN_PROGRESS`, 88 `NOT_RUN`; DATA/SHARED и полная платформенная приёмка не приняты |
| Cloud onboarding | Опубликованная среда `rox-one` реально исполняла проверки. Отдельный черновик `rox-one/rox-one` не сохраняется | Managed final450 проверен и очищен; новая общая UI + September + Compound интеграция подтверждена исполнителем в отдельной Cloud-ветке |
| Browser continuation | Прежняя сессия остановилась из-за недоступного незакоммиченного Mac working union | Снимок доставлен и независимо проверен в Cloud; новый native union опубликован в draft #1293, владелец продолжает свежий overlay |
| Projects roadmap / #1194 | Два старых локальных коммита сохранены; CAS/backup/границы хранения и actual UI queue исправлены и доставлены | Draft #1313, 28 pass; actor ACL, linked tasks/progress и native/restart DoD остаются открытыми |
| Voice / #1185–1186 | Сохранён commit `c6ac02d6`, но remote/PR не обнаружен; локальный overlay сохранён | Точный native звук/Stop/offline/consent, review и доставка у native integration owner |
| Mini / #1145; Channels / #1122; Team / #1123 | Незакоммиченные исходники существуют | Сверить действующих владельцев, интегрировать; потребуются реальные runtime, двухпользовательская доставка и ACL, persistence/recovery |

137 завершённых preflight-процессов не являются 137 реализациями. Реально запускались семь compound implementation workers: WP-01, WP-48, RS-ADM-01, RS-AUT-01, RS-DRV-01, RS-MSG-01, RS-MTG-01. Их exit0 и handoff не закрывают feature DoD.

В дополнительном снимке 12:11 UTC уже **249 открытых issues / 8 PR**. 18 новых issues — UTB epic #1295 и 17 задач #1296–1312; после этого доставлен runtime draft #1315. Первичные 231/3 и 297 строк — исторический реестр; новые задачи требуют отдельного reconciliation. GitHub assignees в дополнительном снимке пусты, но локальные/native владельцы существуют.

Свежий GitHub API snapshot15:19 UTC: **249 открытых issues /13 PR**. Он включает новые runtime/Compound/CI/UTB drafts; это состояние remote, а не количество unique product tasks. Активный native #1293 продолжает продвигаться; runtime1319 и общая Cloud integration привязывают проверки к собственным точным frozen revisions, без автоматической приёмки будущих изменений.

Live ledger readback в 13:01 UTC: compound ledger asOf11:54 имеет6 running markers /7 integration /130 notstarted, включая scoped native Wave0. Все семь explicit-dependency-ready implementation packages уже имеют launch receipts; у остальных130 нет пустого dependency list. Полная приёмка зависимостей пока не закрыта, поэтому очередные независимые writers запускаются после foundation/integration gates. September registry asOf12:31 сохраняет21partial/88notrun; DATA/SHARED freeze NOT_ACCEPTED. Оба native owner journals реально дописывались в12:59 UTC. Это действующая работа, хотя статусы отдельных внешних workers требуют reconciliation с их exit/report.

Повторное двойное чтение обоих ledgers в14:51 UTC:143compound по-прежнему130notstarted/6runningmarkers/7integration;109September —21partial/88notrun. FullDoD не принят. Compound ledger asOf14:14, September asOf14:08. В CMUX обнаружено более точное состояние compound: **Goal stalled**, хотя процесс продолжал существовать. Root выбрал единственную соответствующую terminal surface через поддерживаемый UI, отправил exact `/goal resume` и проверил **Pursuing goal**, journal `thread_goal_updated` statusactive в14:41:05 и новые command completions14:48. Footer и turn context подтверждают6.1SolUltra. Следующее поручение с проверенными PR refs, сохранением143/109/297 и требованием Ultra для новых workers записано как actual native user message14:46:20. Native assistant14:46:44 acknowledged продолжение всех143, проверку доставленных recovery PR отдельным integration gate и зависимость следующих пакетов от foundation acceptance. Последующие actual commands проверяли native IME/offline, strict response schema29/282 и WP48 trusted binding. Это подтверждает consumption и действующее продолжение; конкретные PR SHA ещё не приняты. September owner journal свежий14:41:40. Старые daemon queue receipts не выдаются за это новое native возобновление.

## 2. Восстановление, выполненное этой линией

### Cloud

В опубликованной среде подтверждено реальное исполнение в `/workspace/rox-one` на main `f63294ba`. UI selection и явные worker assignments — GPT-6.1 Sol Ultra; независимая root backend attestation недоступна. Git/HTTPS сеть, обе сборки, health/login/authenticated config/WebUI HTML и два цикла запуска/остановки прошли. Конфигурация среды, сеть, секреты и source не менялись; итоговый checkout чистый.

Baseline Cloud: 817 успешных тестов, 3 падения; WebUI 52 ошибки типов, server 8. Отдельный readiness API недоступен; текущая сеть проверена настоящими Git/HTTPS запросами. Эти ошибки воспроизводятся локально на том же source и являются дефектами baseline.

Проверка snapshot `0cc0402e` завершилась отдельно: **834 pass / 0 fail**, core/server types 0; WebUI 3 ошибки. Обе сборки прошли. Реальный сервер завершился до listening из-за обязательного `node:sqlite`, которого нет в Bun 1.3.14; HTTP/auth/restart для этого snapshot не выполнены. Это воспроизведённый runtime defect, а не сетевой отказ.

Две последующие отправки из Legacy-контекста получили `Unable to determine project root for task` без исполнения source. Возврат в Home/Work и reload исходного опубликованного onboarding восстановили textbox дополнительных изменений и видимый **GPT-6.1 Sol Ultra**; repeat exact `41918981` завершился с настоящими командами и отчётом. Отдельный Legacy canary застрял в auto setup; остановка запрошена, окончательный cancel receipt и выполнение core не подтверждены. Legacy composer для новой локальной задачи не доказывает модель его cloud worker.

Repaired-source Cloud `41918981` завершён в13:07 UTC: managed Linux, Bun1.3.14/Node24.19.0,1812 packages frozen install; **885 pass /0 fail /0 skip**, пять typechecks0, три buildPASS и built-server2/0/31. В13:10 UTC завершена дополнительная настоящая lifecycle проверка: **2 pass /81 assertions /24 из24 phases**, повторные login/HTML/WS после restart, оба SIGTERM exit0 без SIGKILL, endpoints недоступны после остановки. Собственные процессы остановлены, temp checkout удалён, исходный checkout чистый и неизменённый. UI модель SolUltra и явные назначения дочерних workers подтверждены; независимая backend attestation root model/effort инструментами не раскрыта. Эти расширенные проверки относятся к exact419; новый строгий repository helper с отрицательными already-exited controls проверен отдельно на final450, описанном ниже.

Последующая managed continuation на exact `45045490` завершена в14:45 UTC: реально повторены885/0, пять typechecks, три свежие сборки, **strict4/0/37** и дополнительный **2/0/81,24phases**; все четыре hosted jobs успешны. Hashes всех5336sourcefiles и двухgitlinks сверены, оригинальный checkout и lockfile неизменны, собственные процессы остановлены и временные данные удалены. Новый revision-bound отчёт опубликован в исходной Cloud-сессии, прежний сохранён. Этот turn запущен пользователем в той же опубликованной среде; root наблюдал execution и не создавал competing Cloud runtime writer.

Обычная новая Legacy задача «Run validation for core fix» завершилась capability refusal: actualmodel **GPT-5.6 Sol**, actualeffort через supported metadata не раскрыт, required6.1SolUltra не подтверждён. Она остановилась до repo access:0commands/0changes/0commit/0PR. Соседний Work composer показывает6.1SolLight для новой локальной задачи и не меняет уже выбранного Legacy Cloud worker. Поэтому обычный Legacy launcher не считается проверенным маршрутом6.1Ultra. Managed onboarding execution, модель дочерних workers и backend attestation остаются разными доказательствами. Доступные официальные интерфейсы Cloud описаны отдельно от Legacy в [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments).

Следующая уже существующая обычная Cloud-сессия «Validate core fix in rox-one environment» завершилась **PASS** на exact core01889b4: managedLinuxx86_64 `/workspace/rox-one`, Bun1.3.14/TS5.9.3, **817/0/3496,77files** и core types0, source/lock чистые до/после. Frozen install использовал `--ignore-scripts` и `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; это проверка core, а не packaged/native install. Execution metadata model/effort недоступны, поэтому success этой задачи подтверждает работоспособность обычного Cloud shell, но не attestation6.1Ultra. Root только прочитал существующий итог; требования модели для собственных workers остаются6.1SolUltra.

Свежая уже завершённая обычная Cloud-сессия «Run Linux validation for PR #1317» независимо прошла на exact final `bbb30156`: Linuxx86_64, pinnedBun1.3.14, frozen1812 `--ignore-scripts`/Electron download skip; **817/0/3496,77files**, core types0 и unchanged **validate:ci exit0** — восемь compiler contexts,248Bun/0,19Python/0, i18n parity/sort/coverage. Её предыдущая «Validate draft PR #1317» правильно остановилась до install/tests: required6cf не совпал с уже опубликованным docs-onlybbb. Retry привязан к actualbbb и завершён PASS. Отсутствующий pages worker явно skipped. Initial/final source и lock чисты; собственные temp/dependencies очищены; полный report сохранён outsidecheckout и показан в ответе. Original instruction этой отдельной задачи разрешала доступную модель; root только прочитал результат, не переносил её model waiver на своих исполнителей. Execution metadata модели/effort в report отсутствуют. Packaged/native install этим script-skipped result не принимается.

### Core

[PR #1292](https://github.com/rox-one/rox-one/pull/1292), head `01889b4a43a2ce4f730d3109b49750a0fbde4db8`:

- Общая проверка locator отвергает inherited/non-enumerable/accessor/symbol поля до чтения значений.
- Things использует согласованный clock; прежние двухаргументные callers сохраняют Date.now.
- Исправлены 13 core typecheck diagnostics через canonical normalization и верные discriminant guards.
- Queued meeting не может получить `receipt_verified`/`readback_verified`; обе ошибки воспроизведены до исправления и покрыты проверкой.
- Bun 1.3.14: **817 core tests pass, 0 fail**, TypeScript 5.9.3 core **0 diagnostics**. Независимый review: 60 focused pass, core typecheck и diff check проходят.

Полная WebUI/server/native/program приёмка этим PR не объявляется выполненной. Related hunks активного September source интегрируются его владельцем с сохранением attachment-level hardening и доменных дополнений.

### Доставка September для Cloud

Ветка [`wip/september-cloud-snapshot-20260930`](https://github.com/rox-one/rox-one/tree/wip/september-cloud-snapshot-20260930), commit `0cc0402e587a8162202485cbe7831c2c50e50667`.

463 changed/new/deleted paths сохранены в изолированной копии; два полных чтения и последующая проверка source совпали. Manifest SHA256: `3bfa0acb89d998d74ed7d85a487a1d92b0992dc829d7c932e98b0487df52ccfa`. Credentials, ignored dependencies/runtime и untracked hook cache исключены. Original checkout/index/branch не менялись. Remote SHA проверен после push.

Это WIP снимок, а не принятая integration/release revision. Позднейшие изменения native owner в него не входят. Отдельная Cloud проверка этого SHA завершена с описанным runtime defect; она владела отчётом, не application source.

Позднее действующий native owner опубликовал [draft #1293](https://github.com/rox-one/rox-one/pull/1293). Readback12:36: head `3ea573a052efda5df1dceef26731942b302565c7`, source revision `47f4e336aeb4c238b18871374d4101f4ada40bdb`, последующие commits evidence-only. Все4841selected committed source files соответствуют manifest финальных локальных gates. Receipt сообщает shared4902/12skip, server-core1498/8skip, Electron4198pass, native creation fixtures34pass и independentreview41pass; автор аудита прочитал receipts, не запускал полные suites заново.

Новый native creation path получает authenticated no-write plan, сохраняет main-owned encrypted outbox operation до canonical mutation, сверяет exact receipt и ACK той же operation; denied planning не fallback в legacywrite, disposed owner не продолжает asyncenqueue. Это исходная реализация и unit/runtime fixtures; **actual native UI acceptance новой creation path pending** после трёх разных CUA timeouts. Ранний actual own-name/Note create/edit/save/Quit/coldrestart/Reload и revision2receipt metadata относится к предыдущему пути и не переносится на новое создание. Private receipt body не decrypted аудитором. Полный109DoD, OS custody, offline/conflict/revoke, provider/iOS и compound serial integration остаются открытыми.

Действующий владелец позже доставил `c358bd0` (custody/Memory/budget source `c1c81e66`), затем **`07907f909838253eb011e4e27a510c4ba5b5a9df`** в14:41 UTC: native caller отгорожен от legacy session inventory; App.tsx, caller loader и его реальные тесты изменены, program acceptance сохранена. Текущий native receipt14:08 доказывает WS Memory authorization/restart/backup/archive и отдельную Notessave/restart/readback, но прямо оставляет **успешный provider/model-context turn pending**. OMP17.2.10 metadata показывает rox/modelrox/standard; реальный provider prompt при этой metadata проверке не отправлялся. Эти результаты не приписываются unchanged старому PR1230f328 и не закрывают actual новуюcreationUI.

### Roadmap

[Draft #1313](https://github.com/rox-one/rox-one/pull/1313), head `5a9bf9cafd7df367f6ac32102b80e777377da162`, main base. Реальная revision CAS по SHA содержимого, exclusive lock, stale/busy refusal, fail-stop corrupt backup, symlink fences вплоть до projects root. Actual ProjectInfoPage queue сохраняет более новый draft и не переносит ACK между scope; ошибка чтения не выглядит как Saving. **28 pass / 0 fail / 120 assertions**; независимый reviewer нашёл и проверил исправление двух дефектов. Baseline shared/Electron diagnostics не выросли. Remote SHA и PR body прочитаны обратно. #1194 остаётся OPEN: actor ACL, AI provenance, linked tasks/progress, native/restart и crash-lock recovery не приняты.

### WebUI bridge и SQLite

[Draft #1294](https://github.com/rox-one/rox-one/pull/1294), `5f0df2522346b50bbb67f5eb718e30c1bdfcd157`, поверх snapshot: optional Window host-control type перенесён в shared без изменения runtime guards, permissions или channels. WebUI 3→0 diagnostics; core/server 0 и два bridge tests проходят.

[Draft #1315](https://github.com/rox-one/rox-one/pull/1315), final head `4504549086016dc3b892d17e9855a71afc1925d8`, production repair `00f05761105c55f83fc7a8c744b094fd51379b2f`, base bridge. SQLite adapter выбирает существующий builtin Bun/Node, сохраняет SQL/schema/auth/path fences; import-only changes покрывают authority/journal, replica outbox, budget, occurrence ledger и readonly browser-profile handler. Pinned Bun 1.3.14: **47 pass / 0 fail / 511 assertions**, occurrence отдельно **4/0/10**; пять typechecks и три сборки проходят. Независимый review воспроизвёл и исправил retained-statement close и unsafe integer/binding defects, затем проверил Bun/Node22/26. Mac Bun readonly WAL без sidecars может отказать fail closed; writable durable stores reopen проходят, writable browser fallback не добавлен.

Сохранена история настоящих failures: `41918981` Mac ripgrep API403, `eb624e06` Node24 WebUI compiler heapOOM, `de91d31a` отдельный Vite build heapOOM. Исправления используют existing ephemeral GitHub token только для frozen install и scoped4096MiB Node heap для прежних compiler/build targets. Reviewer также нашёл weak graceful-stop branch: прежний helper принимал already-exited0/17 безSIGTERM. Final helper SHA256 `c02452b78951a13e58e0279191d2be895c7220ce62ab91cf4c8e28b6f9b75e68` требует live child+SIGTERM+exit0 и явную остановку restartedserver; actualalready-exited0/17 controls используют свежие private config aliases и отвергаются. На root preservedbuiltSQLiteserver **4/0/37**; восстановление старой branch делает controlsFAIL. Production adapter не изменён.

Final450: **все четыре hosted jobs успешны** — Ubuntu24.04.5/macOS15.7.9 ARM64 на [push36719929717](https://github.com/rox-one/rox-one/actions/runs/36719929717) и [PR36719936813](https://github.com/rox-one/rox-one/actions/runs/36719936813). Каждый выполнил frozen install, пять typechecks, **885/0/4086 assertions**, три настоящие сборки, strict built lifecycle **4/0/37** и source/lock cleanliness. PR checkout — synthetic merge `50cdfcc9c3920de6f3216a289aa466048b4e2aba` с проверенными parents bridge5f и450. Это принятое восстановление runtime данного стека; новый September source и полный native/DATA/SHARED DoD имеют отдельную приёмку.

Current-native port доставлен отдельно как [draft #1319](https://github.com/rox-one/rox-one/pull/1319) в `fix/september-sqlite-runtime-20260930`, base `feat/september-program-20260930`. Изолированные baseline3ea/902 и c358/914 проверки сохранены как история. Root review подтвердил9import-only changes, исправление копирования cross-runtime warning control, сохранение custody/Memory/budget producer hunks, type-only bridge и strict built helper. Независимый review повторил actual built4/0/37 без source drift. Initial head `8f302b209a6a372a0ff24305279432ab94b32b71` прошёл оба push jobs, но PR не мог сформировать merge checkout после нового native079 из-за двух spec/plan conflicts.

В isolated recovery выполнен обычный merge exact `07907f909838253eb011e4e27a510c4ba5b5a9df`, без rebase. Native App/caller loader/test и evidence registry сохранены byte-identical079; все15 проверенных runtime implementation files byte-identical8f. Docs сохраняют exact079 prefix и recovery addendum. Единственное workflow дополнение — существующий caller-session-loading test. Новые локальные gates: **919 pass /0 fail /7313 assertions /97 files**, пять types0, три build0, strictbuilt4/0/37. Root rebind57checks/openFindings0. Доставка merge revision и actual four hosted jobs требуют нового readback; old8f push не выдаётся за merge acceptance. Original active native checkout остаётся у исходного владельца.

### Main-based CI recovery

[Draft #1317](https://github.com/rox-one/rox-one/pull/1317), final delivered head `bbb30156a0758d1c00510e97eb6dc715c6b64fbe` — docs-only closeout, tested source `6cf191dd6abae67631e019f890498f19a83e6ea3`, source permissions revision `a7a2505c19327c7f9cb09ae8893dbbca76afe355`, main base `f63294ba`. Combined branch объединяет core repairs, исполнимые hosted macOS CI jobs и узкие canonical type repairs, сохраняя прежнюю команду `validate:ci`. Actual built HTTP/WS/auth/shutdown/restart test заменяет placeholder. Локально прошли восемь compiler contexts, shared/config/connection/doc/localization gates и unchanged `validate:ci`; supplementary WebUI types0 и три сборки прошли. Independent review исправил regression Responses registration и weak graceful-stop test; actual negative controls ловят обе прежние ошибки. Final source63file digest `66ac2a8543684f10a59252db735cb5f2891f4fb4665e8a2b3f273250db667b04` не изменился при closeout, Spec/Standards findings0.

Реальный hosted Electron compiler OOM потребовал scoped4096MiB heap в прежнем validate step. После исправления actual CI alias и lifecycle успешны на предыдущем `c648c885`; история сохранена. У final readonly6cf **все три scoped jobs SUCCESS**: [CI alias36727786871](https://github.com/rox-one/rox-one/actions/runs/36727786871), [PR lifecycle36727786878](https://github.com/rox-one/rox-one/actions/runs/36727786878), [push lifecycle36727779346](https://github.com/rox-one/rox-one/actions/runs/36727779346). Direct logs подтверждают248Bun/19Python/8compiler contexts и существующий conditional отсутствующего pages-worker; lifecycle4/0/37. CodeQL Actions analysis1867131828 exact6cf имеет0results/23rules/noerror; обе PR instances477/478 `fixed` после явного workflow-level `contents: read` в двух workflows. Commands/gates/env не изменены. Восстановление этих двух jobs не заменяет отдельную native/performance/toolchain приёмку.

На docs-only headbbb штатный automatic [CI alias36732393548](https://github.com/rox-one/rox-one/actions/runs/36732393548) и [PR lifecycle36732393427](https://github.com/rox-one/rox-one/actions/runs/36732393427) также SUCCESS. Remote head/base/body и source hashes прочитаны обратно. CodeQL contexts, включая Swift, успешны; внешний Vercel account по-прежнему blocked.

### UTB — новые единые таблицы

[Draft #1314](https://github.com/rox-one/rox-one/pull/1314), `a428eb42c5681adb15d97dcacc88ce45cef7e7a4`: UTB-01 contract/codec/availability, 13 additive files. Аудит действительно повторил **54/0 в Bun1.3.14 и Node22.23.2**, strict TS5.9.3 по реальному canonical implementation closure0 и exact `./bases` export; все25 прежних core exports сохранены. Полный core воспроизвёл те же13 baseline diagnostics, byte-identical mainf632, которые отдельно исправлены #1292/#1317. Browser thread завершился первым module и сообщил невыполненные downstream/native gates; acknowledged текущий executor UTB не обнаружен.

Programmatic adverse probe обнаружил, что `Object.keys` позволяет silent-drop неизвестных non-enumerable/symbol fields и hidden rows в строгом V1. Узкое inert-data codec/availability исправление доставлено в [draft #1318](https://github.com/rox-one/rox-one/pull/1318), source `4ba5f6d24cac480361fe0f8c3dede73687751ef4`, final docs-only head `8c1b8d95944cc21c4745484ba45edd0cf0afbb73`, base original1314a428.18RED checks воспроизвели54pass/18fail; после исправления **72/0 Bun1.3.14 и72/0 Node22.23.2**, canonical implementation closure/export types0. Mutation старого codec действительно возвращает14fail; baseline core13/shared17/Electron51 не вырос. Independent Spec/Standards review повторил72/0 и не оставил findings; remote head/base/body и source blobs сверены. Исходная PR1314 не меняется. BaseCRUD foundations ещё не приняты. **UTB-01 implemented/unit-verified, не integrated; остальные16 planned/not executed.** Persisted Base CRUD, unified production command/mount, CAS/idempotency, auth/ACL, downstream/native/restart/two-client gates открыты; #1296 не закрывается этим исправлением.

### Общая сборка UI + September + Compound

Исходная ветка верхнего header/one-surface — `factory/ship-rox-ui-shell-onesurface-86e136bd`: изменения вошли в main через `6e8daa2` / [#1041](https://github.com/rox-one/rox-one/pull/1041); расширенный левый rail без Views — `9d9c7e9` / [#1051](https://github.com/rox-one/rox-one/pull/1051). Эти исходники уже присутствуют в проверенной runtime450 ветке. Прежний HTML smoke не принимал фактическое отображение, навигацию или полноту всех поверхностей.

Новый запрос на итоговое приложение включает **UI + September + Compound**. В15:03 UTC Cloud исполнитель подтвердил состав и isolated checkout; merge-preview обнаружил28 conflicts, включая Notes/Projects/server authority. В15:12 UTC он подтвердил получение разрешения на необходимые source integration changes только в новой Cloud-ветке и отдельно acknowledged сохранение September authority/caller/encrypted outbox/receipt ACK, подключение Compound к этому пути и последующую интеграцию опубликованного SQLite результата без дублирования writer. Original `/workspace/rox-one` и активные Mac checkouts/branches сохраняются. Это действующий отдельный integrator с подтверждённым continuation, а не закрытая product acceptance.

Границы приёмки: exact remote revisions/merge parents, карта и semantic review конфликтов; единый Notes/authority writer с September encrypted durable outbox/receipt/custody/caller fence и Compound surfaces; реальные negative/restart tests. Нужны полный Electron target/type/build, actual WebUI header/sidebar/routes/states и screenshots/functionality, scoped auth/stop/restart/cold recovery, source-bound commit/push/draft/readback. Массовое ours/theirs не принимается. Mac/native/provider/iOS и полные143/109/UTB criteria сохраняют свои отдельные gates. Проверенные recovery refs переданы для интеграции; SQLite1319 writer выполняет свой merge независимо и не дублируется.

### Compound migration fence

Действующий compound owner доставил [draft #1316](https://github.com/rox-one/rox-one/pull/1316), head `8afd289ac9e7d0a07be98f33c98f7989c2bcb68d`, поверх `feat/rox-compound-workspace-20260930`. Это read-only inventory legacy Markdown commits: prepared/malformed/unreadable/unexpected journal states отказывают, descriptor no-follow и identity checks ограничивают open seam. Root независимо повторил **7/0/33** filesystem checks. `nativeActivationAllowed` всегдаfalse, модуль пока не wired. Canonical migration, private receipt custody, стабильный replay и разрешённое disposition legacy files остаются у общего single-writer integrator; этот draft их не объявляет выполненными.

## 3. Прежние PR и точные незакрытые gates

| PR | Head первичного аудита | Остаток |
| --- | --- | --- |
| [#1230](https://github.com/rox-one/rox-one/pull/1230) | `f32863be2d22945163fe17d76fc893f17c005fd0` | Реальный public standard gateway/runtime, успешный выбранный R1/Memory turn, restart; native Task→Note exact/missing/reopen; новый build последних dirty changes; installation; CI |
| [#1082](https://github.com/rox-one/rox-one/pull/1082) | `518636a6cb6c7c7331c3cf614e4182d92cb240df` | Настоящая Electron visual/navigation приёмка и packaged build; CI. Старый конфликт уже устранён |
| [#1087](https://github.com/rox-one/rox-one/pull/1087) | `2e444a1e7fb6165f61c09210904b0e6ca912e9e2` | Packaged native image operations, installed app и platform dependencies; CI. `bun.lock` уже присутствует |

Все три на момент аудита `MERGEABLE/UNSTABLE`, CodeQL successful, validate queued. Vercel сообщает **Account is blocked**. Это точная внешняя account prerequisite, которую исходники не исправляют.

Прежние CI jobs требуют `[self-hosted, macos-toolchain]`. Repo runners: 0; все 242 org runners offline, macos/toolchain labels отсутствуют. Рабочая линия восстановления CI использует стандартный GitHub-hosted macOS runner и настоящий built-server lifecycle gate. Native/performance/toolchain workflows сохраняют собственные triggers и gates; перенос двух jobs не доказывает все platform checks. Проверки нельзя заменять echo или фиктивным success.

## 4. Конкретные незавершённые дефекты из prior audit

- Tasks→Note: source перехода существует, но exact/missing/reopen проверка нового установленного build не завершена.
- Неактивная Note Table: checklist count/cache и conversion dirty fixes ещё не связаны с доставленным/native-verified revision.
- Wiki autocomplete/backlinks: escaped brackets finding открыт.
- Feed-first cold task mutation: canonical ACK/readback кандидат есть; настоящие cold/restart/failure сценарии открыты.
- Provider/model: unavailable-model fail closed проверен; успешный выбранный runtime turn ещё требуется.
- Imports: raw localization keys и denominator 10/12 locales требуют сверки.
- Graph PDF action: реальный export или честный unavailable UX не принят.
- Note PDF: giant checklist SVG/page break output не принят.
- Projects library: ErrorBoundary исправляется source/full records; installed/restart gate открыт.

## 5. Порядок продолжения

1. Существующие compound/native leads сохраняют единоличных владельцев общих source roots и сверяют очередь по фактическим результатам. Compound native goal реально возобновлён через UI; новое сообщение с recovery refs имеет native ingress и semantic ACK с последующей работой. Конкретные delivered PR revisions проходят отдельный integration gate. Старые CLI coordination receipts были stored-only: shared daemon сообщает owners notLoaded и не управляет их stdio executors. Не переносить подтверждение нового resume на старые queued messages.
2. Доставить и принять узкие baseline core, roadmap и bridge fixes; порты чужих candidate hunks делать отдельно от активного checkout.
3. Восстановить исполнимые CI jobs с настоящими checks; проверить удалённое исполнение на delivered revision.
4. Native lead интегрирует и проверяет свежий combined build, model/runtime roundtrip и Task/Note defects; публикует exact revision и persistence/recovery evidence.
5. DATA-01/#1212 и SHARED-01/#1160 проходят свои реальные gates; затем запускать dependency-ready packages из всех143/109 без повторного счёта или scope shrink.
6. Отдельно выполнить Linux/cloud, macOS/Windows native, Conation native iOS receiver, двухпользовательский/ACL и реальные provider сценарии. Отсутствующий target/credential/receiver должен иметь точную BLOCKED prerequisite, а не success.

Две latest Enterprise-v12 HTML ветки браузера дали новые демонстрации. Их source/version traceability до current requirements не подтверждена. Их локальные acceptance/results/capacity/organization функции требуют сверки с разрешённым PRD; сами HTML и тесты демонстрации не доказывают server/native/LLM integration.

Подробные приватные session/CMUX/browser доказательства сохраняются локально; в публичный репозиторий не публикуются личные conversation transcripts или history. Этот документ содержит project states и безопасные delivery refs.
