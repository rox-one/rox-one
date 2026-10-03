# R15: оставшиеся gates exact010

Source `010fa8c040e3a84cd40cd8195473f52d8582f159`. Только существующее evidence; исходники/сеть/env не менялись.

| Категория | Gate | Факт |
| --- | --- | --- |
| Source/tooling | build-server.ts:837 absolute output | join(rootDir, values.output!) сохраняет historical ошибку; relative final assembly +actuallauncher2/0/56 уже GREEN |
| Infrastructure | Protected PostgreSQL WP01/WP48 | postgres-identity.ts:41, wp-48-domain.test.ts:27; actual historical0/17fail/0asserts до SQL/domaineffects |
| Pendingtriage | CodeQL | FAILURE96rawannotations64high/32medium; exact010filelines сохранены, validation отсутствует |
| Infrastructure | Vercel | Account is blocked. |
| Infrastructure | Hosted logread | official redirects403; printedSHA/countsUNVERIFIED, новых retries нет |
| Unexecuted | Native Linux/macOS/budgets | self-hosted jobsQUEUED, execution не подтверждено |
| Skipped | OSS pages worker | пакет отсутствует; не typePASS |
| Infrastructure | Google fonts DNS |2records, application lifetime pageexceptions0 |

Absolute output repro: `bun --no-env-file run server:build --output=/tmp/rox-absolute-output-repro` (не повторялся на010).
WP48 repro: `bun --no-env-file test tests/macro-integration/wp-48-domain.test.ts` (known prerequisite не повторялся).

WP01/WP48 окончательные NOT EXECUTED suites:

| File | Prerequisite lines | Static declarations (not runtime cases) | Repro |
| --- | --- | --- | --- |
| tests/macro-integration/wp-01-offline.test.ts | 27 | 9; lines 154,185,203,215,228,244,257,273,282 | `bun --no-env-file test tests/macro-integration/wp-01-offline.test.ts` |
| tests/macro-integration/wp-01-response-schema.test.ts | 110 | 4; lines 143,158,197,217 | `bun --no-env-file test tests/macro-integration/wp-01-response-schema.test.ts` |
| tests/macro-integration/wp-01-archive.test.ts | 209,241,387 | 3; lines 237,355,374 | `bun --no-env-file test tests/macro-integration/wp-01-archive.test.ts` |
| tests/macro-integration/ui/wp-01-offline-electron.test.ts | 150,181 | 1; lines 151 | `bun --no-env-file test tests/macro-integration/ui/wp-01-offline-electron.test.ts` |
| tests/macro-integration/ui/wp-01-electron.test.ts | 290,325 | 1; lines 291 | `bun --no-env-file test tests/macro-integration/ui/wp-01-electron.test.ts` |
| tests/macro-integration/wp-48-domain.test.ts | 27 | 17; lines 75,84,90,98,102,105,110,120,125,129,135,141,151,160,174,194,204 | `bun --no-env-file test tests/macro-integration/wp-48-domain.test.ts` |

Archive suite требует owner opt-in ROX_WP01_ARCHIVE_E2E (:23) и absolute ROX_WP01_ARCHIVE_PATH (:24); digest optional (:217).
Native UI opt-ins: ROX_WP01_OFFLINE_PRODUCT_E2E (:150), ROX_WP01_PRODUCT_E2E (:290). Значения/env не provisioned.
Защищённые PG/native/archive prerequisites предоставляет существующий owner; domain assertion PASS здесь отсутствует.

Genuine native Notes/Project/roadmap UI и context browser/terminal/cloud-run/extension/diff NOT EXECUTED.
MainContentPanel boundary refs exactsource:355/389/408/417/426; реальных контекстных IDs/backend не было.
Full109/143/UTB/DATA_SHARED/MacWindows/iOS/provider acceptance остаётся pending.
Starter/strict-reference tests не принимают16следующих UTBpackages BaseDefinition/CRUD/hostCAS/two-client/nativegrid.

Historical b84187/12, a4typedfixtureRED и a4canonical0/2/4 исправлены; они не считаются currentremainingdefects.
Actuala4browser99/0/0, finalvalidateCI0, exact010hosted4SUCCESS и canonical2/0/56 сохранены отдельно по revisions.
Точные rawCodeQL96file/line: [codeql-review-pending-010.json](../union-validation/r24-daa7-final/hosted/codeql-review-pending-010.json).
Полные commands/staticcallsites/digests/qualification: [r15-final-remaining-gates.json](r15-final-remaining-gates.json).
