<!-- ROX-LARK-PACKAGE:LSX-WP-038 -->
# [ROX Suite Extension][LSX-WP-038] Docs day-planner binding без нового timer/notification loop

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Новая функциональность не реализована и не запускалась. Cloud packet: PREPARED_NOT_LAUNCHED; tests/readback для продукта NOT_RUN.

**Product baseline:** `e953786ba7e30fb5da5dca7e88e20e324d5aebab`. Это source SHA существующего продукта, а не commit новых спецификаций. Delivery revision/digest должны быть разрешены из manifest и проверены до implementation launch.

## PRD: задача и ограниченный scope

Daily Doc planner показывает native Tasks+provider Events раздельно и меняет schedule через owner command; one reminder owner.

**Зачем:** Day planner extension must not duplicate existing Calendar/Task persistence and reminder delivery.

**Новый granular slice:** Docs day-planner binding без нового timer/notification loop. Здесь требуется именно приведённый ниже I/O и наблюдаемый результат, а не повторная реализация всего broad epic. Негативный контроль — тест обязан отвергнуть: Start independent Docs timer/notification loop for same Task reminder.

Связанные прежние requirements — broader scope. Их публикация не доказывает product/backend readiness. Этот issue не поручает строить второй catalog/editor/task store/automation builder или заново выполнять весь родительский epic.

## Спецификация и ожидаемые результаты

- Planner является projection/command adapter существующих Task/Event owners.
- Native schedule/occurrence/reminder receipts едины; provider pending/ACK различаются, unsupported timer не симулируется.

### Домен и источник истины

Сущности: `DailyNoteLink`, `TaskOccurrence`, `CalendarEvent`, `TimeEntryRef`.

No new time/reminder store; existing Task/time owner used only after capability/readiness proof; projection-only otherwise.

Row/entity ownership остаётся у указанного canonical domain owner. Projection/cache/view config не становятся второй writable копией native данных. Если нужного owner/capability ещё нет, surface показывает missingDependency/read-only и не заявляет успешное сохранение.

### Входы

- day/range/timezone + permitted Task/Event refs
- native scheduling/reminder capability
- optional native time-entry adapter availability

### Выходы

- daily layers distinct objects + source links
- native schedule/occurrence/reminder receipts
- unavailable time tracking shown explicitly

## UI / UX и основной сценарий

RD-10 day/3day/week; ambiguity preview; keyboard schedule; layers with freshness; timer unsupported reason.

| Control | Input / действие → output | Hover и focus: подробная справка | Click / keyboard |
|---|---|---|---|
| Day planner layer / Schedule | Показать Task/Event источники раздельно и вызвать native schedule command. | Date range/timezone/source freshness, occurrence key; timer capability должна быть реальной. | Day/3day/week keyboard; schedule dialog равен drag; unsupported timer ясно disabled. |

1. Открыть разрешённый source/ref или существующий host данного slice; увидеть current revision/freshness и доступные capabilities.
2. Выполнить действие «Day planner layer / Schedule» с указанными выше typed inputs; preview/read query не выдаёт grant и не исполняет непредъявленные side effects.
3. Получить предусмотренный query output либо native command receipt. Pending/queued/simulated различаются с committed/provider-confirmed.
4. Проверить authoritative readback и reload: Planner является projection/command adapter существующих Task/Event owners.

**Общие interactions:** русский UI по умолчанию и keys всех существующих locales; текущая тема пользователя сохраняется. Rox Mono подтверждается actual computed font, не только CSS declaration. Help по hover/focus/click объясняет meaning, unit/formula, source, freshness и пример. Hover ничего не записывает/отправляет/не расширяет доступ. Критическое действие доступно keyboard и не спрятано только в hover. Focus-visible тонкий и различимый; hit area ≥32px desktop/44px touch; motion ограничен и отключается при reduced-motion. Escape отменяет текущий drag/modal прежде deselect и возвращает focus.

**Состояния:** loading, source-empty, filtered-empty, error/retry, stale/offline, denied/read-only/unsupported, validation и conflict должны быть различимы по тексту/иконке, а не только цвету. Draft сохраняется до durable ACK; denied response не содержит защищённый body/title.

## Commands / API: proposed contract

Ниже proposed logical operations. Их имена не означают, что endpoints уже присутствуют в baseline; transport/schema binding должен пройти compile и compatibility gates.

- `doc.queryDayPlanner(input)`
- `doc.previewPlannerSchedule(input)`

Для writes: versioned command envelope содержит canonical ref/source namespace, mandatory expectedRevision, operationId/idempotencyKey и authorityEpoch, где применимо. Actor берётся из authenticated transport; payload actor/workspace/owner не авторизация. Preview digest проверяется повторно на apply. Queries возвращают source/schema/policy revision и freshness; derived values не writable.

