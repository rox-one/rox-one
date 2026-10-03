<!-- ROX-LARK-PACKAGE:LSX-WP-042 -->
# [ROX Suite Extension][LSX-WP-042] Revision-pinned artifact/approval nodes и safe retry receipts

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Document artifact/approval step pins immutable revision+payload digest; changed Doc invalidates request, restart retains classified step receipts.

**Зачем:** Approval of old digest or retry with new side effect key can sign/send different content twice.

**Новый granular slice:** Revision-pinned artifact/approval nodes и safe retry receipts. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Approve changed revision under old digest or retry logical step with new key.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Approval/artifact привязаны к immutable Doc revision и exact digest.
- Current ACL на resume/replay; stable logical step key, explicit unknown external result/partial cancellation; timeout не approve.

### Домен и источник истины

Сущности: `ArtifactManifest`, `ApprovalCheckpoint`, `StepReceipt`.

Reuse runtime run/version/step store after proof; adapter receipts reference native artifact/approval owners; no new approval product.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- Doc ref/revision/theme + export format
- approval policy/exact command payloadDigest/deadline
- logical step idempotency key + retry/cancel state

### Выходы

- authorized FileRef/hash receipt
- waiting/approved/rejected/expired checkpoint decisionRef
- queuedProvider/unknownExternalResult distinct outcome

## UI / UX и основной сценарий

RA-05/06/07/08 declare effects/recipients/revision; redacted input/output, partial cancellation receipts; no timeout autoapprove.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Artifact / Digest approval | Preview exact Doc revision/artifact/effects; ожидать authorized decision по неизменному digest. | Immutable run/schema version, approver policy, queued/unknown/ACK и committed partial effects. | Keyboard review/decision/cancel; timeout не approve; changed digest запрещает apply. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Artifact / Digest approval» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Approval/artifact привязаны к immutable Doc revision и exact digest.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `automation.previewDocumentArtifact(input)`
- `automation.applyDigestDecision(runId,decision,digest)`
- `automation.reconcileDocumentStep(stepRef)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Reuse runtime run/version/step store after proof; adapter receipts reference native artifact/approval owners; no new approval product.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** artifact.created; workflow.runChanged; approval.decisionRecorded.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Published version freeze; duplicate event/after-effect crash reconciles same key; cancel unstarted steps, committed effects visible.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Approver/current scope revalidated on resume/replay; altered digest invalidates signed approval; assets export checked.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/shared/src/automations/graph.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts) | [`compileAutomationGraph:492`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L492), [`automationGraphRevision:212`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L212), [`buildAutomationGraphSave:538`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L538) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/automation-system.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts) | [`AutomationSystem:80`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts#L80), [`AutomationSystemOptions:41`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts#L41) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/shared/src/automations/retry-scheduler.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/retry-scheduler.ts) | [`RetryScheduler:79`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/retry-scheduler.ts#L79), [`RetryQueueEntry:53`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/retry-scheduler.ts#L53) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/history-store.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/history-store.ts) | [`appendAutomationHistoryEntry:57`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/history-store.ts#L57), [`compactAutomationHistory:83`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/history-store.ts#L83) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/server-core/src/handlers/rpc/automations.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts) | [`registerAutomationsHandlers:151`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts#L151), [`withConfigMutex:28`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts#L28) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/rox2/platform-contract.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts) | [`Rox2EntityRef:233`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L233), [`registerExternalBinding:336`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L336), [`authorizeRox2Action:601`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L601) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/shared/src/automations/document-artifact-nodes.ts`
- `packages/server-core/src/docs/workflow-artifact-adapter.ts`
- `tests/lark-suite-extension/lsx-wp-042.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-042.spec.ts`

**Владение:** будущий implementation role — `automation-nodes`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Doc changed during approval invalidates digest; revoked approver/timeout cannot approve.
- After-effect crash replay uses same receipt/key; cancel показывает committed effects и unknown provider state.

Planned test files: `tests/lark-suite-extension/lsx-wp-042.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-042.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-042.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Approve changed revision under old digest or retry logical step with new key.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Approval/artifact привязаны к immutable Doc revision и exact digest.
- Mutant должен нарушить и быть отвергнут assertion: Current ACL на resume/replay; stable logical step key, explicit unknown external result/partial cancellation; timeout не approve.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Approval/artifact привязаны к immutable Doc revision и exact digest.
- [ ] Current ACL на resume/replay; stable logical step key, explicit unknown external result/partial cancellation; timeout не approve.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-033](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-033.md) — Action Buttons typed registry и inert imports.
- Требуется [LSX-WP-036](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-036.md) — Map/Outline exports MD/OPML/Canvas/PNG/SVG.
- Требуется [LSX-WP-040](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-040.md) — Docs/Bases domain-outbox→existing automation aliases.
- Требуется [LSX-WP-041](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-041.md) — Existing constructor typed Docs/Base nodes и field-ID mappings.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-AUT-02 / #1097](https://github.com/rox-one/rox-one/issues/1097). Узкая добавленная граница этого issue — «Revision-pinned artifact/approval nodes и safe retry receipts» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-AUT-04 / #1099](https://github.com/rox-one/rox-one/issues/1099). Узкая добавленная граница этого issue — «Revision-pinned artifact/approval nodes и safe retry receipts» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-APR-01 / #1117](https://github.com/rox-one/rox-one/issues/1117). Узкая добавленная граница этого issue — «Revision-pinned artifact/approval nodes и safe retry receipts» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-SIG-01 / #1119](https://github.com/rox-one/rox-one/issues/1119). Узкая добавленная граница этого issue — «Revision-pinned artifact/approval nodes и safe retry receipts» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-AUTOMATION`: Existing immutable run/version/step executor proved ready; no new builder; reference RS-AUT-01..05 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-APPROVAL`: Existing approval/signature owner exact digest/decision/revoke proof; reference RS-APR-01/RS-SIG-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-APR-01.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Generic runtime durability/approval/signature are existing RS scopes; adapter cannot claim their implementation

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §3–5.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §7–8.
- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §9.
- [Карточка LSX-WP-042: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-042`.
