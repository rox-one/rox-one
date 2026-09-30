# Delivery receipt: Lark Suite / Docs / Bases / Code Intelligence

**Статус: спецификации доставлены; 61 новая GitHub issue опубликована и проверена.** Публикация: 2026-09-30T04:22:30.832Z. Реализация новых возможностей: **NOT_IMPLEMENTED_BY_THIS_PACKAGE**. Облачное выполнение: **PREPARED_NOT_LAUNCHED**, запущено 0 задач.

## Закреплённые входы

| Вход | Значение |
|---|---|
| ROX product/source baseline | `e953786ba7e30fb5da5dca7e88e20e324d5aebab` |
| Immutable specification package | [`242492868a11b4d9af1c1011f20b31a346875f0a`](https://github.com/rox-one/rox-one/tree/242492868a11b4d9af1c1011f20b31a346875f0a/docs/lark-suite-reference) |
| Package SHA256 | `9023153c4d6e4a6dac51991c2d82b512ed3df7d7803825845222160224369cb5` |
| Remote package readback | 96/96 GitHub blobs; decoded bytes, SHA256 и size совпали |
| Package manifest | [delivery.json](../../plans/lark-suite-reference/delivery.json) |
| GitHub issue receipts | [publication.json](../../plans/lark-suite-reference/publication.json) |

Исходный пакет закреплён отдельно от этого receipt commit. Его packageFiles/digest не включают self-referential delivery/publication files. Обновлённые README, plan и validation receipt не изменяют immutable input revision, на который ссылаются issues.

## Состав и проверенные границы

- 41 запись каталога с покрытием всех запрошенных названий; 170 записей об экранах. Количество записей не означает, что каждый экран независимо проверен в приложении.
- 34 содержательных наблюдения в приложении, 63 попытки захвата через Codex Computer Use; сохранены также ошибки, загрузка и ограничения доступа. Частные screenshots/AX не отправлены в GitHub.
- Rox Docs: 12 конкретных экранов; Rox Bases: 7 представлений и 18 типов полей; Automations: 9 экранов; Code Intelligence: 12 экранов в существующих Projects/Sources/Wiki/Sessions.
- 61 пакет реализации, 161 зависимость, 255 предложенных путей с отдельным владельцем записи, 66 общих путей под одним integration owner.
- 56 E2E/acceptance сценариев с входами, ожидаемыми результатами, ошибками и восстановлением; продуктовые тесты этих новых возможностей **NOT_RUN**.
- Проверены 37 baseline blobs, 84 точных места объявления символов и 40 точек интеграции Code Intelligence. Тесты файловой модели Ideascape: 35/35; существующие helper-тесты Code Intelligence ROX: 4/4. Это ограниченные проверки исходников и вспомогательных механизмов.
- Валидатор артефактов отверг 11 намеренно повреждённых входов; независимый critical review разрешил CR-01–12 в спецификациях, контрактах и исходниках инструментов подготовки.
- Издатель проверил точные заголовки, тексты и открытое состояние 61/61 issues; prerequisite issues были прочитаны обратно до публикации зависимых задач. Второй конкурентный процесс остановился на exclusive lock до GitHub операций. Управляемый crash/retry не исполнялся.

## Как подготовить облачное выполнение

1. Получить этот delivered branch/receipt, прочитать delivery.json и сохранить packageCommit/packageDigest как immutable входы orchestrator. В package worktree использовать именно specification commit выше; product baseline сам по себе не содержит новые specs. Receipt передать отдельно, если создаётся worktree на packageCommit.
2. Проверить packageFiles SHA256/size и source baseline; запустить `bun tools/lark-suite-reference.mjs --validate`. Прочитать [execution-packages.json](../../plans/lark-suite-reference/execution-packages.json) и [execution-dag.json](../../plans/lark-suite-reference/execution-dag.json), затем полную normative PRD по sourceRecord каждого package.
3. Resolve `RESOLVE_FROM_DELIVERY_MANIFEST` в transport packet к exact commit/digest. Это необходимая подготовка; unresolved packet должен быть отвергнут. Не заменять source revision текущим branch name.
4. Выбрать готовую к выполнению задачу по DAG, проверить квитанции реализации prerequisites и готовность задействованного domain owner/provider, назначить реального worker и получить exclusive path leases. 255 путей workers и 66 общих путей integration owner имеют разные права записи.
5. Запустить через реально доступный cloud executor и сохранить runner ID/acknowledged receipt; этого шага в текущей работе не было. Missing readiness/assignment/lease блокирует зависимый slice, не превращается в PASS.
6. После реализации выполнить package tests/DoD + relevant UI/domain/restart/offline/ACL/agent acceptance; доставить implementation commit и прочитать результат обратно. Issue закрывать только после required runtime receipts.

Для текущего пакета 61 задача остаётся PLANNED_NOT_EXECUTED/UNASSIGNED, 13 внешних условий готовности — READINESS_NOT_VERIFIED. Открытые вопросы сохранены в [11](11-decisions-open-questions.md). Репозиторий OpenWiki выбран как явное рабочее предположение; внутренний endpoint Repogrep не принят как публичный integration API.

## Опубликованные отдельные issues

46 LSX slices уточняют Docs/Bases/automations; 15 CI slices расширяют существующий Code Intelligence pack, выключенный по умолчанию. Они связаны с предыдущими Suite issues 1091–1120 и не заменяют их. Ни одна предыдущая issue не переименована или закрыта этой публикацией.

| Package | GitHub | Название |
|---|---|---|
| LSX-WP-001 | [#1231](https://github.com/rox-one/rox-one/issues/1231) | [ROX Suite Extension][LSX-WP-001] Page content descriptor и совместимое открытие Notes |
| CI-001 | [#1232](https://github.com/rox-one/rox-one/issues/1232) | [ROX Code Intelligence][CI-001] Repository binding, snapshot and provider-neutral contracts |
| LSX-WP-002 | [#1233](https://github.com/rox-one/rox-one/issues/1233) | [ROX Suite Extension][LSX-WP-002] Личные Task source bindings и изолированный picker |
| LSX-WP-003 | [#1234](https://github.com/rox-one/rox-one/issues/1234) | [ROX Suite Extension][LSX-WP-003] Атомарная запись Markdown с CAS/epoch/receipt |
| LSX-WP-007 | [#1235](https://github.com/rox-one/rox-one/issues/1235) | [ROX Suite Extension][LSX-WP-007] Сохраняемая BaseDefinition и private/shared views |
| CI-002 | [#1236](https://github.com/rox-one/rox-one/issues/1236) | [ROX Code Intelligence][CI-002] Repository scope, exclusion and egress policy |
| LSX-WP-004 | [#1237](https://github.com/rox-one/rox-one/issues/1237) | [ROX Suite Extension][LSX-WP-004] Canonical Task field command с revision и partial receipts |
| LSX-WP-005 | [#1238](https://github.com/rox-one/rox-one/issues/1238) | [ROX Suite Extension][LSX-WP-005] Lossless Markdown/YAML raw-span patch и field readback |
| LSX-WP-011 | [#1239](https://github.com/rox-one/rox-one/issues/1239) | [ROX Suite Extension][LSX-WP-011] Реестр 18 typed fields и schema inspector |
| CI-003 | [#1240](https://github.com/rox-one/rox-one/issues/1240) | [ROX Code Intelligence][CI-003] Local code-search adapter and index status |
| CI-004 | [#1241](https://github.com/rox-one/rox-one/issues/1241) | [ROX Code Intelligence][CI-004] Typed RPC, events and durable intelligence jobs |
| CI-005 | [#1242](https://github.com/rox-one/rox-one/issues/1242) | [ROX Code Intelligence][CI-005] Groma read-only importer and scanner capability spike |
| LSX-WP-009 | [#1243](https://github.com/rox-one/rox-one/issues/1243) | [ROX Suite Extension][LSX-WP-009] Source adapters Notes/Tasks/Projects/Meetings/Calendar |
| LSX-WP-040 | [#1244](https://github.com/rox-one/rox-one/issues/1244) | [ROX Suite Extension][LSX-WP-040] Docs/Bases domain-outbox→existing automation aliases |
| LSX-WP-006 | [#1245](https://github.com/rox-one/rox-one/issues/1245) | [ROX Suite Extension][LSX-WP-006] Stable block/node anchors без переписывания prose |
| CI-006 | [#1246](https://github.com/rox-one/rox-one/issues/1246) | [ROX Code Intelligence][CI-006] OpenWiki RepoWiki adapter and page-claims import |
| CI-007 | [#1247](https://github.com/rox-one/rox-one/issues/1247) | [ROX Code Intelligence][CI-007] GitDiagram structured graph adapter and source integrity |
| CI-009 | [#1248](https://github.com/rox-one/rox-one/issues/1248) | [ROX Code Intelligence][CI-009] Project/Source navigation and Code Intelligence route shell |
| LSX-WP-010 | [#1249](https://github.com/rox-one/rox-one/issues/1249) | [ROX Suite Extension][LSX-WP-010] Permission-aware query snapshot, cursor и totals |
| LSX-WP-008 | [#1250](https://github.com/rox-one/rox-one/issues/1250) | [ROX Suite Extension][LSX-WP-008] Миграция NoteBaseView v1 с неизменными legacy formulas |
| LSX-WP-026 | [#1251](https://github.com/rox-one/rox-one/issues/1251) | [ROX Suite Extension][LSX-WP-026] Existing Tiptap binding, durable draft и history restore |
| CI-008 | [#1252](https://github.com/rox-one/rox-one/issues/1252) | [ROX Code Intelligence][CI-008] Freshness resolver, watcher and staged artifact ownership |
| LSX-WP-012 | [#1253](https://github.com/rox-one/rox-one/issues/1253) | [ROX Suite Extension][LSX-WP-012] Typed scalar cell editors с native write preview |
| LSX-WP-014 | [#1254](https://github.com/rox-one/rox-one/issues/1254) | [ROX Suite Extension][LSX-WP-014] Relations picker, cardinality и inverse recovery |
| LSX-WP-025 | [#1255](https://github.com/rox-one/rox-one/issues/1255) | [ROX Suite Extension][LSX-WP-025] Docs library capability filter и same-ref navigation |
| LSX-WP-013 | [#1256](https://github.com/rox-one/rox-one/issues/1256) | [ROX Suite Extension][LSX-WP-013] Bounded formula engine и legacy built-ins |
| LSX-WP-027 | [#1257](https://github.com/rox-one/rox-one/issues/1257) | [ROX Suite Extension][LSX-WP-027] Discussion anchors, orphan state и private-comment migration |
| LSX-WP-028 | [#1258](https://github.com/rox-one/rox-one/issues/1258) | [ROX Suite Extension][LSX-WP-028] Editable Outline structural commands с aggregate CAS |
| LSX-WP-031 | [#1259](https://github.com/rox-one/rox-one/issues/1259) | [ROX Suite Extension][LSX-WP-031] Semantic tabs/columns и safe basic Markdown fallback |
| LSX-WP-032 | [#1260](https://github.com/rox-one/rox-one/issues/1260) | [ROX Suite Extension][LSX-WP-032] Code/highlight presentation без исполнения или false redaction |
| LSX-WP-033 | [#1261](https://github.com/rox-one/rox-one/issues/1261) | [ROX Suite Extension][LSX-WP-033] Action Buttons typed registry и inert imports |
| CI-010 | [#1262](https://github.com/rox-one/rox-one/issues/1262) | [ROX Code Intelligence][CI-010] Search/evidence and accessible graph UI |
| CI-012 | [#1263](https://github.com/rox-one/rox-one/issues/1263) | [ROX Code Intelligence][CI-012] Agent read/stage tools and transport wiring |
| CI-013 | [#1264](https://github.com/rox-one/rox-one/issues/1264) | [ROX Code Intelligence][CI-013] Instruction reconciliation and license/provider notices |
| CI-014 | [#1265](https://github.com/rox-one/rox-one/issues/1265) | [ROX Code Intelligence][CI-014] Search alternatives capacity and provider contract gate |
| LSX-WP-018 | [#1266](https://github.com/rox-one/rox-one/issues/1266) | [ROX Suite Extension][LSX-WP-018] Board: native status transition и keyboard move |
| LSX-WP-019 | [#1267](https://github.com/rox-one/rox-one/issues/1267) | [ROX Suite Extension][LSX-WP-019] List: native checkbox и eligible bulk actions |
| LSX-WP-020 | [#1268](https://github.com/rox-one/rox-one/issues/1268) | [ROX Suite Extension][LSX-WP-020] Gallery и typed Image/Audio/Video cells с asset ACL |
| LSX-WP-021 | [#1269](https://github.com/rox-one/rox-one/issues/1269) | [ROX Suite Extension][LSX-WP-021] Calendar Base date precision и native/provider capabilities |
| CI-011 | [#1270](https://github.com/rox-one/rox-one/issues/1270) | [ROX Code Intelligence][CI-011] RepoWiki knowledge navigation and review UI |
| LSX-WP-015 | [#1271](https://github.com/rox-one/rox-one/issues/1271) | [ROX Suite Extension][LSX-WP-015] ACL-filtered Lookup/Rollup и actor-scoped cache |
| LSX-WP-016 | [#1272](https://github.com/rox-one/rox-one/issues/1272) | [ROX Suite Extension][LSX-WP-016] Schema migration preview/type rename/soft delete |
| LSX-WP-029 | [#1273](https://github.com/rox-one/rox-one/issues/1273) | [ROX Suite Extension][LSX-WP-029] Mind map layout/viewport по тому же tree |
| LSX-WP-030 | [#1274](https://github.com/rox-one/rox-one/issues/1274) | [ROX Suite Extension][LSX-WP-030] Conversion preview copy/inPlace с CAS и rollback |
| LSX-WP-039 | [#1275](https://github.com/rox-one/rox-one/issues/1275) | [ROX Suite Extension][LSX-WP-039] Offline structural intents, recovery и revoke fence |
| LSX-WP-041 | [#1276](https://github.com/rox-one/rox-one/issues/1276) | [ROX Suite Extension][LSX-WP-041] Existing constructor typed Docs/Base nodes и field-ID mappings |
| LSX-WP-022 | [#1277](https://github.com/rox-one/rox-one/issues/1277) | [ROX Suite Extension][LSX-WP-022] Timeline interval move/resize с native atomic bounds |
| CI-015 | [#1278](https://github.com/rox-one/rox-one/issues/1278) | [ROX Code Intelligence][CI-015] End-to-end verification and recovery gates |
| LSX-WP-017 | [#1279](https://github.com/rox-one/rox-one/issues/1279) | [ROX Suite Extension][LSX-WP-017] Table grid: typed edits, rectangle paste и readback |
| LSX-WP-034 | [#1280](https://github.com/rox-one/rox-one/issues/1280) | [ROX Suite Extension][LSX-WP-034] Portable vault import staged identities/attachments |
| LSX-WP-045 | [#1281](https://github.com/rox-one/rox-one/issues/1281) | [ROX Suite Extension][LSX-WP-045] Explicit CustomRecord page payload для нового типа данных |
| LSX-WP-023 | [#1282](https://github.com/rox-one/rox-one/issues/1282) | [ROX Suite Extension][LSX-WP-023] Chart агрегаты и authorized drill-down |
| LSX-WP-024 | [#1283](https://github.com/rox-one/rox-one/issues/1283) | [ROX Suite Extension][LSX-WP-024] Doc Base embed и actor-scoped range context |
| LSX-WP-035 | [#1284](https://github.com/rox-one/rox-one/issues/1284) | [ROX Suite Extension][LSX-WP-035] Base export/import .base/CSV/JSON с loss reports |
| LSX-WP-036 | [#1285](https://github.com/rox-one/rox-one/issues/1285) | [ROX Suite Extension][LSX-WP-036] Map/Outline exports MD/OPML/Canvas/PNG/SVG |
| LSX-WP-037 | [#1286](https://github.com/rox-one/rox-one/issues/1286) | [ROX Suite Extension][LSX-WP-037] Checkbox→native Task и TaskNotes origin mapping |
| LSX-WP-046 | [#1287](https://github.com/rox-one/rox-one/issues/1287) | [ROX Suite Extension][LSX-WP-046] Versioned template gallery с inert actions и bounded creation |
| LSX-WP-042 | [#1288](https://github.com/rox-one/rox-one/issues/1288) | [ROX Suite Extension][LSX-WP-042] Revision-pinned artifact/approval nodes и safe retry receipts |
| LSX-WP-038 | [#1289](https://github.com/rox-one/rox-one/issues/1289) | [ROX Suite Extension][LSX-WP-038] Docs day-planner binding без нового timer/notification loop |
| LSX-WP-044 | [#1290](https://github.com/rox-one/rox-one/issues/1290) | [ROX Suite Extension][LSX-WP-044] Form submission→native Task/Base recipe без второй task DB |
| LSX-WP-043 | [#1291](https://github.com/rox-one/rox-one/issues/1291) | [ROX Suite Extension][LSX-WP-043] Weekly Report workflow recipe с scoped draft/owner review |

## Основные спецификации

[Executive summary](00-executive-summary.md) · [Live audit](01-live-product-audit.md) · [Bases](05-rox-bases-design.md) · [Docs](06-rox-docs-design.md) · [ERD](07-domain-entity-model.md) · [Automations](08-automation-integration.md) · [Implementation plan](09-implementation-plan.md) · [Tests/DoD](10-test-plan.md) · [Critical review](12-critical-review.md) · [Code Intelligence](13-code-intelligence.md) · [CI UI](14-code-intelligence-ui.md).
