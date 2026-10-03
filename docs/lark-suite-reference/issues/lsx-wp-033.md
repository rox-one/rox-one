<!-- ROX-LARK-PACKAGE:LSX-WP-033 -->
# [ROX Suite Extension][LSX-WP-033] Action Buttons typed registry и inert imports

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Reviewed Button исполняет только registered typed action с preview/current ACL/idempotent receipt; imported action remains inert.

**Зачем:** Opening portable document must not authorize code or side effects.

**Новый granular slice:** Action Buttons typed registry и inert imports. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Execute imported raw script or change retry key after side effect.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Все6 action types declarative/typed и gated; imported fences inert до review.
- Каждый шаг использует current ACL/digest/idempotency receipt; default stopOnError и partial outcomes явны.

### Домен и источник истины

Сущности: `ActionSpec`, `CommandPreview`, `StepReceipt`.

Declarative action config only; receipts from existing domain/workflow owners; imported fence state unreviewed.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- Command/EntityLink/Template/AppendBlock/SafeFormula/Workflow
- typed mapped values + affected refs + payloadDigest
- stopOnError(default)/safe explicit continue policy

### Выходы

- validated declarative action spec
- preview effects/current capabilities
- per-step receipt/status + native readback

## UI / UX и основной сценарий

RD-09 input/action/preview; pending/success/failure/offline reason; keyboard; safe labels no arbitrary HTML.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Action builder / Preview / Run | Настроить registered typed action, preview effects и выполнять receipt-based chain. | Command availability/scopes/digest/targets/failure policy; imported fence inert. | Enter preview/run согласно command policy; pending disables повторную side effect. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Action builder / Preview / Run» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Все6 action types declarative/typed и gated; imported fences inert до review.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.validateAction(input)`
- `doc.previewAction(input)`
- `doc.executeAction(envelope)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

Declarative action config only; receipts from existing domain/workflow owners; imported fence state unreviewed.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** command.completed; action.reviewed.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Committed steps advance once; failure stops dangerous chain; next attempt keeps logical idempotency key.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Each chain step current scoped actor policy; no raw JS/shell; sanitizer is not ACL or execution grant.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/core/src/platform/commands/registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/commands/registry.ts) | [`createCommandRegistry:64`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/commands/registry.ts#L64) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/platform/resources/registry.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/resources/registry.ts) | [`createResourceProviderRegistry:88`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/platform/resources/registry.ts#L88) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx) | [`TiptapMarkdownEditor:226`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L226), [`preprocessMarkdownForOfficial:75`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L75), [`postprocessMarkdownFromOfficial:102`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L102) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/shared/src/automations/security.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/security.ts) | [`sanitizeForShell:19`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/shared/src/automations/security.ts#L19) | Read-only source evidence; worker не изменяет этот файл. |

### Proposed new files — отсутствуют в product baseline

- `packages/core/src/docs/action-spec.ts`
- `packages/server-core/src/docs/action-dispatch.ts`
- `apps/electron/src/renderer/pages/docs/ActionBuilder.tsx`
- `tests/lark-suite-extension/lsx-wp-033.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-033.spec.ts`

**Владение:** будущий implementation role — `docs-actions`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Imported fence open/preview: ноль effects; duplicate click одна mutation/receipt.
- Step2 fails→step3 не запускается; revoked scope/changed digest rejected; offline capability explicit.

Planned test files: `tests/lark-suite-extension/lsx-wp-033.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-033.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-033.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Execute imported raw script or change retry key after side effect.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Все6 action types declarative/typed и gated; imported fences inert до review.
- Mutant должен нарушить и быть отвергнут assertion: Каждый шаг использует current ACL/digest/idempotency receipt; default stopOnError и partial outcomes явны.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Все6 action types declarative/typed и gated; imported fences inert до review.
- [ ] Каждый шаг использует current ACL/digest/idempotency receipt; default stopOnError и partial outcomes явны.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-003](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-003.md) — Атомарная запись Markdown с CAS/epoch/receipt.
- Требуется [LSX-WP-004](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-004.md) — Canonical Task field command с revision и partial receipts.
- Требуется [LSX-WP-026](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-026.md) — Existing Tiptap binding, durable draft и history restore.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-DOC-01 / #1110](https://github.com/rox-one/rox-one/issues/1110). Узкая добавленная граница этого issue — «Action Buttons typed registry и inert imports» и приведённые acceptance/negative controls; весь epic не повторяется.
- Related broader scope: [RS-AUT-03 / #1098](https://github.com/rox-one/rox-one/issues/1098). Узкая добавленная граница этого issue — «Action Buttons typed registry и inert imports» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-COMMANDS`: Registered command validator/current scoped actor and MCP dispatcher; reference Macro command lanes; RS-MCP-01 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/rox-suite/published/RS-MCP-01.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Workflow action waits existing runtime gate; imported Buttons syntax may need exact compatibility report

Relative complexity: **XL**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §4,9–10.
- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §3,5.
- [Карточка LSX-WP-033: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-033`.
