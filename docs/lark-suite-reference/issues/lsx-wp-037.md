<!-- ROX-LARK-PACKAGE:LSX-WP-037 -->
# [ROX Suite Extension][LSX-WP-037] Checkbox→native Task и TaskNotes origin mapping

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Promote checkbox создаёт existing PersonalTask один раз и связывает source block; повторный click открывает ту же Task.

**Зачем:** Portable one-note-per-task representation must not become competing task authority.

**Новый granular slice:** Checkbox→native Task и TaskNotes origin mapping. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Use title or nativeID-only dedup or change legacy taskCount after promotion.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- На sourceRef+blockId+conversionKind создаётся одна scoped native Task; repeat открывает её.
- Completion читается из native owner; legacy Markdown counts и native relation counts остаются раздельными.

### Домен и источник истины

Сущности: `TaskSourceLink`, `PromotionReceipt`, `TaskNotesMapping`.

PersonalTask remains authority; origin mapping durable; portable Markdown rox.entity_id explicit and readback.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- sourceRef/blockId/revision + scoped owner
- recognized title/status/date/tags/recurrence + raw unmapped props
- idempotency sourceRef+blockId+conversionKind

### Выходы

- one native Task ref/revision
- source link/provenance and checkbox projection
- TaskNotes field mapping/import losses

## UI / UX и основной сценарий

Preview title/date/context/recurrence ambiguities; open native detail after repeat; raw props retained.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Promote checkbox / TaskNotes mapping | Preview source block/dates/context и создать одну native Task по origin key. | SourceRef+blockId+conversionKind, personal owner, raw unmapped properties и separate counts. | Enter подтверждает preview; повторный click открывает существующую Task. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Promote checkbox / TaskNotes mapping» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: На sourceRef+blockId+conversionKind создаётся одна scoped native Task; repeat открывает её.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.previewTaskPromotion(input)`
- `doc.promoteTask(envelope)`
- `task.previewMarkdownMapping(input)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

PersonalTask remains authority; origin mapping durable; portable Markdown rox.entity_id explicit and readback.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** task.created; entity.linked.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Native completion projects checkbox; legacy Markdown formula counts stay separate from native relation count.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Source read/edit plus personal Task create binding; no implicit sharing or provider-account import.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/core/src/tasks/personal/store.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/store.ts) | [`PersonalTaskStore:73`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/store.ts#L73), [`CreateTaskInput:32`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/store.ts#L32) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/tasks/personal/types.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts) | [`PersonalTask:42`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L42), [`TaskLink:17`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L17), [`Recurrence:24`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L24) | Read-only source evidence; worker не изменяет этот файл. |
| [apps/electron/src/renderer/pages/notes/note-views.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts) | [`NoteBaseView:24`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L24), [`projectNoteRows:133`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L133), [`formulaValue:188`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L188), [`notesViewsStorageKey:100`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L100) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/server-core/src/knowledge/vault-markdown.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts) | [`parseVaultMarkdown:115`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L115), [`noteIdFromRelativePath:77`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L77), [`ParsedVaultNote:54`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L54) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/core/src/tasks/personal/dates.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/dates.ts) | [`parseNlDate:35`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/dates.ts#L35), [`localDayKey:5`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/dates.ts#L5) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/server-core/src/tasks/markdown-task-adapter.ts`
- `apps/electron/src/renderer/pages/docs/TaskPromotionPreview.tsx`
- `tests/lark-suite-extension/lsx-wp-037.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-037.spec.ts`

**Владение:** будущий implementation role — `tasks-portability`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Duplicate click/reimport одна Task; same blockID в другой source создаёт другую Task.
- Checkbox/native completion sync; legacy3/native1 remain separate; unmapped properties retained.

Planned test files: `tests/lark-suite-extension/lsx-wp-037.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-037.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-037.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Use title or nativeID-only dedup or change legacy taskCount after promotion.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: На sourceRef+blockId+conversionKind создаётся одна scoped native Task; repeat открывает её.
- Mutant должен нарушить и быть отвергнут assertion: Completion читается из native owner; legacy Markdown counts и native relation counts остаются раздельными.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] На sourceRef+blockId+conversionKind создаётся одна scoped native Task; repeat открывает её.
- [ ] Completion читается из native owner; legacy Markdown counts и native relation counts остаются раздельными.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-004](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-004.md) — Canonical Task field command с revision и partial receipts.
- Требуется [LSX-WP-006](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-006.md) — Stable block/node anchors без переписывания prose.
- Требуется [LSX-WP-034](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-034.md) — Portable vault import staged identities/attachments.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-NOTE-01 / #1112](https://github.com/rox-one/rox-one/issues/1112). Узкая добавленная граница этого issue — «Checkbox→native Task и TaskNotes origin mapping» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-BASE-01 / #1094](https://github.com/rox-one/rox-one/issues/1094). Узкая добавленная граница этого issue — «Checkbox→native Task и TaskNotes origin mapping» и приведённые acceptance/negative controls; весь epic не повторяется.

## Risks / complexity / delivery gates

Recurrence conversion needs explicit occurrence key; unsupported RRULE kept diagnostic not guessed

Relative complexity: **L**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §9,11.
- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §9.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §6.
- [Карточка LSX-WP-037: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-037`.
