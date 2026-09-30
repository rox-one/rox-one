<!-- ROX-LARK-PACKAGE:LSX-WP-006 -->
# [ROX Suite Extension][LSX-WP-006] Stable block/node anchors без переписывания prose

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Doc/Map/Outline используют одну stable node identity; imported ^abc и ROX markers сохраняют mapping.

**Зачем:** Offset/title/duplicate quote неустойчивы после reorder и ломают links/comments.

**Новый granular slice:** Stable block/node anchors без переписывания prose. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Сгенерировать IDs из текущего offset или текста каждого parse.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- blockId/nodeId остаются стабильными при edit/reorder/reload; duplicate text не объединяется.
- Prose/tables/code вне дерева и unknown blocks сохраняются, mapping не переписывает источник на read.

### Домен и источник истины

Сущности: `BlockAnchor`, `ListNode`, `MarkerMapping`.

Versioned block map scoped to authority epoch; no text duplication into layout metadata.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- retained Markdown spans
- existing ROX marker or Obsidian block ID
- marker version + source revision

### Выходы

- typed tree with retained prose spans
- stable block↔node map
- duplicate/malformed diagnostic

## UI / UX и основной сценарий

Source badges/deep links resolve stable nodes; duplicate marker repair preview.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Открыть block / Исправить marker | Показать stable block↔node mapping и явный repair duplicate marker. | blockId, источник, contentRevision, markerVersion и retained prose. | Enter открывает stable deep link; repair требует preview/CAS. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Открыть block / Исправить marker» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: blockId/nodeId остаются стабильными при edit/reorder/reload; duplicate text не объединяется.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.getBlockTree(ref,revision)`
- `doc.previewMarkerMapping(ref,policy)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Versioned block map scoped to authority epoch; no text duplication into layout metadata.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.blockMappingChanged.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Tree projection built from committed source revision only.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Tree/quote content returned only after Doc read grant; IDs alone grant nothing.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/core/src/rox2/notes-engine.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts) | [`NativeNotesEngine:366`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L366), [`parseBlocks:137`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L137), [`contentHash:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L75) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [apps/electron/src/renderer/pages/notes/document-ia.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts) | [`extractBlockIds:182`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L182), [`parseNoteDocument:655`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L655), [`serializeColumns:228`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L228), [`roundTripNoteMarkdown:702`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L702) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/server-core/src/knowledge/vault-markdown.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts) | [`parseVaultMarkdown:115`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L115), [`noteIdFromRelativePath:77`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L77), [`ParsedVaultNote:54`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L54) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/docs/block-identity.ts`
- `packages/core/src/docs/list-tree.ts`
- `tests/lark-suite-extension/lsx-wp-006.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-006.spec.ts`

**Владение:** будущий implementation role — `docs-format`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Повторяющийся текст, reordered nodes, imported ^abc и ROX marker: IDs стабильны.
- Duplicate/malformed markers, frontmatter-first и opaque prose: diagnostic без silent merge.

Planned test files: `tests/lark-suite-extension/lsx-wp-006.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-006.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-006.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Сгенерировать IDs из текущего offset или текста каждого parse.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: blockId/nodeId остаются стабильными при edit/reorder/reload; duplicate text не объединяется.
- Mutant должен нарушить и быть отвергнут assertion: Prose/tables/code вне дерева и unknown blocks сохраняются, mapping не переписывает источник на read.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] blockId/nodeId остаются стабильными при edit/reorder/reload; duplicate text не объединяется.
- [ ] Prose/tables/code вне дерева и unknown blocks сохраняются, mapping не переписывает источник на read.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-005](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-005.md) — Lossless Markdown/YAML raw-span patch и field readback.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-DOC-01 / #1110](https://github.com/rox-one/rox-one/issues/1110). Узкая добавленная граница этого issue — «Stable block/node anchors без переписывания prose» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-NOTE-01 / #1112](https://github.com/rox-one/rox-one/issues/1112). Узкая добавленная граница этого issue — «Stable block/node anchors без переписывания prose» и приведённые acceptance/negative controls; весь epic не повторяется.

## Risks / complexity / delivery gates

Marker insertion itself is content mutation with preview/CAS; cannot stamp on every read

Relative complexity: **L**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §7–8,10.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §5,9.
- [Карточка LSX-WP-006: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-006`.
