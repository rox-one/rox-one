<!-- ROX-LARK-PACKAGE:LSX-WP-005 -->
# [ROX Suite Extension][LSX-WP-005] Lossless Markdown/YAML raw-span patch и field readback

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Изменение одного frontmatter field сохраняет все неизвестные YAML comments, EOL/BOM и неотредактированные bytes.

**Зачем:** Full YAML serialization меняет чужие свойства и portable исходник.

**Новый granular slice:** Lossless Markdown/YAML raw-span patch и field readback. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Заменить retained patcher полной YAML stringify/body normalization.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Неизменённые raw bytes, unknown YAML/comments/BOM/EOL сохраняются; no-op byte-identical.
- Malformed/unsupported YAML остаётся recoverable/read-only и не заменяется пустыми properties.

### Домен и источник истины

Сущности: `RetainedSource`, `RawSpanPatch`, `PropertyBinding`.

Retained CST/source snapshot; unknown YAML preserved; cache never authority.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- raw UTF-8 bytes + source hash
- typed key path/value + expectedRevision
- CST spans and markerMappingVersion

### Выходы

- exact changed spans + loss report
- byte-identical no-op
- patched source through doc.commitMarkdown

## UI / UX и основной сценарий

Property editor shows raw key/unit/type and proposed diff; unsupported YAML keeps read-only/repair-copy.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Изменить property / Показать diff | Preview raw-span YAML patch и применить его через Doc CAS. | Portable key, тип, единицы и точные изменяемые spans; неизвестные YAML остаются. | Tab перемещает focus по diff; Enter подтверждает, Escape ничего не записывает. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Изменить property / Показать diff» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Неизменённые raw bytes, unknown YAML/comments/BOM/EOL сохраняются; no-op byte-identical.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.previewPropertyPatch(ref,fieldId,value)`
- `doc.applyPropertyPatch(envelope)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Retained CST/source snapshot; unknown YAML preserved; cache never authority.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.revisionCommitted with changed property IDs.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Property and body projections refresh at one committed revision.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Same Doc field edit/export grants; denied properties unavailable to diff previews.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/server-core/src/handlers/rpc/notes.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts) | [`saveNote:502`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L502), [`registerNotesHandlers:974`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L974), [`updateNoteProperties:608`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L608) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/rox2/notes-engine.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts) | [`NativeNotesEngine:366`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L366), [`parseBlocks:137`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L137), [`contentHash:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L75) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/knowledge/vault-markdown.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts) | [`parseVaultMarkdown:115`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L115), [`noteIdFromRelativePath:77`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L77), [`ParsedVaultNote:54`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L54) | Read-only source evidence; worker не изменяет этот файл. |
| [apps/electron/src/renderer/pages/notes/document-ia.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts) | [`extractBlockIds:182`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L182), [`parseNoteDocument:655`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L655), [`serializeColumns:228`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L228), [`roundTripNoteMarkdown:702`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L702) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/docs/retained-source.ts`
- `packages/core/src/docs/frontmatter-patches.ts`
- `tests/lark-suite-extension/lsx-wp-005.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-005.spec.ts`

**Владение:** будущий implementation role — `docs-format`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- BOM/CRLF/YAML comments/unknown tags/anchors/multiline: byte diff только в выбранном span.
- No-op hash equality; malformed YAML и external edit после preview не overwrite.

Planned test files: `tests/lark-suite-extension/lsx-wp-005.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-005.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-005.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Заменить retained patcher полной YAML stringify/body normalization.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Неизменённые raw bytes, unknown YAML/comments/BOM/EOL сохраняются; no-op byte-identical.
- Mutant должен нарушить и быть отвергнут assertion: Malformed/unsupported YAML остаётся recoverable/read-only и не заменяется пустыми properties.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Неизменённые raw bytes, unknown YAML/comments/BOM/EOL сохраняются; no-op byte-identical.
- [ ] Malformed/unsupported YAML остаётся recoverable/read-only и не заменяется пустыми properties.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-003](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-003.md) — Атомарная запись Markdown с CAS/epoch/receipt.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-NOTE-01 / #1112](https://github.com/rox-one/rox-one/issues/1112). Узкая добавленная граница этого issue — «Lossless Markdown/YAML raw-span patch и field readback» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-EFFECTS`: Atomic native command/receipt/outbox recovery; reference Macro WP-04 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/21-implementation-plan.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

YAML aliases/complex keys require explicit unsupported diagnostic; portable key rename separate migration

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §1,8,10.
- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §10–11.
- [Карточка LSX-WP-005: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-005`.
