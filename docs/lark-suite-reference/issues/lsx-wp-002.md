<!-- ROX-LARK-PACKAGE:LSX-WP-002 -->
# [ROX Suite Extension][LSX-WP-002] Личные Task source bindings и изолированный picker

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Две личные Tasks с одинаковым nativeId из разных stores остаются разными; workspace видит только явно разрешённый source binding.

**Зачем:** Workspace selector не доказывает владение личным конфигом.

**Новый granular slice:** Личные Task source bindings и изолированный picker. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Удалить sourceStoreId/ownerPrincipalId из cache/key lookup.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Одинаковые nativeId в двух personal stores дают два разных EntityRef.
- Без явного allowed binding личная Task не раскрывается workspace; binding и приватность переживают restart.

### Домен и источник истины

Сущности: `SourceBinding`, `EntityOrigin`, `PersonalTask`.

Composite unique origin; mappings never auto-share imported personal tasks.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- sourceStoreId + ownerPrincipalId + nativeId
- actor from authenticated transport
- explicit allowed workspace binding + policyVersion

### Выходы

- namespaced EntityRef
- allowed source choices with capabilities
- denied response without title/body

## UI / UX и основной сценарий

Source picker explains personal owner and audience; same-title sources distinguish provenance.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Выбрать личный источник | Показать permitted stores и preview привязки owner→workspace. | sourceStoreId, владелец, разрешённая аудитория и capabilities; одинаковые nativeId не объединять. | Стрелки выбирают источник, Enter открывает preview, Escape отменяет. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Выбрать личный источник» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Одинаковые nativeId в двух personal stores дают два разных EntityRef.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `base.bindPersonalSource(binding,expectedBindingRevision)`
- `base.listAllowedSources(workspaceId)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Composite unique origin; mappings never auto-share imported personal tasks.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** base.sourceBindingChanged.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Revoked binding closes source subscription and clears permitted projections.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Recheck current owner/workspace binding at read, query and write; nativeId-only lookup rejected.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/core/src/rox2/platform-contract.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts) | [`Rox2EntityRef:233`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L233), [`registerExternalBinding:336`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L336), [`authorizeRox2Action:601`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/rox2/platform-contract.ts#L601) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/server-core/src/tasks/personal-persist.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/tasks/personal-persist.ts) | [`PersonalTaskPersistStore:74`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/tasks/personal-persist.ts#L74), [`parsePersonalTaskPersistFile:57`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/tasks/personal-persist.ts#L57) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/server-core/src/handlers/rpc/personal-tasks.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/personal-tasks.ts) | [`registerPersonalTasksHandlers:38`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/personal-tasks.ts#L38), [`personalTasksStore:29`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/server-core/src/handlers/rpc/personal-tasks.ts#L29) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/tasks/personal/types.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts) | [`PersonalTask:42`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L42), [`TaskLink:17`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L17), [`Recurrence:24`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L24) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/bases/source-binding.ts`
- `packages/server-core/src/bases/personal-source-binding.ts`
- `tests/lark-suite-extension/lsx-wp-002.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-002.spec.ts`

**Владение:** будущий implementation role — `identity`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Два personal stores с одним nativeId: разные refs; unbound/wrong principal не получают title/count.
- Мигрировать personal binding и перезапустить: privacy и owner namespace не меняются.

Planned test files: `tests/lark-suite-extension/lsx-wp-002.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-002.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-002.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Удалить sourceStoreId/ownerPrincipalId из cache/key lookup.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Одинаковые nativeId в двух personal stores дают два разных EntityRef.
- Mutant должен нарушить и быть отвергнут assertion: Без явного allowed binding личная Task не раскрывается workspace; binding и приватность переживают restart.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Одинаковые nativeId в двух personal stores дают два разных EntityRef.
- [ ] Без явного allowed binding личная Task не раскрывается workspace; binding и приватность переживают restart.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-001](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-001.md) — Page content descriptor и совместимое открытие Notes.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-BASE-01 / #1094](https://github.com/rox-one/rox-one/issues/1094). Узкая добавленная граница этого issue — «Личные Task source bindings и изолированный picker» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-NOTE-01 / #1112](https://github.com/rox-one/rox-one/issues/1112). Узкая добавленная граница этого issue — «Личные Task source bindings и изолированный picker» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-IDENTITY`: Authenticated actor/source grants and read-time revoke; reference Macro WP-01/WP-03 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/21-implementation-plan.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Current personal RPC is contextless and config-dir scoped; must not expose unchanged handler remotely

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [07-domain-entity-model.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/07-domain-entity-model.md) §2,7,9.
- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §4,9–10.
- [Карточка LSX-WP-002: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-002`.
