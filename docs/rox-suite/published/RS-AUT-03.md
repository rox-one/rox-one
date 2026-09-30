# RS-AUT-03 — Automations: durable event workflow runtime с Scheduler, DateTime, ветвлениями и возобновлением

## Запрос и ожидаемый результат

Canvas executable nodes; automation launched by canonical domain event or schedule, status in existing Automation history.

Основание: пользовательские screenshots #8. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Существующий runtime исполняет matchers/actions; graph отдельного executor не имеет. Необходимо осознанное versioned расширение одного runtime, а не трактовка нынешнего decision expression как уже работающей ветки.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [packages/shared/src/automations/event-bus.ts#L224-L250](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/event-bus.ts#L224-L250) — WorkspaceEventBus.
- [packages/shared/src/automations/automation-system.ts#L80-L112](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/automation-system.ts#L80-L112) — AutomationSystem.
- [packages/shared/src/automations/retry-scheduler.ts#L79-L115](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/retry-scheduler.ts#L79-L115) — RetryScheduler.
- [packages/shared/src/automations/types.ts#L383-L437](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/types.ts#L383-L437) — metadata-only decision nodes.
- [packages/shared/src/automations/graph.ts#L1-L9](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/graph.ts#L1-L9) — graph projection invariant.

## Экран и UI

- Nodeexecution state queued/running/waitingapproval/succeeded/failed/cancelled/unknown andprogress visible in canvas, но persistedrunhistory authority.
- Scheduler inspector timezone/cron next5runs; DateTimeHelper explicit input/timezone/outputformat; Condition typed branches yes/no/error.
- Wait/Approval node shows deadline/resumecondition; cancellation does not imply external write undone.

## Inputs

- Canonical outbox event id/actor/entityRef/policyEpoch/causation; schedule timezone DST/occurrenceId; workflow publishedRevision.
- Compiled nodes immutable inputs, executionprincipal scopes/budget; operationId stable pereffect/attempt; replaycursor.

## Outputs

- Durable WorkflowRun/NodeAttempt/effectreceipt; logsredacted; distinct executionMode/lifecycle/verification.
- Deduped single externalintent; event/runs correlation IDs; resume checkpoint and deadletter actionable reason.

## Hover / focus / click / keyboard / UX

- Hover status describes event source/freshness; click opens exactattempt not aggregate guess.
- Editing draft never modifies currentrun; cancel previews pending/started effects, reconciles unknowneffects.
- Manualretry chooses failed idempotentstep, no wholegraph replay of irreversible actions by default.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Versioned automation definition and durable state managed by same workspace command/event authority. Postgres run/node/effect/outbox/lease tables, fenced workers. Legacy linearmatchers compile under v1 semantic compatibility, new graph v2 compiler verifiedmigration.

## Commands / API / DB / events

PROPOSED workflow.publish/start/cancel/resume/reconcile; Scheduler emits occurrence intent with deterministic key; domain outbox fanout → authorizedworkflow. At-least-once delivery with deduplication, no claim exactly-once provider guarantees; policychecked each resumed effect.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `packages/shared/src/automations/event-bus.ts`, `packages/shared/src/automations/automation-system.ts`, `packages/shared/src/automations/retry-scheduler.ts`, `packages/shared/src/automations/types.ts`, `packages/shared/src/automations/graph.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `packages/shared/src/automations/runtime-contracts.ts`
- `apps/workspace-service/src/modules/automations/workflow-runtime.ts`
- `apps/workspace-service/src/modules/automations/workflow-worker.ts`
- `tests/rox-suite/automations/recovery.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] email.received → DateTimeHelper → Condition → createTask; one task after duplicateevent and workercrash.
- [ ] DST recurrence preview equals runtime; stale worker fence cannot commit; approval revoked whilepaused blocks next effect.
- [ ] Legacyautomation roundtrip remains equivalent; graph cycle/version unsupported fails with explicitdiagnostic, unknown external effect reconciles.

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
Dependencies: RS-AUT-01, RS-AUT-02
- Related existing issue: https://github.com/rox-one/rox-one/issues/569

## Complexity / риски

XL. Distributed effects/retries, privilege inheritance, DST/notification loops. Newtypes require data migration and eventdedupe before enabling.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-AUT-01 — #1096](https://github.com/rox-one/rox-one/issues/1096)
- Требуется [RS-AUT-02 — #1097](https://github.com/rox-one/rox-one/issues/1097)
- Связанный ранее созданный issue: [#569](https://github.com/rox-one/rox-one/issues/569)

Specification ID: RS-AUT-03. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
