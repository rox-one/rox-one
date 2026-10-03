<!-- ROX-LARK-PACKAGE:LSX-WP-046 -->
# [ROX Suite Extension][LSX-WP-046] Versioned template gallery с inert actions и bounded creation

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Template preview declares capabilities/schema/actions/assets; confirm creates one Doc and explicit linked entities through bounded workflow.

**Зачем:** Imported templates must not execute commands or auto-share sources on preview/open.

**Новый granular slice:** Versioned template gallery с inert actions и bounded creation. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Run imported workflow during template preview or retry child step with new origin.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Template preview полностью inert и показывает hash/version/capabilities/audience/effects.
- Повторный confirm возвращает те же Doc/child receipts; partial failures и private asset/source grants явны.

### Домен и источник истины

Сущности: `TemplateVersion`, `CreationPlan`, `DomainReceipt`.

Immutable template manifest/source license/hash; created Doc retains derivedFrom; partial child creations explicit retry receipts.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- templateVersion/hash + context/source bindings
- required capabilities + declared child entity actions
- previewDigest/idempotencyKey + audience

### Выходы

- safe preview + missing capabilities
- new canonical Doc ref; bounded child receipts
- unreviewed action fences remain inert

## UI / UX и основной сценарий

RD-11 categories/search/preview/capability status; keyboard; Create disabled reason; no silent entity fanout.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Template preview / Create | Показать version/hash/capabilities/effects/assets; создать bounded Doc+linked entities. | Template provenance/license, audience/current actions; preview не запускает imported workflow. | Keyboard gallery/preview/Create; missing capability объясняет disabled; partial receipts видны. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Template preview / Create» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Template preview полностью inert и показывает hash/version/capabilities/audience/effects.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.previewTemplate(input)`
- `doc.createFromTemplate(previewDigest)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Immutable template manifest/source license/hash; created Doc retains derivedFrom; partial child creations explicit retry receipts.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.created; template.instantiated.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Repeat confirm same plan returns same receipts; created Doc/Base source refs shared owners.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Creation audience/current actions/assets separately authorize; preview does not grant/install/execute.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [apps/electron/src/renderer/pages/NotesPage.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/NotesPage.tsx) | [`saveCurrentNote:871`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/NotesPage.tsx#L871) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx) | [`TiptapMarkdownEditor:226`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L226), [`preprocessMarkdownForOfficial:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L75), [`postprocessMarkdownFromOfficial:102`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L102) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/platform/commands/registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/commands/registry.ts) | [`createCommandRegistry:64`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/commands/registry.ts#L64) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/core/src/platform/resources/registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/resources/registry.ts) | [`createResourceProviderRegistry:88`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/resources/registry.ts#L88) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/shared/src/automations/graph.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts) | [`compileAutomationGraph:492`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L492), [`automationGraphRevision:212`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L212), [`buildAutomationGraphSave:538`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/graph.ts#L538) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/docs/template-manifest.ts`
- `packages/server-core/src/docs/template-create.ts`
- `apps/electron/src/renderer/pages/docs/TemplateGallery.tsx`
- `tests/lark-suite-extension/lsx-wp-046.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-046.spec.ts`

**Владение:** будущий implementation role — `docs-templates`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Template preview/open zero mutations; same confirm one Doc/child per origin.
- Partial child failure receipts; private source/asset not auto-shared; missing capability disabled.

Planned test files: `tests/lark-suite-extension/lsx-wp-046.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-046.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-046.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Run imported workflow during template preview or retry child step with new origin.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Template preview полностью inert и показывает hash/version/capabilities/audience/effects.
- Mutant должен нарушить и быть отвергнут assertion: Повторный confirm возвращает те же Doc/child receipts; partial failures и private asset/source grants явны.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Template preview полностью inert и показывает hash/version/capabilities/audience/effects.
- [ ] Повторный confirm возвращает те же Doc/child receipts; partial failures и private asset/source grants явны.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-001](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-001.md) — Page content descriptor и совместимое открытие Notes.
- Требуется [LSX-WP-026](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-026.md) — Existing Tiptap binding, durable draft и history restore.
- Требуется [LSX-WP-031](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-031.md) — Semantic tabs/columns и safe basic Markdown fallback.
- Требуется [LSX-WP-033](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-033.md) — Action Buttons typed registry и inert imports.
- Требуется [LSX-WP-034](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-034.md) — Portable vault import staged identities/attachments.
- Требуется [LSX-WP-045](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-045.md) — Explicit CustomRecord page payload для нового типа данных.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-DOC-01 / #1110](https://github.com/rox-one/rox-one/issues/1110). Узкая добавленная граница этого issue — «Versioned template gallery с inert actions и bounded creation» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-AUT-05 / #1100](https://github.com/rox-one/rox-one/issues/1100). Узкая добавленная граница этого issue — «Versioned template gallery с inert actions и bounded creation» и приведённые acceptance/negative controls; весь epic не повторяется.

## Risks / complexity / delivery gates

Template asset/content licensing and advanced workflows remain bounded explicit capabilities

Relative complexity: **L**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §4–6,9,12.
- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §5.
- [Карточка LSX-WP-046: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-046`.
