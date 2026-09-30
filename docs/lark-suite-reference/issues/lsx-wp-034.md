<!-- ROX-LARK-PACKAGE:LSX-WP-034 -->
# [ROX Suite Extension][LSX-WP-034] Portable vault import staged identities/attachments

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

MD vault import показывает collision/privacy/path/type mappings и применяет идемпотентно к existing owners.

**Зачем:** Folder/title is not identity and portable bundle cannot grant access.

**Новый granular slice:** Portable vault import staged identities/attachments. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Trust imported workspace grant or merge by filename/title instead of origin.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Source-scoped import mapping сохраняет IDs/raw bytes/assets и resumable per-file receipts.
- Повторный origin не создаёт duplicate Task; bundle не выдаёт grants и path traversal не пишет вне destination.

### Домен и источник истины

Сущности: `ImportOrigin`, `AttachmentMap`, `ImportReceipt`.

Resumable source-scoped origin map and journal; same Task not duplicated; unknown raw retained.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- raw files/source hashes + attachment manifest
- explicit origin/native owner mapping
- field/key/timezone/audience/collision policy

### Выходы

- staging per-file diff/unknowns/security report
- typed per-file import receipts + preserved raw
- repeat import same mapping/ref with CAS conflicts

## UI / UX и основной сценарий

RD-12 preview conflicts/path traversal/unsafe filenames/duplicate titles; errors per-file; cancel no mutation.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Import staging | Показать source origin/field/asset/privacy/collision mappings до применения. | Source hashes, owner binding, unknown YAML и grants; bundle не выдаёт доступ. | Keyboard per-file errors; Enter применяет digest; Escape без записи. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Import staging» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Source-scoped import mapping сохраняет IDs/raw bytes/assets и resumable per-file receipts.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `knowledge.previewVaultImport(input)`
- `knowledge.applyVaultImport(digest)`
- `knowledge.resumeVaultImport(checkpoint)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Resumable source-scoped origin map and journal; same Task not duplicated; unknown raw retained.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.imported; native task.created/updated.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Readback at owner revision before activate indexes; change during staged preview conflicts.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Bundle ACL metadata never grant; private source/attachments remain private until explicit authorized mapping.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/server-core/src/knowledge/vault-markdown.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts) | [`parseVaultMarkdown:115`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L115), [`noteIdFromRelativePath:77`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L77), [`ParsedVaultNote:54`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-markdown.ts#L54) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/knowledge/vault-index.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts) | [`queryVaultDocuments:807`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts#L807), [`hashVaultMarkdownFiles:938`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts#L938), [`applyVaultWatchTick:978`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts#L978) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/handlers/rpc/notes.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts) | [`saveNote:502`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L502), [`registerNotesHandlers:974`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L974), [`updateNoteProperties:608`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L608) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/server-core/src/tasks/personal-tasks-service.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/tasks/personal-tasks-service.ts) | [`putPersonalTasks:38`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/tasks/personal-tasks-service.ts#L38), [`migratePersonalTasks:63`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/tasks/personal-tasks-service.ts#L63) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |

### Proposed new files — отсутствуют в product baseline

- `packages/server-core/src/docs/vault-import.ts`
- `apps/electron/src/renderer/pages/docs/ImportStaging.tsx`
- `tests/lark-suite-extension/lsx-wp-034.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-034.spec.ts`

**Владение:** будущий implementation role — `portability`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Traversal/symlink/collision/duplicate origin и wrong namespace; outside destination untouched.
- Roundtrip unknown YAML/BOM/EOL/assets; repeat import одна Task; staged source change conflicts.

Planned test files: `tests/lark-suite-extension/lsx-wp-034.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-034.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-034.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Trust imported workspace grant or merge by filename/title instead of origin.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Source-scoped import mapping сохраняет IDs/raw bytes/assets и resumable per-file receipts.
- Mutant должен нарушить и быть отвергнут assertion: Повторный origin не создаёт duplicate Task; bundle не выдаёт grants и path traversal не пишет вне destination.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Source-scoped import mapping сохраняет IDs/raw bytes/assets и resumable per-file receipts.
- [ ] Повторный origin не создаёт duplicate Task; bundle не выдаёт grants и path traversal не пишет вне destination.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-002](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-002.md) — Личные Task source bindings и изолированный picker.
- Требуется [LSX-WP-005](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-005.md) — Lossless Markdown/YAML raw-span patch и field readback.
- Требуется [LSX-WP-006](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-006.md) — Stable block/node anchors без переписывания prose.
- Требуется [LSX-WP-016](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-016.md) — Schema migration preview/type rename/soft delete.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-NOTE-01 / #1112](https://github.com/rox-one/rox-one/issues/1112). Узкая добавленная граница этого issue — «Portable vault import staged identities/attachments» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-BASE-01 / #1094](https://github.com/rox-one/rox-one/issues/1094). Узкая добавленная граница этого issue — «Portable vault import staged identities/attachments» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-FILES`: Common FileRef/assets export and revocation owner; reference Macro File/drive lanes; RS-DRV-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-DRV-01.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Filesystem paths and attachment MIME/size limits need server validation; source license audit separate

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §10–11.
- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §4,8,12.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §9.
- [Карточка LSX-WP-034: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-034`.
