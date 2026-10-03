<!-- ROX-LARK-PACKAGE:LSX-WP-040 -->
# [ROX Suite Extension][LSX-WP-040] Docs/Bases domain-outbox→existing automation aliases

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Committed Doc/Task/Base events попадают existing WorkspaceEventBus через durable cursor и dedup; no duplicate trigger on watcher replay.

**Зачем:** Existing EventBus memory mechanism is not durable domain outbox.

**Новый granular slice:** Docs/Bases domain-outbox→existing automation aliases. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Mark event consumed before effect or generate fresh eventID on replay.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Registered legacy aliases сохраняются; eventID/cursor/receipt recoverable и replay dedup.
- Outbox consumer не теряет event и не публикует protected body; webhook RetryScheduler не объявляется general executor.

### Домен и источник истины

Сущности: `DomainOutboxEvent`, `ConsumerCheckpoint`, `TriggerOccurrence`.

Use existing domain outbox/inbox authority; adapter durable consumer checkpoint not second generic executor.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- eventId/ref/revision/actor/schema/correlation/causation/sourceCommandId
- durable owner outbox cursor
- registered legacy KnowledgeDocument*/Task aliases

### Выходы

- at-least-once registered trigger input
- dedup receipt/checkpoint
- dead-letter reason and manual repair reference

## UI / UX и основной сценарий

Existing run history shows source event/ref/revision/alias and delivery state, redacted detail.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Run source event / Delivery state | Показать registered alias, cursor/dedup/receipt и разрешённый event context. | eventId/entityRevision/sourceCommandId/correlation; sensitive body не bus shortcut. | Keyboard run-history detail/retry; replay использует тот же logical key. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Run source event / Delivery state» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Registered legacy aliases сохраняются; eventID/cursor/receipt recoverable и replay dedup.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `automation.readDomainEvents(cursor)`
- `automation.ackDomainEvent(eventId,consumerId)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Use existing domain outbox/inbox authority; adapter durable consumer checkpoint not second generic executor.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.revisionCommitted/base.fieldChanged/task.updated → registered aliases.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Event revision fence suppresses stale update/loop; same eventID stable across retries.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Event body resolved under workflow principal, not full protected payload in bus/log.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/shared/src/automations/event-bus.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts) | [`WorkspaceEventBus:224`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts#L224), [`EventPayloadMap:134`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts#L134), [`KnowledgeDocumentEventPayload:72`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts#L72) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/shared/src/automations/automation-system.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts) | [`AutomationSystem:80`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts#L80), [`AutomationSystemOptions:41`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts#L41) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/shared/src/automations/retry-scheduler.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/retry-scheduler.ts) | [`RetryScheduler:79`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/retry-scheduler.ts#L79), [`RetryQueueEntry:53`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/retry-scheduler.ts#L53) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/history-store.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/history-store.ts) | [`appendAutomationHistoryEntry:57`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/history-store.ts#L57), [`compactAutomationHistory:83`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/history-store.ts#L83) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/handlers/rpc/automations.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts) | [`registerAutomationsHandlers:151`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts#L151), [`withConfigMutex:28`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/automations.ts#L28) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |

### Proposed new files — отсутствуют в product baseline

- `packages/server-core/src/bases/automation-outbox-adapter.ts`
- `packages/core/src/bases/event-aliases.ts`
- `tests/lark-suite-extension/lsx-wp-040.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-040.spec.ts`

**Владение:** будущий implementation role — `automation-adapters`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Crash after native effect before ack и repeated watcher event: recover one logical trigger/effect.
- No ack-before-effect; causation budget/revision fences; revoked principal history без protected text.

Planned test files: `tests/lark-suite-extension/lsx-wp-040.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-040.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-040.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Mark event consumed before effect or generate fresh eventID on replay.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Registered legacy aliases сохраняются; eventID/cursor/receipt recoverable и replay dedup.
- Mutant должен нарушить и быть отвергнут assertion: Outbox consumer не теряет event и не публикует protected body; webhook RetryScheduler не объявляется general executor.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Registered legacy aliases сохраняются; eventID/cursor/receipt recoverable и replay dedup.
- [ ] Outbox consumer не теряет event и не публикует protected body; webhook RetryScheduler не объявляется general executor.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-003](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-003.md) — Атомарная запись Markdown с CAS/epoch/receipt.
- Требуется [LSX-WP-004](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-004.md) — Canonical Task field command с revision и partial receipts.
- Требуется [LSX-WP-007](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-007.md) — Сохраняемая BaseDefinition и private/shared views.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-AUT-01 / #1096](https://github.com/rox-one/rox-one/issues/1096). Узкая добавленная граница этого issue — «Docs/Bases domain-outbox→existing automation aliases» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-AUT-02 / #1097](https://github.com/rox-one/rox-one/issues/1097). Узкая добавленная граница этого issue — «Docs/Bases domain-outbox→existing automation aliases» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-EFFECTS`: Atomic native command/receipt/outbox recovery; reference Macro WP-04 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/21-implementation-plan.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-AUTOMATION`: Existing immutable run/version/step executor proved ready; no new builder; reference RS-AUT-01..05 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Domain atomic outbox authority external gate; safe event envelope fields and loop suppression versions required

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §1,3–5.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §8.
- [Карточка LSX-WP-040: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-040`.
