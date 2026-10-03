<!-- ROX-LARK-PACKAGE:LSX-WP-026 -->
# [ROX Suite Extension][LSX-WP-026] Existing Tiptap binding, durable draft и history restore

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Doc editor показывает acknowledged save states, восстанавливает draft и restore создаёт новую revision.

**Зачем:** Save spinner/autosave queue cannot prove durable write or survive crash.

**Новый granular slice:** Existing Tiptap binding, durable draft и history restore. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Очистить draft on autosave start или restore overwrites historical snapshot.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Unacknowledged draft восстанавливается после crash; confirmed revision/hash читается после restart.
- History restore создаёт новую revision без стирания audit; existing editor/IME/caret/views сохранены.

### Домен и источник истины

Сущности: `DocumentDraft`, `DocumentRevision`, `RestoreReceipt`.

Draft journal scoped actor/source/authority; retain until durable ACK; history snapshots immutable.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- existing documentRef/revision/epoch + retained source
- editor raw-span operations; draft sequence
- history revisionID + expected current revision

### Выходы

- committed receipt/save time or conflict
- durable scoped draft after crash
- restore as new revision preserving audit

## UI / UX и основной сценарий

RD-02 docks/ToC/history RD-08; IME/caret maintained; 200% zoom; local/saving/committed/offline/conflict distinct.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Editor save / History | Сохранить draft с retained binding либо preview restore как новую revision. | Authority/revision/hash/ACK time; старый history snapshot не изменяется. | IME/caret сохраняются; history keyboard; Escape закрывает dock и возвращает focus. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Editor save / History» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Unacknowledged draft восстанавливается после crash; confirmed revision/hash читается после restart.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.getHistory(ref,cursor)`
- `doc.previewRestore(ref,revisionId)`
- `doc.restoreRevision(envelope)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Draft journal scoped actor/source/authority; retain until durable ACK; history snapshots immutable.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.revisionCommitted.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Remote committed revision merges/rebases via authority; presence separate ephemeral stream.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Current read/edit/history grant; restricted old snapshot denied; revoke draft quarantine per policy.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [apps/electron/src/renderer/pages/NotesPage.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/NotesPage.tsx) | [`saveCurrentNote:871`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/NotesPage.tsx#L871) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx) | [`TiptapMarkdownEditor:226`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L226), [`preprocessMarkdownForOfficial:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L75), [`postprocessMarkdownFromOfficial:102`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L102) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx) | [`NotesComments:311`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx#L311), [`NotesToc:156`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx#L156), [`loadNoteComments:125`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx#L125) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/rox2/notes-engine.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts) | [`NativeNotesEngine:366`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L366), [`parseBlocks:137`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L137), [`contentHash:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/notes-engine.ts#L75) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `apps/electron/src/renderer/pages/docs/DocumentEditorBinding.tsx`
- `apps/electron/src/renderer/pages/docs/DocumentHistoryDrawer.tsx`
- `packages/core/src/docs/draft-journal.ts`
- `tests/lark-suite-extension/lsx-wp-026.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-026.spec.ts`

**Владение:** будущий implementation role — `docs-ui`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Crash до ACK восстанавливает draft; после ACK restart возвращает exact hash/revision.
- Restore создаёт new revision; native IME/focus/zoom/tab смена и old Note views regression.

Planned test files: `tests/lark-suite-extension/lsx-wp-026.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-026.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-026.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Очистить draft on autosave start или restore overwrites historical snapshot.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Unacknowledged draft восстанавливается после crash; confirmed revision/hash читается после restart.
- Mutant должен нарушить и быть отвергнут assertion: History restore создаёт новую revision без стирания audit; existing editor/IME/caret/views сохранены.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Unacknowledged draft восстанавливается после crash; confirmed revision/hash читается после restart.
- [ ] History restore создаёт новую revision без стирания audit; existing editor/IME/caret/views сохранены.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-003](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-003.md) — Атомарная запись Markdown с CAS/epoch/receipt.
- Требуется [LSX-WP-005](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-005.md) — Lossless Markdown/YAML raw-span patch и field readback.
- Требуется [LSX-WP-006](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-006.md) — Stable block/node anchors без переписывания prose.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-DOC-01 / #1110](https://github.com/rox-one/rox-one/issues/1110). Узкая добавленная граница этого issue — «Existing Tiptap binding, durable draft и history restore» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-NOTE-01 / #1112](https://github.com/rox-one/rox-one/issues/1112). Узкая добавленная граница этого issue — «Existing Tiptap binding, durable draft и history restore» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-COLLABORATION`: Single-writer adoption/epoch/revoke and docWAL transport; reference Macro WP-49/WP-51; RS-DOC-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/07-collaboration-runtime.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Tiptap Markdown serializer is not automatically lossless; binding must use retained adapter

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §1,6,10–12.
- [Карточка LSX-WP-026: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-026`.
