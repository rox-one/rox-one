# RS-AUT-02 — Automations: каталог connector actions, Auth и типизированные Input/Output/Error mappings

## Запрос и ожидаемый результат

Automation canvas → «+» → Connector → inspector tabs «Действие / Авторизация / Вход / Выход / Ошибка».

Основание: пользовательские screenshots #8. Lark используется как reference interaction pattern; UI воспроизводится на React и текущих ROX tokens. Скриншоты с частными данными не публикуются. Это новая задача реализации, её наличие не означает готовность продукта.

## Проверенное текущее состояние

Webhook actions/auth и destination checks существуют. Требуется schema-driven connector catalogue без хранения token внутри графа.

Source of truth: repository rox-one/rox-one, commit 249b3b44220bcfbd7d467de9cfc18f76e1c37807.

- [packages/shared/src/automations/types.ts#L82-L109](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/types.ts#L82-L109) — WebhookAuth / WebhookAction.
- [packages/shared/src/automations/webhook-utils.ts#L38-L116](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/webhook-utils.ts#L38-L116) — blockedWebhookDestination / blockedWebhookResolvedAddresses.
- [packages/shared/src/automations/graph.ts#L102-L146](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/shared/src/automations/graph.ts#L102-L146) — narrowRuntimeAction.
- [apps/electron/src/renderer/components/automations/AutomationEditor.tsx#L717-L766](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/automations/AutomationEditor.tsx#L717-L766) — AutomationEditor.

## Экран и UI

- Action tab search/groupedcatalog с summary andrequiredscopes; Auth displays connectedaccount/expiry/reconnect (never rawtoken).
- Input typedfield renderer с variablepicker previousnodes/entityevent и literal mode; Output schema tree with synthetic sample; Error retry/branchpolicy.
- Connector help hover/focus shows inputtype/units/example/provider/source; click opens versionedspec.

## Inputs

- Connector definition/version/actionId, JSONSchemas input/output/error, scopes; credentialRef account scoped workspace.
- Typed mapping AST, JSONPointer refs, constants; validate unavailable nodeoutputs, cycles and hiddenvalues.

## Outputs

- Compiled typed connector action; redacted sample/testresult; unresolved/revokedCredential diagnostics.
- External readback receipt + provider revision for write. Unknown timeoutstate kept unknownuntil reconcile, no automatic duplicate effects.

## Hover / focus / click / keyboard / UX

- Tab navigation and fieldfocus; selectingvariable shows source node and sensitivity; token fields masked.
- «Проверить подключение» is readprobe; «Тестировать действие» separately confirms exact effectpreview when policyrequires.
- Auth cancellation leaves draft and prior connection; account switch invalidates mapping bound identity.

Все labels/help/error copy — русский по умолчанию и i18n keys; наследовать текущую тему/font, проверить computed font в реальном Electron. Hover-help доступен также по focus и click. Motion 120–160 ms только opacity/transform, reduced-motion без анимации; цвет не единственный status. При ширине <1100 px inspector складывается в drawer, <800 px остаётся один активный pane с back-navigation.

## Домен / persistence / authority

ProviderConnection/AgentTool capability registry shared with MCP; workflow stores credentialRef only; execution service resolves ephemerally. Preserve existing SSRF checks incl DNS/redirectpolicy.

## Commands / API / DB / events

PROPOSED connection.describeCapabilities, workflow.validateMappings, connector.testAction; effect dispatch through authorizedtyped domaincommands/provider adapter. Connector-specific credentials and queue effects not renderer I/O.

PROPOSED означает target contract, не существующий endpoint. Actor/workspace/policy выводятся на сервере из session, не доверять renderer actorId. Новый command/schema регистрируется в общей authority и возвращает typed result; изменяющие команды несут operationId и expectedRevision.

## Permissions / search / notifications / agents

Единые grants и EntityRef; проверка read/write/share как на UI, так и RPC/IPC/MCP/provider. На revoke прекращаются writes/subscriptions и удаляются запрещённые caches. Search/mentions/links используют общий индекс и ACL. Activity/outbox → notifications с dedupe, без отдельного engine. Agent read/write использует те же commands/policy; preview никогда не совершает эффект. Для UI-only focus slice эти доменные изменения явно N/A.

## Изменяемые файлы и новые артефакты

Existing seams: `packages/shared/src/automations/types.ts`, `packages/shared/src/automations/webhook-utils.ts`, `packages/shared/src/automations/graph.ts`, `apps/electron/src/renderer/components/automations/AutomationEditor.tsx`. Изменять только необходимые seams и утверждённый scope, не все перечисленные файлы автоматически.

Proposed NEW paths (до реализации отсутствуют):

- `packages/shared/src/automations/connector-contracts.ts`
- `apps/workspace-service/src/modules/automations/connector-registry.ts`
- `apps/electron/src/renderer/components/automations/ConnectorInspector.tsx`
- `tests/rox-suite/automations/connectors.spec.ts`

## План вертикальных slices

1. Воспроизвести baseline и закрепить source SHA; уточнить typed contracts/owned files и отрицательный сценарий.
2. Реализовать первый usable scenario целиком: данные → command/query → UI → persisted reload → permissions.
3. Добавить нужную concurrency/recovery/export/provider часть с наблюдаемыми receipts; внешние effects сверять readback.
4. Проверить реальные UI states и соседние existing ROX scenarios; сделать review и миграционный rollback.

## Acceptance criteria

- [ ] Select Mail createDraft action → bind Event sender → schema validates → readback same draft; fixture explicitly fixture.
- [ ] Revokedcredential/insufficientScopes/blockedURL fail safely, no token in logs/graph/export.
- [ ] Wrong outputtype refused before run; ambiguous provider timeout yields reconcile-required, not duplicate retry.

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
Dependencies: RS-AUT-01, RS-MCP-01
- Related existing issue: https://github.com/rox-one/rox-one/issues/569
- Related existing issue: https://github.com/rox-one/rox-one/issues/566

## Complexity / риски

L. Provider scope and SSRF bypass, token leakage, licence/version drift of third-party connectors.
