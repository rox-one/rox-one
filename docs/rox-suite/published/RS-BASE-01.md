# RS-BASE-01 — Rox Base: типизированные записи и views Table/Board/Form поверх единого entity graph

## Запрос и ожидаемый результат

Drive → Создать → Rox Base; Project → Views; CRM Board использует shared record/view primitives.

Основание: пользовательские screenshots #5, #7. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Существующие Notes Base/Table — projections над Notes с limited formula enum. Требуется typed record/schema layer, но нельзя дублировать CRM/Task identity при построении views.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/pages/notes/note-views.ts#L5-L39](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/notes/note-views.ts#L5-L39) — NoteBaseView / NoteProjectionRow.
- [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L60-L106](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L60-L106) — NotesViewHost.
- [packages/core/src/rox2/platform-contract.ts#L16-L51](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L16-L51) — ROX2_ENTITY_KINDS / ROX2_RELATION_KINDS.

## Экран и UI

- Left base navigation: tables/views + «Добавить». Header title/share/viewtype; toolbar filter/sort/group/columns. Main virtualized grid и record drawer справа.
- Board grouping по enum/status с counts; drag меняет поле через CAS. Form view переиспользует Rox Forms schema. Cell editor contextual: date/calendar, member/entity picker, enumchips.
- Type icons, meaningful empty, skeleton без случайных sample records; read-only отображается явно.

## Inputs

- Field definition stable fieldId/name/type/required/options/default; types text/decimal/date/boolean/enum/entityRef/attachment/formula.
- CustomRecord values typed by schemaVersion; native projected Task/Company/Contact поля не копируются, лишь ссылки/authorizedcommands.
- Saved view predicate AST (не SQL), sort, groups, visible columns; owner/workspace + revision.

## Outputs

- Persisted table/view schema и records с validationErrors; provenance native entity сохраняется.
- Связь с Contact/Company/Task доступна из drawer; rollups уважают ACL каждого linked record, скрытые counts не раскрывают данные.

## Hover / focus / click / keyboard / UX

- Hover header показывает sort/menu; focus menu даёт label type/examples.
- Enter edit/commit, Esc cancel; Tab gridnav; dropdown keyboard; undo не откатывает чужие writes.
- Group drag у viewer запрещён; stale schema version требует refresh/reconcile без потери draft.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

CustomRecord как новый зарегистрированный entity kind; Base/Table/View — scoped schema containers. Existing Task/CRM entries use projections of canonical entities. Common policy/effects/search/activity/agents; no separate base-user or CRM storage.

## Commands / API / DB / events

PROPOSED base.createSchema/patchSchema/createRecord/updateRecord/queryView. Postgres typed payload validated under schemaVersion; serial migrations/backfills with shadow verification. Foreign links use EntityRef; events record.created/updated/schema.changed in shared outbox. No raw provider/query permissions from renderer.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/pages/notes/note-views.ts`, `apps/electron/src/renderer/pages/notes/NotesViewHost.tsx`, `packages/core/src/rox2/platform-contract.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `packages/shared/src/base/contracts.ts`
- `apps/workspace-service/src/modules/base/record-service.ts`
- `apps/electron/src/renderer/components/base/BaseEditor.tsx`
- `tests/rox-suite/base/records.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Create typed table → 3records → filtered Board → update status → reload; same record IDs in all views.
- [ ] Company viewed in Base still resolves CRM canonical ref and email/task context; two owners cannot overwrite schema concurrently.
- [ ] Viewer cannot mutate records via RPC/tool; private linked value/aggregation absent from search/export.

## Definition of Done

- [ ] UI/routing/input/output/help/keyboard/state contracts реализованы; loading/empty/error/denied/retry доступны и проверены.
- [ ] Persistence и reload; meaningful negative case; concurrency/reconnect где применимо; N/A обоснован в receipt.
- [ ] Общие grants, links, search, mentions, activity, notification и agent policy интегрированы для новой domain entity.
- [ ] Targeted tests + seeded broken control действительно отклоняется; regression existing route/authority пройдена.
- [ ] Linux domain/renderer evidence; реальные Electron screenshots/ARIA/theme/font после UI changes; provider lane только для реальных external effects.
- [ ] Source commit, exact diff, logs/hashes, expected/observed, миграция/rollback и независимое review приложены. Нельзя принимать экран без механизма.

## Cloud handoff

Статус: PLANNED_NOT_IMPLEMENTED / PREPARED_NOT_LAUNCHED. Работать в отдельном branch/worktree от exact inputSha, один writer на файл. Reference: cloud/macro-integration/EXECUTOR-CONTRACT.md; сначала согласовать новый RS scope/packet с scheduler, существующий 52-WP manifest не автоматически включает эту задачу. Proofs домена, browser, native и provider — отдельные lanes, только actual PASS.

## Dependencies / связанные issues

<!-- ROX-SUITE-LINKS -->
Dependencies: RS-DRV-01
- Related existing issue: https://github.com/rox-one/rox-one/issues/564
- Related existing issue: https://github.com/rox-one/rox-one/issues/381

## Complexity / риски

XL. Schema evolution/field deletion/data loss; inherited ACL and derived aggregations. Destructive migrations require explicit data review, no implicit drops.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-DRV-01 — #1109](https://github.com/rox-one/rox-one/issues/1109)
- Связанный ранее созданный issue: [#564](https://github.com/rox-one/rox-one/issues/564)
- Связанный ранее созданный issue: [#381](https://github.com/rox-one/rox-one/issues/381)

Specification ID: RS-BASE-01. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
