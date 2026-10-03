# R15: независимая managed Cloud проверка и интеграция

Source candidate: **`010fa8c040e3a84cd40cd8195473f52d8582f159`**.
Локальные gates, реальный browser и поставляемый Linux server завершены успешно в указанном ниже scope.
Все четыре hosted SQLite job exact010 также завершены SUCCESS; CodeQL остаётся FAILURE и требует triage.
Полная приёмка September109, Compound143, UTB, DATA/SHARED и native/provider/iOS не заявлена.
Изолированная ветка: `cloud/all-surfaces-20260930`, [draft PR #1322](https://github.com/rox-one/rox-one/pull/1322).
Этот docs-only receipt фиксирует tested source; publication SHA/readback записываются после commit отдельно. PR не merged.

## Зафиксированные входы и происхождение

| Вход R15 | Точный commit |
| --- | --- |
| Исходный main | `f63294ba4fffa7238b46b24e918925a313ad0b12` |
| September | `bac082301aed341fe078cb5bd539c4ba074560eb` |
| Compound | `3027028c6c8cb420efe3ea4b255ac725747de9e5` |
| Опубликованный SQLite owner, docs head | `bdd28272856be5fdead6c7a93ca1b45eb13b17ed` |

Начальные входы: September `ea083e387e170552ee6102e29c2cf31adc8b6973`,
Compound `8106f22185fb3b3e9a6a585320d48b1bf5f10fbd`.
Production SQLite импортирован из `da78e3e79f5c268a33fc429d2913e8b8d59adeac` отдельного owner;
новый adapter здесь не написан. UTB starter: `8c1b8d95944cc21c4745484ba45edd0cf0afbb73`.
Более поздние remote heads не включены автоматически.
Inherited one-surface/header: `55abb1a18b21779ee765bb10e30798301aa424cb` → `6e8daa29fdfc4a8a4e09fdf8f5c194ce1b3a9446`;
expanded rail `9d9c7e90e13777181f84d7e18353de649e9985b4`, layout `a3599c1bfaebc00e783e63780556b8e24c05b7f8`.

| Ordinary merge | Parents |
| --- | --- |
| `b30b4c67e00ca43d945076f471809278ced33363` | `ea083e38…` + `8106f221…` |
| `8851e8f9bd7ede447524dbe4e77c4234bee31da5` | `b30b4c67…` + `bdd28272…` |
| `19ee83bf4ef52140d6478395ccb984eef7eaf96f` | `8851e8f9…` + `8c1b8d95…` |
| `04246ceffee0b54819a6c9bf170c8fbf4169b04e` | `ff75a642…` + `bac08230…` |
| `944662346b87020349f085a0a4d72d007db7ae44` | `04246cef…` + `3027028c…` |

Полные parents, stage blob IDs и owners: [frozen provenance](cloud-all-surfaces-evidence-20260930/integration-root/final-frozen-provenance.json).
**35 conflict instances в31 уникальном path**:28 начальных +2 September +5 Compound.
Authority-файлы разрешены семантически; bulk ours/theirs не применялся.
Оригинальный `/workspace/rox-one` и действующие Mac owner checkout не использовались как writers.
Финальная цепочка: b841 → `a4cacaa1d91c205de5d2c543d565e7edb79edd0e` →
`daa7bdf35f803f4fbf2c748d1495a9d558b5b9ba` → exact010.
A4→010 меняет только typed test fixture и две строки packaging lists; application bytes эквивалентны.

## Runtime и сохранность

Поддерживаемый `cloud_environment.environment_status` повторно подтвердил Cloud/current/running/connected.
Safe timestamp/fields: [current runtime receipt](cloud-all-surfaces-evidence-20260930/integration-root/final-root-managed-runtime.json).
Network policy restricted, state unknown: отдельный readiness PASS инструмент не сообщил.
Git/package/API операции по существующему разрешённому HTTPS-маршруту реально выполнялись.
Запрошена GPT-6.1 Sol Ultra; executor не предоставил model/effort как attested runtime fields.
Основные checks: **Bun1.3.14, Nodev24.19.0**, `--no-env-file`.
ROX/CRAFT/config/tmp/cache вынесены из checkout; proxy/TLS передавались без раскрытия значений.
Provider/OAuth secrets и checkout `.env` не загружались; settings/permissions/network policy не менялись.
Исходный mainf632 сохранил clean status; последний canonical original-after receipt подтверждает это.
Оригинальный lock SHA256: `b29cf0eb0eaa357069172fe728123d1bd56ab77ef18d90e426f1f42cf85fb79b`.
Изолированный published lock: `47a54e33fcd528780b47b62d481b501414a1877c0cc77e5071db76e29297dac1`.
Установка не переписывала lockfile. Canonical010 до/после runtime сохранил все6178 tracked hashes.
После сохранения evidence собственные `dist-server/` и canonical distribution удалены; isolated checkout и original main имеют clean status перед записью этого docs-only отчёта. [Clean-status receipt](cloud-all-surfaces-evidence-20260930/prepublication-clean-status.json).

## Root-approved Projects repair

Источник `260daf5c38d70cd833ae9413123bb03a5900cf61`, parent `4413e4ae352a6844b498b31f239ffc6c3676d7a7`;
cherry-pick `65547d788eebdf5d39b8f4180880f5abba580d93`, path `apps/electron/src/renderer/hooks/useProjects.ts`.
Before SHA256 `13543daf34873c044fb089504e6d6146878cdb327b6e94d6a43f776ecd243d31`;
after `2b87d14b619e470a531e82f5e10f94af0fd916dee1e8abcbfdfb64590f0186ac`.
Source/cherry/final after bytes совпадают. Lease committed scope :30, cleanup :34,
post-await request fence :49, scope-bound subscription :69 защищают local/Jotai projection.
Callback/lifecycle tests проверяют stale response, A→B→A и unmount; это не native DOM acceptance.

## Исполненные gates, без сложения пересекающихся inventory

| Actual source/input | Gate | Результат |
| --- | --- | --- |
| d1ebc477… | frozen install | exit0/1.698s, lock/source unchanged |
| d1ebc477… | validate:ci / WebUI types | exit0; применимые types, Python19, i18n parity/sorted/coverage |
| d1ebc477… | workflow durable | **1002/0/7441expects/101files** |
| d1ebc477… | September process-loss | **24/0/147expects/4files** |
| d1ebc477… | integrated, d1 inventory | **160/0/769expects/22files** |
| d1ebc477… | `server:build:subprocess` | exit0/2.420s |
| d1ebc477… | strict built smoke | **4/0/37expects/1file** |
| b8416534… | Electron/WebUI types + i18n coverage | exit0 |
| b8416534… | integrated, b841 inventory | **167/0/789expects/23files** |
| b8416534… | full Electron / Node24 SQLite | exit0/93.690s;16 assertions |
| b8416534… | strict built smoke | **4/0/37expects/1file** |
| a4cacaa1… | full Electron | exit0/**96.769s** |
| a4cacaa1… | WebUI / Bun server build | exit0/**77.551s /1.231s** |
| a4cacaa1… | actual mounted browser | exit0/**99pass/0fail/0phase**,598.753s |
| daa7 checkpoint →010 unchanged type/test inputs | validate:ci | exit0/**157.018s** |
| тот же batch | WebUI typecheck | exit0/**43.174s** |
| тот же batch | integrated controls | **198/0/930expects/26files**,6.695s |
| тот же batch; artifacts produced a4 | strict built smoke | **4/0/37expects/1file**,8.799s |
| exact010 | i18n coverage после packaging delta | exit0/3.217s |
| exact010 | canonical assembly | exit0/**9.859s** |
| exact010, shipped Bun1.3.9 | actual launcher smoke | **2/0/56expects**,exit0/9.793s |

D1 source: `d1ebc477abc9961264e479a05e5638c3c7010f21`; b841: `b8416534b6cf571ac6b18c38b3845bb92218a1a5`.
Daa batch start/end SHA записаны; individual command start/end HEAD не записан отдельно.
Единственная source delta во время batch — packaging script вне10 проверяемых TS roots;
application/test inputs остались равны. Coverage, затрагивающая scripts, повторена именно на010.
Final types: core/shared/server-core/server/session-tools/pi-agent/Electron/UI/workspace-service/WebUI exit0.
`workers/pages` отсутствует в OSS export: SKIPPED, не worker PASS.
I18n:11locales ×7449keys, sorted;7165literal references/5256unique; missing-key negative сохранён.
ValidateCI Bun subinvocations21/11/103/112/1 отдельно; Python19/0. Эти counts не суммируются с workflow.
Durable реально включает Bun↔Node adapter fixtures, authority/journal/replica/budget/occurrence-ledger,
native startup/RPC/privacy/custody controls; September suite — процессные loss/restart проверки.
Точные case names/file/declaration line и commands: [final cases/receipt](cloud-all-surfaces-evidence-20260930/union-validation/r24-daa7-final/final-validation.json).
Carried durable/September — доказательство неизменных inputs, не повторный запуск1002tests на010.

## Реальные builds и browser

A4 Electron:408renderer chunks/maps,5HTML entries, **1192/1192 textual source entries exact**.
23generated SVG/PNG wrappers отдельно объяснены; они не равны raw asset bytes.
Actual main SHA256 `c18f109ed52c09c5b7cf2b131e4ab3bfd01c116c55a10a8799454fc27cd4f261`.
Node24 загрузил compiled SQLite initializer:16assertions, commit/read/rollback/readonly/closed/restart PASS.
Whole actual main require под явно mocked Electron host: exit0/1.922s, readiness held,
0windows/network/children/outside effects. Реальный installed Electron/Mac bootstrap не запускался.
Host probe разрешал только public `/proc/version` OS metadata (2reads); source/permissions не менялись.
Published SQLite owner bytes SHA256 `8cd80233dc566a9433cd1b589222ca7cebbcf61ff5a09fff81c29702f5bfc831` сохранён.
WebUI/browser artifact producer остаётся a4; source equivalence с010 не переименовывает build input.
Optimized graph выбран из actual index HTML/reachable imports:386JS, mapped source closure26exact.
Server bundle SHA256 `436a76834cf72a8d666df1bb75057b41617328f064725e23f3b8771f9dfddb2f`;
HTML SHA256 `6671ed2fb506a7a2477884ba2446b2e8eec0d42d895ea24a3f8570750ec34b96`.
Optimized main SHA256 `1edc630af4a8a6cbd878602eaa1a7d0b5c7d538f8ce970808917a3b68200e9a6`.
Все856 built artifact files сохранили hashes до/после final gates; entry/assets полный manifest — в receipt.

Actual Playwright1.49.1/Chromium151.0.7922.173 renderer: **99PASS/0FAIL,0 lifetime page exceptions**.
Обойдены22root routes,22Settings routes,7mode clicks с реальными DOM markers.
Исполнены Pages New Page → private persisted page → reload → same-profile stop/restart → **один новый socket ACK** (две assertions наблюдают тот же receipt; [count correction](cloud-all-surfaces-evidence-20260930/delivery-corrections.json)).
HTTP default workspace сопоставлен с actual authenticated WS ACK; mismatch negative реально исполнен.
NotesUnavailable: реальный mouse/Enter на disabled control не вызвал mutation channels и native editor.
Native Principal/capability не подставлялись. Genuine Project/roadmap и native Notes mutation UI **NOT EXECUTED**:
не было доверенного native workspace context/preload bridge; unavailable UI сохранился честным.
Контекстные browser/terminal/cloud-run/extension/diff без реальных backend IDs также NOT EXECUTED.
Browser закрыт;3собственных servers остановлены SIGTERM exit0 без SIGKILL; remaining children/profiles0.
Токены не попали в полные child logs; cookies/Authorization/private config в отчёт не копировались.
Google-font DNS failure — отдельная инфраструктурная запись; application page exceptions0.
Root просмотрел Home, NotesUnavailable и restartPages screenshots; hashes/inventory сохранены.
Старый450 screenshot/asset относится к иному revision; равенство с пользовательским asset не установлено.
[Browser evidence](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/revision-bound-green-summary.json), [source review](cloud-all-surfaces-evidence-20260930/docs-provenance/independent-final-review.json).

## Buffer shim и optimized production entry

Сохранённый old450 asset `main-Cww2HZ0w.js:2505:7102` и его sourcemap показывают self-import `node-stub.ts:61:23`: bare `buffer` перенаправлялся обратно в тот же shim. Пользовательский `main83G_2h7J.js` не объявляется идентичным этому asset.
В actual union [vite.config.ts:12](../apps/webui/vite.config.ts) bare `buffer` исключён из перехвата; `node:buffer` остаётся shim и его import на [node-stub.ts:9](../apps/electron/src/renderer/shims/node-stub.ts) разрешается в настоящий browser package.
До browser-main выполняется bootstrap Buffer/process/global. Optimized entry `main-CdNrFgjS.js` SHA256 `1edc630af4a8a6cbd878602eaa1a7d0b5c7d538f8ce970808917a3b68200e9a6` и reachable sourcemap closure проверены против actual a4/final010 sources.
Реальный renderer mounted root/header/sidebar без TDZ/pageerrors; [node-builtins-bundle.test.ts](../apps/webui/__tests__/node-builtins-bundle.test.ts) исполнил positive Buffer и negative fs/exec/random/unsupported `DatabaseSync` build-refusal. HTML-only smoke не использовался как renderer proof.

Screenshots: [default shell](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/default-shell-home.png), [Workbench header/modes](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/workbench-enabled-home.png), [expanded rail](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/actual-activity-rail-user-expanded.png), [Projects](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/route-08-projects.png), [Notes unavailable](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/pre-existing-private-note.png), [Pages after restart](cloud-all-surfaces-evidence-20260930/ui-runtime/run-union/same-profile-restart-persisted-page.png).
Modes/Workbench preferences были включены отдельно для scoped layout проверки; это не assertion, что они включены в default profile. Disabled/unavailable native controls на screenshots не считаются functional native acceptance.

## Два разных smoke: Bun bundle и поставляемый launcher

Strict repo smoke: `ROX_SERVER_SMOKE_ENTRY=dist-server/index.js`, `ROX_SERVER_SMOKE_WEBUI_DIR=apps/webui/dist`;
`bun --no-env-file test packages/server/src/__tests__/smoke.test.ts` —4/0/37.
Health/login/auth/HttpOnly/config/HTML/valid-invalidWS/SIGTERM/open client/stopped health/restart/short token;
source :193,:216,:225,:229,:230,:233,:243. Результат привязан к actual a4 artifact hashes и daa test inputs.
Canonical010: `bun --no-env-file run server:build --output=../../../workspace/rox-union-server-dist-final-20260930`.
Actual `sh bin/craft-server` использует source-pinned **shipped Bun1.3.9**, compiler/testdriver Bun1.3.14.
Assembly:56499files/2059exact workspace source copies/855exact UI copies/**1060657173bytes**;
symlinks внутри delivery. Full output hashes/symlinks до/после runtime равны.
Launcher2/0/56: initial/restart health/login/auth/config/exactHTML, valid/invalid authenticatedWS,
HttpOnly cookie, oldcookie reuse, persisted config, live open client→SIGTERM→graceful exit0;
после каждого stop четыре HTTP endpoint +rawWS недоступны. Short token exit1/exact diagnostic/no readiness.
Три own child exits[0,0,1],0remaining probe PIDs; private profiles удалены, tokens не залогированы.
Delivery hashes сохранены, временный distribution удалён. OS service/install.sh/native/provider acceptance не проверялись.
[Canonical receipt](cloud-all-surfaces-evidence-20260930/union-validation/p010-canonical-delivery-summary.json) сохраняет все56 phase assertions и manifest hashes.

## Сравнение с main и исправленные historical RED

[Main report](cloud-all-surfaces-evidence-20260930/baseline/main-f632-validation.md):55/57/73/75/77,
**817pass/3fail/820tests/79files/3519expects**, core804/3 +WebUI13/0; WebUItypes52/server8diagnostics.
Hidden locator: `attach-credential-ref.test.ts:93`, assertion132:9; prototype locator:test136/assert148:18.
Union inert plain own enumerable descriptor guard `credential-types.ts:233,239,241` исправляет обе регистрации.
Upcoming: `things.test.ts:111`,assert119:53; fixture clock расходился с implicit Date.now.
`store.ts:498` принимает caller clock; deterministic fixture `things.test.ts:130,132`, clock-negative139.
Все три точных main case PASS в d1 receipt. Core+WebUI subset той же invocation **917/0/83files**;
его отдельные expects не emitted. Разные inventories исключают fictitious delta817→1002.

B841 actual renderer RED87/12/0: Notes AUTH_FAILED/unavailable bridge, Project missing preload method,
Environment/Voice LOCAL_ONLY_DENIED и Messaging unsupported metadata исправлены bounded a4 read/error/capability patch.
Source refs historical: NotesPage864,native-notes-sync63,SharedProjectProjection89,Environment15,Voice30,Messaging147.
Final actual a4browser99/0/0 подтверждает scoped repairs; эти старые findings не выдаются за оставшиеся defects.
A4 typeRED `desktop-settings-session.test.ts:226:78` — отсутствовали continueCursor/isDone, TS2345.
Local validate exit2 и4hosted typeFAIL; downstream24stepsSKIPPED. Daa typed fixture-only fix16/0/76 и finalvalidate0.
A4 canonicalRED0/2/4 до health: `cloud-runs.ts:49` импортировал отсутствующий `@rox/cloud-runner`.
Оmission был и на mainf632. Exact010 добавляет dependency source seed `build-server.ts:384` иcopylist:487.
Это source packaging defect, не network/auth failure; final actual vendor launcher2/0/56 его закрывает.
Historical RED сохранены неизменно; старый successful bundle smoke не заменял failed canonical runtime.

## Что осталось: source, infrastructure и unexecuted scope

Оставшийся tooling source defect: exact010 `scripts/build-server.ts:837`, `join(rootDir, values.output!)`.
Абсолютный `--output=/tmp/...` исторически добавлялся под checkout; relative final delivery реально работает.
Repro: `bun --no-env-file run server:build --output=/tmp/rox-absolute-output-repro`; этот repeat не исполнялся.
Protected PG: `postgres-identity.ts:41`, WP48fixture:27; actual historical0/17fail/0asserts до domain effects.
Repro: `bun --no-env-file test tests/macro-integration/wp-48-domain.test.ts`; final known prerequisite не повторялся.
WP01 offline/response/archive/realElectron suites NOT EXECUTED; exact flags/callsites/commands — в final appendix.
Hosted010 push36771257478 +PR36771265843: **4jobs/68metadata stepsSUCCESS**, наблюдения20:32:12–20:33:27UTC.
Hosted printedcheckout SHA и testcounts UNVERIFIED: official logredirect403; новых запросов логов не было.
Direct/synthetic010tree равны; synthetic parents mainf632+010. Это source equivalence, не checkout attestation.
CodeQL110078183669 FAILURE:96rawannotations64high/32medium, exact010file/line сохранены; triage/validation не выполнена.
Transient Swiftconfig warning отсутствует в latest20:32snapshot; scannerFAILURE96 не означает96validated vulnerabilities.
Vercel «Account is blocked.» — infrastructure; native Linux/macOS/budgets self-hosted QUEUED, не executionPASS.
Full109/143/UTB/DATA_SHARED, installed Mac/Windows, providers/OAuth и iOS device/share/return pending owner proofs.
UTB starter/strict reference controls не принимают16следующих BaseDefinition/CRUD/hostCAS/two-client/nativegrid packages.
Single main-owned encrypted Notes outbox→NativeJournal→trusted observed ACK сохранён; legacy parallel writer не включён.
Независимый final audit подтвердил13protected paths +39critical authority/SQLite blobs unchanged; fullDoDAccepted=false.
Точный актуальный [source-vs-infrastructure appendix](cloud-all-surfaces-evidence-20260930/integration-notes/r15-final-remaining-gates.md) supersedes ранние pending UI/distribution поля.

## Доставка и handoff

Source `010fa8c040e3a84cd40cd8195473f52d8582f159` опубликован в отдельной `cloud/all-surfaces-20260930`; [PR #1322](https://github.com/rox-one/rox-one/pull/1322) остаётся draft/open, без merge.
Application source и lockfile в этом финальном commit не меняются: только отчёт, receipts и screenshots.
Точный publication SHA/remote readback и удаление временного checkout фиксируются после публикации в `/workspace/rox-r15-evidence-20260930/delivery-readback.json` и внешнем [отчёте](/workspace/rox-cloud-all-surfaces-R15-2026-09-30.md).

Полный сохраняемый evidence — `/workspace/rox-r15-evidence-20260930`; выбранные immutable receipts и все64 screenshots опубликованы рядом с этим документом.
Исторические JSON сохраняют exact executed paths/hashes; после cleanup для retained evidence заменяется префикс `/tmp/rox-ui-surface-discovery-20260930/` на каталог evidence. Для воспроизведения helpers требуется новый isolated checkout с указанной в них временной layout; credentials/env не переносились.
[Machine receipt](cloud-all-surfaces-validation-20260930.json) содержит exact commands/counts/file/line и revision distinctions.
В отчёте нет токенов, cookie values, private config/profile contents или signed redirect URLs.

Root review: bounded assembly/runtime proof передаётся для независимого source review. Полные109/143/UTB и native/PG/provider/iOS acceptance остаются у действующих owners.
