<!-- ROX-LARK-PACKAGE:LSX-WP-025 -->
# [ROX Suite Extension][LSX-WP-025] Docs library capability filter и same-ref navigation

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Existing library открывает Notes/Page/Map/Base через descriptor и сохраняет authorized type/source filters.

**Зачем:** New Docs entry should not duplicate Drive/Wiki implementation or expose unsupported editor routes.

**Новый granular slice:** Docs library capability filter и same-ref navigation. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Create new Doc record whenever existing note selected.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Library open не создаёт новый entity и ведёт к существующему note/page route.
- Capability-driven filters/navigation честно отображают unsupported Create, freshness и permitted totals.

### Домен и источник истины

Сущности: `DocumentListRow`, `FormatCapability`, `LibraryFilter`.

Only personal list/grid/filter preferences; reuse existing location/files owner; no new document catalog.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- search/type/owner/project/date/shared filters
- authorized cursor + source scope
- existing document ref/content descriptor

### Выходы

- permitted rows + supported total/cursor
- same existing note/page route
- disabled unsupported Create item with reason

## UI / UX и основной сценарий

RD-01 filters/chips/list-grid; row keyboard/menu focus; create unsupported status; offline last-sync freshness.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Library filters / Открыть | Фильтровать permitted Notes/Page и открыть существующий route/ref. | Тип/формат/source freshness и capability; unsupported Create объясняет причину. | Enter открывает row; Cmd/Ctrl-click новый tab; Space выбирает при row navigation focus. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Library filters / Открыть» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Library open не создаёт новый entity и ведёт к существующему note/page route.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.queryLibrary(input)`
- `doc.getCreateCapabilities(context)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Only personal list/grid/filter preferences; reuse existing location/files owner; no new document catalog.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** document.revisionCommitted; content.descriptorChanged.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Projection watermark reorders rows while stable EntityRef selection retained.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Library metadata/title and count authorized; moving location never implicitly shares.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [apps/electron/src/renderer/pages/NotesPage.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/NotesPage.tsx) | [`saveCurrentNote:871`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/NotesPage.tsx#L871) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [apps/electron/src/renderer/lib/navigation-registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/lib/navigation-registry.ts) | [`NavigationRegistry:118`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/lib/navigation-registry.ts#L118) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/platform/resources/registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/resources/registry.ts) | [`createResourceProviderRegistry:88`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/resources/registry.ts#L88) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/knowledge/vault-index.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts) | [`queryVaultDocuments:807`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts#L807), [`hashVaultMarkdownFiles:938`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts#L938), [`applyVaultWatchTick:978`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/knowledge/vault-index.ts#L978) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `apps/electron/src/renderer/pages/docs/DocumentLibraryAdapter.tsx`
- `packages/core/src/docs/library-query.ts`
- `tests/lark-suite-extension/lsx-wp-025.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-025.spec.ts`

**Владение:** будущий implementation role — `docs-ui`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Library search/cursor failure/retry сохраняет query; open note same ref/hash без entity creation.
- Denied title отсутствует; unsupported Create не создаёт fake editor route.

Planned test files: `tests/lark-suite-extension/lsx-wp-025.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-025.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-025.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Create new Doc record whenever existing note selected.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Library open не создаёт новый entity и ведёт к существующему note/page route.
- Mutant должен нарушить и быть отвергнут assertion: Capability-driven filters/navigation честно отображают unsupported Create, freshness и permitted totals.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Library open не создаёт новый entity и ведёт к существующему note/page route.
- [ ] Capability-driven filters/navigation честно отображают unsupported Create, freshness и permitted totals.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-001](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-001.md) — Page content descriptor и совместимое открытие Notes.
- Требуется [LSX-WP-010](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-010.md) — Permission-aware query snapshot, cursor и totals.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-DRV-01 / #1109](https://github.com/rox-one/rox-one/issues/1109). Узкая добавленная граница этого issue — «Docs library capability filter и same-ref navigation» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-DOC-01 / #1110](https://github.com/rox-one/rox-one/issues/1110). Узкая добавленная граница этого issue — «Docs library capability filter и same-ref navigation» и приведённые acceptance/negative controls; весь epic не повторяется.

## Risks / complexity / delivery gates

Library/Drive owner external; this slice only typed content adapter and filters

Relative complexity: **M**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §4–5.
- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §1–3.
- [Карточка LSX-WP-025: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-025`.