Ошибки: `validation`, `conflict`, `denied`, `deleted`, `offlineUnsupported`, `missingDependency`, `rateLimited`, `unknownFormat`; package-specific discriminants и conflict/current revision без protected-content leak.

## Persistence / DB / migration

No new time/reminder store; existing Task/time owner used only after capability/readiness proof; projection-only otherwise.

Source/model schemas versioned; unknown future payload retained/read-only. No-op/import/export правила берутся из конкретного package contract. При нескольких owners не обещать общую atomic transaction без доказанной поддержки; partial outcomes и reconciliation receipts явны.

## Events / realtime / consistency

**Proposed event families / aliases:** task.updated; provider.syncAcknowledged; registered reminder event alias.

Envelope: `eventId/workspaceId/entityRef/entityRevision/actorRef/occurredAt/schemaVersion/correlationId/causationId/sourceCommandId`. Existing зарегистрированные event names сохраняются через проверенный alias mapping, не blind rename. Sensitive payload consumers получают через текущую авторизацию.

Reschedule version fence cancels old timer in canonical owner; one dedupe notification key.

Durable commit/receipt/outbox intent имеют общий recoverable boundary. Consumers dedup по eventId и используют revision fence/checkpoint. Provider queued и external ACK отдельны; unknown external result не означает разрешение создать новый logical side-effect key.

## ACL / permissions / безопасность

Actor source/provider capability and occurrence ownership; ICS read-only separate writable OAuth.

ACL проверяется в server/data-plane owner на read/query/preview/apply/replay. Row/field/asset/linked-target policies независимы там, где этого требует source. Cached owner-wide aggregate нельзя выдавать другому viewer. Revoke закрывает дальнейший read/write/subscription и инвалидирует derived previews/indexes; экспорт с чужого устройства нельзя обещать физически отозвать.

## Exact source files и scope ownership

