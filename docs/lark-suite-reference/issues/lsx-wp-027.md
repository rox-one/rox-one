<!-- ROX-LARK-PACKAGE:LSX-WP-027 -->
# [ROX Suite Extension][LSX-WP-027] Discussion anchors, orphan state и private-comment migration

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Comment переживает allowed reorder; deletion оставляет orphan; legacy private comments публикуются только после visibility preview.

**Зачем:** DOM offsets or quote matching attach comments to wrong text; import can leak private discussion.

**Новый granular slice:** Discussion anchors, orphan state и private-comment migration. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Reattach orphan to first duplicate quote или auto-publish localStorage comments.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Stable anchors переживают allowed edit/reorder; удалённый source становится orphan без silent quote match.
- Private legacy comments не auto-share; replay не дублирует message/notification; intended recipients и revoke соблюдены.

### Домен и источник истины

Сущности: `Discussion`, `Message`, `EntityAnchor`, `Mention`.

Reuse common Message/Discussion store; explicit provenance/import map; DOM offsets not persisted authority.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- blockId/range/quotedText/contentRevision
- body/mention IDs + idempotencyKey
- legacy comment origin/visibility mapping

### Выходы

- discussionID/messageID/revision
- valid/rebased/orphan anchor state
- intended-recipient notification outcomes

## UI / UX и основной сценарий

RD-03 composer Cmd/Ctrl+Enter; all/open/resolved/mine; quote focus/click; orphan reanchor explicit.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Комментарий / Quote / Re-anchor | Создать discussion по stable anchor, сохранить orphan и явный новый anchor. | Block/range/contentRevision, видимость и intended recipients; quote не выбирается по совпадению текста. | Cmd/Ctrl+Enter send; Enter newline; quote Enter scrolls; Escape retains draft. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Комментарий / Quote / Re-anchor» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Stable anchors переживают allowed edit/reorder; удалённый source становится orphan без silent quote match.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `discussion.postAnchored(envelope)`
- `discussion.reanchor(envelope)`
- `discussion.previewLegacyImport(input)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Reuse common Message/Discussion store; explicit provenance/import map; DOM offsets not persisted authority.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** discussion.messageCreated/resolved; mention.created.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Anchor update at committed Doc revision; revoke removes body/quote from open dock/index.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Doc+discussion/body/asset grants; @ mention recipient must be allowed; no workspace-wide broadcast.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx) | [`NotesComments:311`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx#L311), [`NotesToc:156`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx#L156), [`loadNoteComments:125`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx#L125) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [apps/electron/src/renderer/pages/notes/document-ia.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts) | [`extractBlockIds:182`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L182), [`parseNoteDocument:655`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L655), [`serializeColumns:228`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L228), [`roundTripNoteMarkdown:702`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/document-ia.ts#L702) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/rox2/platform-contract.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts) | [`Rox2EntityRef:233`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L233), [`registerExternalBinding:336`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L336), [`authorizeRox2Action:601`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L601) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/docs/discussion-anchor.ts`
- `packages/server-core/src/docs/discussion-adapter.ts`
- `apps/electron/src/renderer/pages/docs/AnchoredDiscussionDock.tsx`
- `tests/lark-suite-extension/lsx-wp-027.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-027.spec.ts`

**Владение:** будущий implementation role — `docs-discussions`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Duplicate quotes, reorder, delete source: stable anchor или orphan без arbitrary quote attachment.
- Post/import replay dedup; private comments visibility preview; revoked body/recipient dedup.

Planned test files: `tests/lark-suite-extension/lsx-wp-027.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-027.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-027.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Reattach orphan to first duplicate quote или auto-publish localStorage comments.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Stable anchors переживают allowed edit/reorder; удалённый source становится orphan без silent quote match.
- Mutant должен нарушить и быть отвергнут assertion: Private legacy comments не auto-share; replay не дублирует message/notification; intended recipients и revoke соблюдены.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Stable anchors переживают allowed edit/reorder; удалённый source становится orphan без silent quote match.
- [ ] Private legacy comments не auto-share; replay не дублирует message/notification; intended recipients и revoke соблюдены.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-006](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-006.md) — Stable block/node anchors без переписывания prose.
- Требуется [LSX-WP-026](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-026.md) — Existing Tiptap binding, durable draft и history restore.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-DOC-01 / #1110](https://github.com/rox-one/rox-one/issues/1110). Узкая добавленная граница этого issue — «Discussion anchors, orphan state и private-comment migration» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-MSG-02 / #1107](https://github.com/rox-one/rox-one/issues/1107). Узкая добавленная граница этого issue — «Discussion anchors, orphan state и private-comment migration» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-DISCUSSIONS`: Common Discussion/Message backend and own ACL; reference Macro WP-08; RS-MSG-02 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-MSG-02.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-ATTENTION`: One durable intended-recipient notification/reminder owner; reference Macro WP-07 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/15-search-notifications.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

CRDT relative positions only for proven format support; common discussion backend external gate

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §7,11–12.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §5,7.
- [Карточка LSX-WP-027: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-027`.
