# RS-AUT-04 — Automations: Debug, журнал узлов, ошибки, конфигурация и проверяемые результаты запусков

## Запрос и ожидаемый результат

Automations → canvas «Отладка»; left runtime navigation «Журнал / Ошибки / Конфигурация / Хранилище / Поиск».

Основание: пользовательские screenshots #8. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Test panel/history существуют. Расширить их node-attempt/effectreadback data, не обозначать testPassed как verifiedlive effect без receipt.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/components/automations/AutomationTestPanel.tsx#L1-L64](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/automations/AutomationTestPanel.tsx#L1-L64) — AutomationTestPanel.
- [packages/shared/src/automations/history-store.ts#L57-L81](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/history-store.ts#L57-L81) — appendAutomationHistoryEntry.
- [packages/shared/src/automations/event-logger.ts#L44-L80](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/event-logger.ts#L44-L80) — AutomationEventLogger.
- [packages/core/src/rox2/platform-contract.ts#L99-L117](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L99-L117) — Rox2Status / Rox2Receipt.

## Экран и UI

- Debugdrawer bottom orright: timeline nodeattempts/input/output/error/duration/retry; runselector with mode/status/time.
- Log search byrun/node/correlation event/severity; errors show cause/nextaction; Config read-only publishedsnapshot; Storage shows allowed scoped state, not arbitraryDB console.
- Output values collapsible schema tree, sensitive fields redacted; copy sanitized JSON and download proofbundle.

## Inputs

- RunId/attemptId/nodeId/range/filter; dryrun fixtureevent vs approvedlive test distinct; cancellation intent.

## Outputs

- Structured redactedlogs/hash/proofpaths; exact expected/observed result and providerreadback; failureclass infrastructure/baseline/assertion/provider.
- Diagnosticbundle with sourceSHA/workflowrevision/inputsmetadata no secrets/raw privatebodies bydefault.

## Hover / focus / click / keyboard / UX

- Hover node lastattemptsummary; click opensdurableattempt; keyboard lognavigation/filter/expand.
- Inspecting error/config never retries effects. Retry buttonexplicitlylinks operationId and dry/live mode.
- Streaming reconnect from cursor, duplicateentriesdeduped; never show fake progress when worker unavailable.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Read projections from workflow runtime receipts/logs, common Activity/Audit. Logs access independentlychecked from graphview; retentionconfig and boundedpayload; search permissionaware.

## Commands / API / DB / events

PROPOSED workflow.queryRuns/readAttempt/readLogs/exportProof; debug.run accepts mode+publishedrevision+scopedsample. ExistingAutomationTestPanel remains quickvalidation, new liveeffects require runtimegate.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/components/automations/AutomationTestPanel.tsx`, `packages/shared/src/automations/history-store.ts`, `packages/shared/src/automations/event-logger.ts`, `packages/core/src/rox2/platform-contract.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `apps/electron/src/renderer/components/automations/WorkflowDebugDrawer.tsx`
- `apps/workspace-service/src/modules/automations/run-queries.ts`
- `tests/rox-suite/automations/debug.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Failnode → redactedcause/inputs → fixdraft → freshattempt; oldattemptimmutable.
- [ ] Fixture and live clearlydistinct; live success requires readback receipt; timeoutunknown not green.
- [ ] Viewerwithgraphread butnologgrant cannot retrieveinputs viaRPC/export; reconnect resumes logs withoutduplicate.

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
Dependencies: RS-AUT-03
- Related existing issue: https://github.com/rox-one/rox-one/issues/569
- Related existing issue: https://github.com/rox-one/rox-one/issues/578

## Complexity / риски

M/L. Privatepayload leaks, unboundedhistory; optimistic status incorrectlyclaimssuccess.
