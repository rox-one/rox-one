# План реализации единых таблиц ROX

**Дата:** 30.09.2026. **Epic:** [#1295](https://github.com/rox-one/rox-one/issues/1295).
**Goal:** полноценная общая таблица из standalone, Note и Doc; возможности референса Baserow доступны через общие источники, права и runtime.
**Architecture:** canonical Base/Table/View + native source adapters + reference-only surfaces; существующие Pages, Tiptap, commands, automations, providers и catalog.
**Tech Stack:** существующий TypeScript/Bun/Electron/React monorepo; первый core-модуль без новых зависимостей.
**Spec:** [PRD](../../unified-tables/PRD.md), [техническая спецификация](../../unified-tables/TECH-SPEC.md).

## Глобальные ограничения

Работа от `f63294ba4fffa7238b46b24e918925a313ad0b12` в `feat/unified-tables-baserow-20260930`. Не изменять main, текущие WIP-ветки, OMP и работающие native owners. Предыдущий пакет LSX `242492868a11b4d9af1c1011f20b31a346875f0a` — ссылка на спецификации, не готовый runtime и не автоматически переносимый код. Новые возможности дополняют указанные LSX issues, не создают вторую программу реализации их ядра.

Все имена ещё не созданных endpoint/компонентов ниже — предлагаемые интерфейсы. Перед patch существующего файла читать его на актуальной integration baseline. Один integration owner изменяет shared registries, editor, graph compiler и package exports. Изолированные участники могут писать только свои новые файлы. Не назначать фиктивных исполнителей и не считать облачный запуск произведённым.

## Первое исполняемое изменение: #1296

1. Написать тесты `packages/core/src/bases/__tests__/table-surface.test.ts` и `surface-capabilities.test.ts`: identity/namespace, пять host kinds, codec, отсутствие embedded rows/secrets/grants, cross-workspace, snapshot, limits, fail-closed capability intersection.
2. Запустить RED на минимальных незавершённых функциях. Сохранить точный вывод; не считать отсутствие test runner тестовым падением.
3. Реализовать `surface-types.ts`, `table-surface.ts`, `surface-capabilities.ts`, `index.ts`. Type-only ссылка на текущий `Rox2EntityRef`. Сериализация v1 строгая, максимум 16 KiB UTF-8. Неизвестная будущая версия сохраняется raw, но не исполняется. Source key не зависит от host/view; query key различает view/snapshot, но сам по себе не является ACL cache key.
4. Additive `./bases` export в `packages/core/package.json`; никаких dependency/lockfile изменений.
5. GREEN: `node --experimental-strip-types --test packages/core/src/bases/__tests__/*.test.ts`. Это воспроизводимый вспомогательный runner, не замена native suite. Проверить содержательные mutations: утрата namespace и разрешение по union вместо intersection должны быть пойманы.
6. Проверить diff, отсутствие секретов/скриншотов/лишних файлов, local-vs-remote byte hashes после публикации. Открыть draft PR без merge/auto-close полного epic.
7. На полном checkout integration owner запускает Bun suite и downstream typechecks, затем review. В текущем окружении отсутствие Bun/полного checkout/Electron фиксировать отдельно, не выдавать unit test pass за готовую таблицу в интерфейсе.

## Порядок дальнейшей реализации

| Волна | Задачи | Вход → выход | Условие перехода |
|---|---|---|---|
| A. Основание | #1231, #1235, #1243, #1249, #1239, #1253, #1234, #1237, #1304 | identity/schema/owner → durable Base + authorized typed reads/writes | source owner readback, CAS, permission tests, restart |
| B. Единая таблица | #1279, #1283, #1250, #1297, #1298 | Base/query + host → один renderer/creation/promotion | создать в Note, изменить standalone, открыть Doc; одинаковые refs |
| C. Поля и представления | #1256, #1254, #1271, #1272, #1282, #1308 | typed schema/query → formulas/relations/groups/charts | consistent authorized totals, migration preview, keyboard |
| D. Автоматизация | #1098, #1244, #1261, #1276, #1299, #1300, #1301, #1302 | immutable graph + commands → durable run/receipts/response/cancel | no duplicate effects under retry/crash; current ACL per dispatch |
| E. Интеграции | #1303, #1305, #1309, #1310, #1284 | разрешённые provider/source refs → mail/AI/sync/import | реальные source/provider receipts, не mock UI |
| F. Рабочие поверхности | #1306, #1307, #1095, #1290, #1311 | authorized Base + publication policies → dashboard/homepage/forms/apps | no ACL inheritance through embed, revoke/quotas/native readback |
| G. Выпуск | #1312 + все необходимые prerequisites | implementation revisions + evidence → release decision | все обязательные proof lanes закрыты, review, rollback rehearsal |

Волны отражают зависимости, не искусственные календарные сроки. Объём XL не является оценкой количества дней. Можно параллельно разрабатывать новые независимые файлы, но нельзя параллельно менять один existing registry или выдавать макеты за интегрированную функцию.

## Пакеты и точные интерфейсные границы

Каждый пакет ниже имеет подробный GitHub issue с отдельными критериями, файлами и негативными тестами.

| Пакет | Issue | Основной новый файл / владелец границы | Передаваемый результат |
|---|---|---|---|
| UTB-01 | #1296 | core/bases/table-surface.ts | versioned reference, не rows и не grants |
| UTB-02 | #1297 | server-core/src/bases/create-table.ts | canonical creation + embed receipts |
| UTB-03 | #1298 | server-core/src/bases/promotion-service.ts | previewDigest + loss report + host CAS |
| UTB-04 | #1299 | core/bases/button-field.ts | immutable action bindings → existing runId |
| UTB-05 | #1300 | shared/src/automations/table-loop-node.ts | durable loop frame, bounded scheduler wait |
| UTB-06 | #1301 | shared/src/automations/table-response-node.ts | typed caller result / single HTTP response |
| UTB-07 | #1302 | shared/src/automations/table-run-control.ts | cancel fence + terminal/partial receipt |
| UTB-08 | #1303 | server-core/src/bases/inbound-email-trigger.ts | verified delivery event + source refs |
| UTB-09 | #1304 | server-core/src/bases/field-policy-service.ts | current policy epoch + authorization |
| UTB-10 | #1305 | shared/src/automations/table-ai-node.ts | bounded context + validated proposal |
| UTB-11 | #1306 | core/bases/dashboard-layout.ts | Page-owned layout + same authorized query |
| UTB-12 | #1307 | core/bases/resource-contribution.ts | actor-scoped recents/deep-link reference |
| UTB-13 | #1308 | core/bases/group-layout.ts | native group mutation + order receipt |
| UTB-14 | #1309 | server-core/src/bases/sync-history.ts | durable job/checkpoint/freshness |
| UTB-15 | #1310 | server-core/src/bases/import/airtable.ts | staged source mapping + verified import |
| UTB-16 | #1311 | server-core/src/bases/publication-service.ts | scoped publication + configurable policy |
| UTB-17 | #1312 | tests/unified-tables/ | real end-to-end evidence / release gate |

Префиксы core/shared/server-core в таблице относятся к `packages/`. Renderer пути приведены в соответствующих issues. Они предлагаемые до начала конкретного пакета. Shared `workflow-control-contracts.ts`, editor и graph compiler имеют одного integration owner.

## Формат выполнения каждого следующего пакета

Прочитать issue + spec + существующие файлы; установить isolated branch от принятой dependency revision; записать owner и затрагиваемые общие пути. Сначала RED на действующий пользовательский/серверный результат, затем минимальная реализация, GREEN, negative control, restart/native readback. Записать команды, fixture seed, exact SHA/hash, фактический результат и blocked lanes. Code review проверяет native identity, side-effect idempotency, current ACL, отсутствие дубликатов owners и соответствие UI реальной capability.

**Review focus:** нельзя принять UI-only implementation; нельзя прятать missing capability за toast; нельзя считать client grants авторизацией; нельзя изменять immutable run version; нельзя хранить authoritative rows в embed/localStorage; нельзя переносить коммерческие лимиты или неаудированный код Baserow.
