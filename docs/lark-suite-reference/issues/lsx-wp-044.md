<!-- ROX-LARK-PACKAGE:LSX-WP-044 -->
# [ROX Suite Extension][LSX-WP-044] Form submission→native Task/Base recipe без второй task DB

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Accepted Forms submission uses typed mapped fields to create one native Task+source link; Base displays same ref.

**Зачем:** This is a proof recipe of shared owners, not duplicate Forms or Help Desk implementation.

**Новый granular slice:** Form submission→native Task/Base recipe без второй task DB. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Dedup by responseID alone or create Task in Base-local rows.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Accepted Form event создаёт одну native Task/source link; Base показывает тот же Task ref.
- Typed native validators/least scope соблюдены; event replay даёт одну intended assignment notification.

### Домен и источник истины

Сущности: `FormResponseRef`, `TaskSourceLink`, `StepReceipt`.

No new Form store; consume existing owner event/response; task origin mapping authoritative in Task adapter.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- verified form submission eventID/ref/schemaVersion
- typed title/due/project/owner mapping
- native Task source binding + idempotency submission key

### Выходы

- one native Task receipt/ref/revision
- form source response link
- Base/Tasks same row + intended assignment receipt

## UI / UX и основной сценарий

Existing node inspector validates submission schema and preview; invalid field/missing capability prevents publish.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Form→Task mapping preview | Сопоставить typed accepted response fields и native Task owner. | Form schemaVersion/source namespace/Task create grants и submission idempotency. | Keyboard node inspector; removed field блокирует publish; receipt открывает native Task. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Form→Task mapping preview» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Accepted Form event создаёт одну native Task/source link; Base показывает тот же Task ref.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `automation.previewSubmissionTaskMapping(input)`
- `automation.applySubmissionTaskMapping(eventId)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

No new Form store; consume existing owner event/response; task origin mapping authoritative in Task adapter.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** form.responseAccepted → task.created/entity.linked.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Duplicate accepted event one Task and one notification; validation errors visible terminal/repair.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Form response read + native Task create/source binding; bot least scope; notification only intended permitted assignee.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/core/src/tasks/personal/store.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/store.ts) | [`PersonalTaskStore:73`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/store.ts#L73), [`CreateTaskInput:32`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/store.ts#L32) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/core/src/tasks/personal/types.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts) | [`PersonalTask:42`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L42), [`TaskLink:17`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L17), [`Recurrence:24`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L24) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/graph.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts) | [`compileAutomationGraph:492`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L492), [`automationGraphRevision:212`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L212), [`buildAutomationGraphSave:538`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L538) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/automation-system.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts) | [`AutomationSystem:80`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts#L80), [`AutomationSystemOptions:41`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/automation-system.ts#L41) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/shared/src/automations/event-bus.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts) | [`WorkspaceEventBus:224`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts#L224), [`EventPayloadMap:134`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts#L134), [`KnowledgeDocumentEventPayload:72`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/event-bus.ts#L72) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |

### Proposed new files — отсутствуют в product baseline

- `packages/shared/src/automations/recipes/form-native-task.ts`
- `packages/core/src/bases/submission-task-mapping.ts`
- `tests/lark-suite-extension/lsx-wp-044.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-044.spec.ts`

**Владение:** будущий implementation role — `automation-recipes`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Duplicate accepted event after crash: one Task/source link/intended notification.
- Different form source same responseID distinct; schema field removed blocks mapping/publish.

Planned test files: `tests/lark-suite-extension/lsx-wp-044.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-044.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-044.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Dedup by responseID alone or create Task in Base-local rows.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Accepted Form event создаёт одну native Task/source link; Base показывает тот же Task ref.
- Mutant должен нарушить и быть отвергнут assertion: Typed native validators/least scope соблюдены; event replay даёт одну intended assignment notification.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Accepted Form event создаёт одну native Task/source link; Base показывает тот же Task ref.
- [ ] Typed native validators/least scope соблюдены; event replay даёт одну intended assignment notification.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-004](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-004.md) — Canonical Task field command с revision и partial receipts.
- Требуется [LSX-WP-037](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-037.md) — Checkbox→native Task и TaskNotes origin mapping.
- Требуется [LSX-WP-040](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-040.md) — Docs/Bases domain-outbox→existing automation aliases.
- Требуется [LSX-WP-041](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-041.md) — Existing constructor typed Docs/Base nodes и field-ID mappings.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-FORM-01 / #1095](https://github.com/rox-one/rox-one/issues/1095). Узкая добавленная граница этого issue — «Form submission→native Task/Base recipe без второй task DB» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-AUT-05 / #1100](https://github.com/rox-one/rox-one/issues/1100). Узкая добавленная граница этого issue — «Form submission→native Task/Base recipe без второй task DB» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-BASE-01 / #1094](https://github.com/rox-one/rox-one/issues/1094). Узкая добавленная граница этого issue — «Form submission→native Task/Base recipe без второй task DB» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-FORMS`: Existing accepted response event/schema owner and payload grant; reference RS-FORM-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-FORM-01.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-ATTENTION`: One durable intended-recipient notification/reminder owner; reference Macro WP-07 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/15-search-notifications.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-AUTOMATION`: Existing immutable run/version/step executor proved ready; no new builder; reference RS-AUT-01..05 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Existing Form runtime/status must be proven; accepted event cannot be inferred from UI submit click

Relative complexity: **L**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §4.
- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §9.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §1,8.
- [Карточка LSX-WP-044: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-044`.