SOURCE_VERIFIED_NOT_RUNTIME: указанные declarations прочитаны на `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; это не runtime pass.

| Existing source | Exact declaration anchors | Scope |
|---|---|---|
| [packages/core/src/tasks/personal/projections.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/projections.ts) | [`buildTodayPlan:207`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/projections.ts#L207), [`taskCalendarAt:101`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/projections.ts#L101), [`projectTasks:13`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/projections.ts#L13) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |
| [packages/core/src/tasks/personal/types.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts) | [`PersonalTask:42`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L42), [`TaskLink:17`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L17), [`Recurrence:24`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/types.ts#L24) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/core/src/tasks/personal/dates.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/dates.ts) | [`parseNlDate:35`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/dates.ts#L35), [`localDayKey:5`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/tasks/personal/dates.ts#L5) | Read-only source evidence; worker не изменяет этот файл. |
| [packages/core/src/calendar/types.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/calendar/types.ts) | [`CalendarEvent:22`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/calendar/types.ts#L22), [`calendarEventIdentity:103`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/calendar/types.ts#L103), [`CalendarBundle:86`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/packages/core/src/calendar/types.ts#L86) | Read-only source evidence; worker не изменяет этот файл. |
| [apps/electron/src/renderer/pages/notes/note-views.ts](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts) | [`NoteBaseView:24`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L24), [`projectNoteRows:133`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L133), [`formulaValue:188`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L188), [`notesViewsStorageKey:100`](https://github.com/rox-one/rox-one/blob/e953786ba7e30fb5da5dca7e88e20e324d5aebab/apps/electron/src/renderer/pages/notes/note-views.ts#L100) | Только узкий reviewed integration patch к named symbols; writer integration-owner. |

### Proposed new files — отсутствуют в product baseline

- `apps/electron/src/renderer/pages/docs/DayPlannerBinding.tsx`
- `packages/core/src/docs/planner-source-mapping.ts`
- `tests/lark-suite-extension/lsx-wp-038.test.ts`
- `tests/lark-suite-extension/ui/lsx-wp-038.spec.ts`

**Владение:** будущий implementation role — `tasks-portability`, assignment UNASSIGNED. Worker пишет только перечисленные proposed new files. Existing common paths применяет один integration-owner с exclusive canonical-path lease в dependency order; extra seam требует updated reviewed packet. Наличие source link не даёт blanket write scope.

## Tests и воспроизводимые negative controls

**План; product tests NOT_RUN.**

- Planner→Tasks/Calendar native schedule readback; DST/date-only/occurrence dedup.
- Missing timer capability не создаёт fake timer; one reminder owner cancels old version on reschedule.

Planned test files: `tests/lark-suite-extension/lsx-wp-038.test.ts`, `tests/lark-suite-extension/ui/lsx-wp-038.spec.ts`. После появления implementation: `bun test tests/lark-suite-extension/lsx-wp-038.test.ts`; actual Electron/UI runner сначала сверить с поддерживаемым repository runner. Не выдумывать passing command/screenshot.

**Seeded broken control:** Start independent Docs timer/notification loop for same Task reminder.

**Обязательный semantic oracle:**

- Mutant должен нарушить и быть отвергнут assertion: Planner является projection/command adapter существующих Task/Event owners.
- Mutant должен нарушить и быть отвергнут assertion: Native schedule/occurrence/reminder receipts едины; provider pending/ACK различаются, unsupported timer не симулируется.

Сохранить exact implementation/input SHA256, seed, fixture, expected/observed values, все attempts и baseline/mutant artifacts. Green baseline обязателен; infrastructure timeout/dependency failure отдельно от caught mutation.

## Acceptance / Definition of Done

- [ ] Planner является projection/command adapter существующих Task/Event owners.
- [ ] Native schedule/occurrence/reminder receipts едины; provider pending/ACK различаются, unsupported timer не симулируется.
- [ ] Request/result/error schemas компилируются на server и renderer boundaries; actor поступает из authenticated transport.
- [ ] Commit подтверждается durable native receipt; authoritative readback сверяет exact ref/revision/hash до и после restart.
- [ ] Happy path и перечисленные denied/conflict/replay/recovery cases проходят на exact implementation bytes; сохраняются все attempts и reproduction seeds.
- [ ] Baseline зелёный; seeded mutant падает на названных semantic assertions. Timeout или инфраструктурная ошибка не считается caught mutation.
- [ ] Changed UI проверяется в настоящем Electron: pointer/keyboard/IME/focus/reduced-motion/200% zoom, RU+i18n, light/dark и фактически загруженный Rox Mono.
- [ ] Fixture UI, toast и queued provider receipt не заменяют native/runtime/provider readback; обязательные proof lanes закрываются отдельно.

## Dependencies и broader related issues

- Требуется [LSX-WP-021](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-021.md) — Calendar Base date precision и native/provider capabilities.
- Требуется [LSX-WP-037](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/issues/lsx-wp-037.md) — Checkbox→native Task и TaskNotes origin mapping.

Dependency links пока ведут к provisional draft files. До создания каждого issue publisher подставляет actual numerical GitHub URLs уже созданных prerequisites в topological order; draft links не являются выдуманными issue numbers.

- Related broader scope: [RS-BASE-01 / #1094](https://github.com/rox-one/rox-one/issues/1094). Узкая добавленная граница этого issue — «Docs day-planner binding без нового timer/notification loop» и приведённые acceptance/negative controls; весь epic не повторяется.

### External readiness gates

- `EG-ATTENTION`: One durable intended-recipient notification/reminder owner; reference Macro WP-07 — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/15-search-notifications.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.
- `EG-PROVIDERS`: Real provider capability/idempotency/ACK reconciliation; reference Macro Calendar/provider lanes — [spec](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/macro-integration/12-calendar.md). Readiness NOT_VERIFIED; требуется actual implementation/runtime receipt.

## Risks / complexity / delivery gates

Baseline recurrence enum limited; advanced time/pomodoro owner not source-proven and must remain gated

Relative complexity: **M**; это объём/риск, не календарная оценка.

Cloud contract PREPARED_NOT_LAUNCHED. До запуска разрешить immutable reference package revision/digest из delivery manifest, проверить spec artifacts и approved prerequisite commits, назначить реального owner и leases. После integration сверить patch/schema/test/negative-control receipts и authoritative ref/revision/hash readback. Missing readiness/digest, unsupported provider/owner либо mismatch — fail closed. Publication issue отдельно от implementation completion.

## Specification references

- [05-rox-bases-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/05-rox-bases-design.md) §9.
- [06-rox-docs-design.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/06-rox-docs-design.md) §4,9.
- [08-automation-integration.md](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/08-automation-integration.md) §4.
- [Карточка LSX-WP-038: work-packages.json](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/work-packages.json) (lookup по stable id).
- [Normative dependency DAG](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/plans/lark-suite-reference/dependency-dag.json).
- [Implementation plan09](https://github.com/rox-one/rox-one/blob/docs/lark-suite-reference-20260930/docs/lark-suite-reference/09-implementation-plan.md).

Документационные URL provisional для branch `docs/lark-suite-reference-20260930`. Перед публикацией delivery owner закрепляет immutable docs commit и digest, меняет branch links на pinned links и пересчитывает exact body hash. Product baseline выше остаётся независимым.

Package ID: `LSX-WP-038`.
