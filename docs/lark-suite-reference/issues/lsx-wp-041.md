<!-- ROX-LARK-PACKAGE:LSX-WP-041 -->
# [ROX Suite Extension][LSX-WP-041] Existing constructor typed Docs/Base nodes и field-ID mappings

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Registry предоставляет Query/Condition/DomainCommand/Event nodes для Doc/Base с validated inputs и same UI/MCP command path.

**Зачем:** No new builder; existing graph needs actual typed domain capabilities and ACL-aware mappings.

**Новый granular slice:** Existing constructor typed Docs/Base nodes и field-ID mappings. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Map fields by label or allow owner-wide query under workflow user assumptions.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Четыре Docs/Base node families проходят typed validation и existing dispatcher.
- FieldId mapping переживает label rename; removal блокирует publish; dry-run без effects и с simulation label.

### Домен и источник истины

Сущности: `TriggerSpec`, `TypedNodeMapping`, `WorkflowVersion`.

Node/schema versions reuse existing graph persistence; no second workflow store; removed field invalidates config.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- registered event/sourceRef filter
- fieldId mappings/typed AST/query limits
- native commandId + expectedRevision policy

### Выходы

- schema validation/port diagnostics
- scoped query rows + native DomainReceipt
- immutable schema versions in published workflow

## UI / UX и основной сценарий

RA-03 type-backed inspector/registry picker; missing scope/source shown; label rename valid, removed field publish blocked.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Node picker / Typed inspector | Настроить Doc/Base Event/Query/Condition/DomainCommand через existing graph. | Field ID/type/schemaVersion, principal scopes, limits и rename/removal validity. | Keyboard add/connect/inspect; validation фокусирует ошибочное поле/node. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Node picker / Typed inspector» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Четыре Docs/Base node families проходят typed validation и existing dispatcher.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `automation.validateDocsBaseNode(input)`
- `automation.previewNodeMapping(input)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Node/schema versions reuse existing graph persistence; no second workflow store; removed field invalidates config.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** workflow.validationChanged; registered domain events.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Draft revision separate run version; source schema event marks stale mapping, never changes running mapping silently.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Workflow least scope principal/current command ACL on each attempt; sanitizeForShell utility never treated authorization.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/shared/src/automations/graph.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts) | [`compileAutomationGraph:492`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L492), [`automationGraphRevision:212`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L212), [`buildAutomationGraphSave:538`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L538) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [apps/electron/src/renderer/components/automations/AutomationGraphWorkspaceEditor.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/components/automations/AutomationGraphWorkspaceEditor.tsx) | [`AutomationGraphWorkspaceEditor:18`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/components/automations/AutomationGraphWorkspaceEditor.tsx#L18) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/server-core/src/handlers/rpc/automations.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts) | [`registerAutomationsHandlers:151`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts#L151), [`withConfigMutex:28`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts#L28) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/platform/commands/registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/commands/registry.ts) | [`createCommandRegistry:64`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/commands/registry.ts#L64) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/security.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/security.ts) | [`sanitizeForShell:19`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/security.ts#L19) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/bases/automation-node-contracts.ts`
- `packages/shared/src/automations/docs-bases-nodes.ts`
- `apps/electron/src/renderer/components/automations/DocsBasesNodeInspector.tsx`
- `tests/lark-suite-extension/lsx-wp-041.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-041.spec.ts`

**Владение:** будущий implementation role — `automation-nodes`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Query viewer subset; null/denied Condition; field rename keeps mapping, removal blocks publish.
- UI/agent/workflow typed command schemas same; dry-run sim output stamped and effects disabled.

Planned test files: `tests/lark-suite-extension/lsx-wp-041.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-041.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-041.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Map fields by label or allow owner-wide query under workflow user assumptions.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Четыре Docs/Base node families проходят typed validation и existing dispatcher.
- Mutant должен нарушить и быть отвергнут assertion: FieldId mapping переживает label rename; removal блокирует publish; dry-run без effects и с simulation label.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Четыре Docs/Base node families проходят typed validation и existing dispatcher.
- [ ] FieldId mapping переживает label rename; removal блокирует publish; dry-run без effects и с simulation label.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-010](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-010.md) — Permission-aware query snapshot, cursor и totals.
- Требуется [LSX-WP-013](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-013.md) — Bounded formula engine и legacy built-ins.
- Требуется [LSX-WP-033](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-033.md) — Action Buttons typed registry и inert imports.
- Требуется [LSX-WP-040](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-040.md) — Docs/Bases domain-outbox→existing automation aliases.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-AUT-01 / #1096](https://github.com/rox-one/rox-one/issues/1096). Узкая добавленная граница этого issue — «Existing constructor typed Docs/Base nodes и field-ID mappings» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-AUT-03 / #1098](https://github.com/rox-one/rox-one/issues/1098). Узкая добавленная граница этого issue — «Existing constructor typed Docs/Base nodes и field-ID mappings» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-MCP-01 / #1113](https://github.com/rox-one/rox-one/issues/1113). Узкая добавленная граница этого issue — «Existing constructor typed Docs/Base nodes и field-ID mappings» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-AUTOMATION`: Existing immutable run/version/step executor proved ready; no new builder; reference RS-AUT-01..05 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-COMMANDS`: Registered command validator/current scoped actor and MCP dispatcher; reference Macro command lanes; RS-MCP-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-MCP-01.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Existing graph compiler narrows runtime action types; extension requires explicit version compatibility

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §1–3,5.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §6–7.
- [Карточка LSX-WP-041: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-041`.
