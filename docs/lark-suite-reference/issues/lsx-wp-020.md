<!-- ROX-LARK-PACKAGE:LSX-WP-020 -->
# [ROX Suite Extension][LSX-WP-020] Gallery и typed Image/Audio/Video cells с asset ACL

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Gallery/media inspector отображает только разрешённые derivatives и сохраняет typed FileRefs; no autoplay.

**Зачем:** Raw asset URLs or hidden note excerpts can leak content beyond row ACL.

**Новый granular slice:** Gallery и typed Image/Audio/Video cells с asset ACL. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Вернуть original asset URL без own ACL или autoplay all gallery videos.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Image/Audio/Video используют typed FileRefs и отдельный asset ACL; autoplay отсутствует.
- Gallery refs равны Table; denied/broken/no-cover состояния и unsupported codec явны.

### Домен и источник истины

Сущности: `AttachmentBinding`, `MediaCellValue`, `GalleryConfig`.

Assets remain existing File/Notes owner; metadata derivative cache revision/ACL-scoped; no copied private file by default.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- authorized FileRefs + alt/caption/duration metadata
- media policy/MIME/size/codec limits
- cover/card property IDs + presentation tokens

### Выходы

- authorized derivative previews or denied/broken placeholders
- native attachment field receipt
- typed image/audio/video metadata

## UI / UX и основной сценарий

Arrow/Home/End/Enter card navigation; focus survives virtualization; play/pause/seek/captions; image/no-cover/error states.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Media card / Preview | Открыть разрешённый derivative или typed Image/Audio/Video editor. | Asset owner/ACL/MIME/codec, alt/caption/duration; no-cover/broken/denied различаются. | Arrow/Home/End/Enter; play/pause/seek доступны focus; autoplay отключён. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Media card / Preview» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Image/Audio/Video используют typed FileRefs и отдельный asset ACL; autoplay отсутствует.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `base.resolveMediaPreview(ref,revision)`
- `base.previewMediaFieldEdit(input)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Assets remain existing File/Notes owner; metadata derivative cache revision/ACL-scoped; no copied private file by default.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** attachment.bound; media.capabilityChanged.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Revoke invalidates media URL, playback/preview and excerpt; no automatic external scraping.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Asset policy independently checked beyond row Doc grant; revoked URL/token removed; external sources declared.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx) | [`TiptapMarkdownEditor:226`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L226), [`preprocessMarkdownForOfficial:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L75), [`postprocessMarkdownFromOfficial:102`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L102) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/handlers/rpc/notes.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts) | [`saveNote:502`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L502), [`registerNotesHandlers:974`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L974), [`updateNoteProperties:608`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/notes.ts#L608) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx) | [`NotesViewHost:58`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L58), [`NotesViewNote:48`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L48) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/rox2/surface-context.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/surface-context.ts) | [`bindSurfaceContext:31`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/surface-context.ts#L31), [`visibleContextEntityRefs:51`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/surface-context.ts#L51), [`rebaseLiveContext:76`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/surface-context.ts#L76) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `apps/electron/src/renderer/pages/bases/BaseGallery.tsx`
- `apps/electron/src/renderer/pages/bases/MediaCellEditor.tsx`
- `packages/server-core/src/bases/media-projection.ts`
- `tests/lark-suite-extension/lsx-wp-020.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-020.spec.ts`

**Владение:** будущий implementation role — `bases-media`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Gallery ref-set equals Table; MIME/codec/missing/denied/broken states, typed media reload/export.
- Revoke при открытом preview удаляет URL/playback; no autoplay/unconfigured external requests.

Planned test files: `tests/lark-suite-extension/lsx-wp-020.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-020.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-020.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Вернуть original asset URL без own ACL или autoplay all gallery videos.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Image/Audio/Video используют typed FileRefs и отдельный asset ACL; autoplay отсутствует.
- Mutant должен нарушить и быть отвергнут assertion: Gallery refs равны Table; denied/broken/no-cover состояния и unsupported codec явны.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Image/Audio/Video используют typed FileRefs и отдельный asset ACL; autoplay отсутствует.
- [ ] Gallery refs равны Table; denied/broken/no-cover состояния и unsupported codec явны.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-011](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-011.md) — Реестр 18 typed fields и schema inspector.
- Требуется [LSX-WP-012](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-012.md) — Typed scalar cell editors с native write preview.
- Требуется [LSX-WP-010](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-010.md) — Permission-aware query snapshot, cursor и totals.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-BASE-01 / #1094](https://github.com/rox-one/rox-one/issues/1094). Узкая добавленная граница этого issue — «Gallery и typed Image/Audio/Video cells с asset ACL» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-FILES`: Common FileRef/assets export and revocation owner; reference Macro File/drive lanes; RS-DRV-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-DRV-01.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Authorized export cannot recall downloaded media; no impossible copy prevention claim

Relative complexity: **L**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §5,8,12.
- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §6,9.
- [Карточка LSX-WP-020: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-020`.
