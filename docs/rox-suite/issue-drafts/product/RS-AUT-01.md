# RS-AUT-01 — Automations: расширить текущий граф до визуального canvas с palette, ports и inspector

## Запрос и ожидаемый результат

Существующие Automations → выбранная automation → «Граф»; тот же ID и workspace, простой редактор остаётся совместимой projection.

Основание: пользовательские screenshots #8. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Graph editor уже есть. Graph — metadata над canonical automations config; decision nodes сейчас metadata-only, не executable conditionbranch. Задача расширяет этот механизм.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx#L1-L110](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx#L1-L110) — AutomationGraphEditor.
- [packages/shared/src/automations/graph.ts#L1-L66](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/graph.ts#L1-L66) — compileAutomationGraph / graph authoring projection.
- [packages/shared/src/automations/types.ts#L314-L437](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/types.ts#L314-L437) — AutomationGraphNodeKind / AutomationGraphDecisionNode.

## Экран и UI

- Canvas dottedbackground, zoom/fit/minimap bottom, undo/redo; palette слева 240px, inspector справа 320px; top name/draftstate/debug/publish.
- Nodes compact icon/name/kind/status/inputports/outputports; ports минимум hitbox24px, wires labelled branch/error. «+» на edge открывает поиск compatible nodetypes.
- Node kinds palette Scheduler, Event, DateTimeHelper, Condition, EntityCommand, Connector, ApprovalWait; поддержку новых исполняемых kinds блокирует RS-AUT-03 runtime until verified.

## Inputs

- GraphRevision stable node/edge IDs, position, config schemaVersion; insert/reorder/connect/disconnect operations expectedRevision.
- Zoom/pan/selection userprefs отдельно от executable config; invalid edges/cycles/orphannodes highlighted.

## Outputs

- Validated graph draft, diagnostics per node/edge; compiler projection preserves supported legacy fields.
- Save/reload samegraph; unsupported executable kind не silentlytreated as annotation.

## Hover / focus / click / keyboard / UX

- Hover node показывает caption и laststatusбезexecution; click selects inspector; doubleclick opensconfig, focus retains selection.
- Keyboard addnode/menu/delete/undo, arrowsmove, Esc closepalette; pan/zoom no focus trap; fit uses actualviewport.
- Edge hover shows source→target/type; conflict banner offers compare/reload/rebase; no autosave publishing.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

Extend AutomationGraphEditor, shared graph/types/schemas and existing authority. В ЭТОМ первом slice внедрить non-executing Draft и immutable PublishedRevision foundation: saveDraft никогда не пишет runtime config; минимальный explicit publish с CAS/policy/validated checksum — единственный activate path. Legacy scheduler/writer cutover сериализуется: старый config получает migration snapshot/readback, после fence только published projection читается runtime, не две editable authorities. Незавершённые эффекты reconcile, disabled matchers не auto-enable. New executable nodes включаются только после RS-AUT-03. Diagram layout не второй источник truth.

## Commands / API / DB / events

Existing graph save+baseRevision адаптировать к workflow.saveDraft; добавить foundation workflow.publish/compareRevision в тот же gateway сейчас. Существующий onSave→canonical config нельзя использовать для draft. Draft/PublishedRevision persistence, cutover миграция и минимальный publish review входят в RS-AUT-01; RS-AUT-05 расширяет UX, не создаёт этот foundation повторно. ACL workspace write, shared entity permissions. Graph diagnostics do not send effects.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx`, `packages/shared/src/automations/graph.ts`, `packages/shared/src/automations/types.ts`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `apps/electron/src/renderer/components/automations/NodePalette.tsx`
- `apps/electron/src/renderer/components/automations/NodeInspector.tsx`
- `tests/rox-suite/automations/canvas.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Load legacygraph → addannotation/move → save/reload remains equivalent runtime config.
- [ ] Invalid edge/cycle/type blocked with precise diagnostic; keyboard produces same validgraph as pointer.
- [ ] Unimplemented executable nodes marked unavailable; click/hover/debug/saveDraft sends no effects. Negative: seed draft write to live automations.json → assertion catches scheduler invocation. Active legacy scheduler cannot read drafts; stale publish/conflicting writer rejected.

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
Самостоятельный slice; общие registry/policy seams используются из текущего ROX или проверенных prerequisites.
- Related existing issue: https://github.com/rox-one/rox-one/issues/569

## Complexity / риски

L. Roundtrip loss of legacymatcher/action fields; diagram pretending executable. Metadata-only decision kept until migration gate.
