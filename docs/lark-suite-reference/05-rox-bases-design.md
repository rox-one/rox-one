# ROX Bases: проекции общих сущностей и редактируемые представления

Статус: **проект будущей реализации**, 30 сентября 2026. Проверенная база ROX: **e953786ba7e30fb5da5dca7e88e20e324d5aebab**. Источники и лицензии: [Obsidian audit](04-obsidian-reference-audit.md), [машинный manifest](../../plans/lark-suite-reference/obsidian-sources.json). Здесь описан собственный ROX дизайн; Notion Bases/Dynamic Views code не переносится.

## 1. Результат и критерии приёмки

Пользователь создаёт Base из Notes, Tasks, Projects, Meetings, Calendar или явно созданного типа записей; выбирает Table/Board/Gallery/List/Calendar/Timeline/Chart; фильтрует и редактирует общие данные. Изменение задачи в Board немедленно становится изменением той же задачи в Tasks. Связанный Doc открывается с тем же EntityRef, ACL и revision. Несколько views не создают несколько копий строк.

1. Семь view types работают на одном typed query snapshot и дают одинаковые разрешённые строки при одинаковых фильтрах. Summary, chart и rollup никогда не включают недоступную строку/поле.
2. Реализован реестр 18 field types; writable fields изменяют canonical owner через общий command service; formula/lookup/rollup/system fields читаются как derived values.
3. Base definition, schema и shared view config сохраняются через существующую page/content инфраструктуру. LocalStorage — только персональные предпочтения, не единственная копия Base.
4. Смена field type/rename/delete/relations проходит versioned migration с preview, проверкой влияния и обратимой историей. Будущая непонятная версия сохраняется и открывается read-only.
5. Markdown/frontmatter/CSV/JSON import/export имеет явные mappings, стабильные identities, отчет ошибок и readback; сохранение не уничтожает неизвестные поля/комментарии. TaskNotes one-note import не создаёт вторую task database.
6. Happy path, denied/read-only, empty/loading/stale/conflict/error, keyboard, reload и конкурентные изменения проверяются на реально реализованном UI. Проверка этого документа не означает выполнение этих критериев продуктом.

## 2. Проверенная отправная точка

| Existing seam | Реальное состояние baseline | Следствие |
|---|---|---|
| Rox2Entity/Rox2EntityRef, packages/core/src/rox2/platform-contract.ts | Есть kind page/note/task, workspace IDs, permissions, refs, events, execution/verification triad | Используем identity/event/permission contract. **contentKind отсутствует** и предлагается как additive page payload |
| NoteBaseView/projectNoteRows, apps/electron/src/renderer/pages/notes/note-views.ts | v1 table/base, простой filters/sort/group/columns; 4 fixed formulas | Это migration input и UI seam, не general database engine |
| NotesViewHost | table/canvas/outline/graph, localStorage view/canvas config | Общий Base renderer/query adapter заменяет текущую локальную конфигурацию по явной миграции |
| Notes RPC, packages/server-core/src/handlers/rpc/notes.ts | Markdown files/index/watch; saveNote optional expectedRevision, direct writeFile; UPDATE_PROPERTIES full YAML rewrite | Harden mutation CAS/atomic check+write and lossless frontmatter patches before multiuser editing |
| NativeNotesEngine | Required expectedRevision и revision history; Markdown stamping нормализует raw text | Использовать revision technique; не обещать lossless сохранение этим serializer |
| PersonalTaskStore + PersonalTaskPersistStore + personal-tasks RPC | Existing task model; per-task JSON, monotonic revision; current PUT без expectedRevision | Адаптер canonical Tasks, добавить versioned mutation contract; не создавать Bases tasks store |
| CalendarEvent/calendarEventIdentity | Account/calendar/event scoped identities, timezone, recurrence; events distinct from tasks | Calendar projection сохраняет семантику источника; read-only subscription нельзя «перетянуть и сохранить» |
| Project memberships | member-of edges, видимость проектов; существующая dedupe portfolio logic | Query source set из общих memberships, не новый Base-only project ACL |
| Command/resource registries | Context-aware commands/search contributions | Buttons, field menus, inline actions и shortcuts идут через общий host dispatch |
| Plugin bridge | SiYuan manifest projection/Bazaar RPC, не Obsidian execution host | Новые capability packages не требуют совместимости с Obsidian runtime |

Текущие local-only RPC с «granted: true»/contextless handlers не являются достаточной multiuser ACL. Base service должен вызывать общий ROX permission resolver на server/data-plane boundary; текущие permission arrays в Rox2Entity — отображаемый contract, не самостоятельная авторизация в браузере.

## 3. Три архитектурных варианта

| Вариант | Конкретная модель / пользовательский результат | Сильная сторона | Цена и риск | Решение |
|---|---|---|---|---|
| A. Typed projections существующих сущностей | Base page хранит schema/view/query; строки = EntityRef + adapter. Task field writes → current Tasks, Doc field writes → current Notes/Page | Сохраняет единые Tasks/ACL/provenance, запускается по существующим seams | Необходимы adapters, CAS и permission-aware query; несовпадающие типы имеют explicit capabilities | **Рекомендуется как core** |
| B. Новый CustomRecord domain | Для новой бизнес-таблицы создается один typed record payload с общей canonical identity и lifecycle; native tasks в него не копируются | Свободные schemas, новые CRM/research/media записи без forced Task semantics | Новый owner/store migration; temptation зеркалировать Tasks; связь record↔Page body требует ясного source ownership | **Опциональное расширение A**, только когда подходящего существующего kind нет |
| C. File-native folder databases | Каждый ряд — Markdown/frontmatter в папке, Base definition в переносимом файле; ROX индексирует files и редактирует raw spans | Обмен с Obsidian/файловыми workflows прост и локален | Native Tasks/Calendar перестают быть теми же сущностями при копировании; title/path collision; remote ACL/sync сложнее | **Import/export adapter**; не отдельный parallel product store |

Рекомендация: A + ограниченный B + C как portable format boundary. Нельзя выбирать B автоматически при создании task view: существующий task ID и owner остаются authoritative. Новый CustomRecord — payload/domain capability, не замена всех ROX entities. До отдельной миграции текущего contract допустимый subtype records — **kind=page, proposed contentKind=record**, с versioned typed properties и необязательным body; новый глобальный kind добавляется только при доказанной необходимости. Это проектируемое поле, не найденная готовая модель baseline.

## 4. Объекты и владение данными

### 4.1 Canonical границы

- **Rox2EntityRef**: workspaceId, entityId, optional revisionId/account namespace; единственный row key. Display name/path — label, не foreign key.
- **Page content payload (proposed)**: kind=page, contentKind=document/base/record/canvas и schemaVersion. Existing HTML mini-dashboard PageConfig из packages/core/src/types/page.ts имеет свой PageKind static/interactive/live; этот enum не подменять новым contentKind. Dashboard projection/adapter сохраняет старую семантику.
- **BaseDefinition**: canonical page ref, base schema/version, source selection/query, field definitions, shared views, attachments/provenance. Не хранит массив зеркальных Task/Doc records.
- **SourceAdapter**: resolve/ref/query/read/write capabilities для Notes/Page, PersonalTask, Project, Meeting, CalendarEvent. Внешний источник может быть read-only/stale/offline; capability доступна до открытия editor.
- **CustomRecord** (optional): один authoritative typed payload, общие ACL/events/revisions; extension properties не записываются в копию native Task. Для неизвестного import type предлагается явное создание такого типа после preview.
- **BaseRowProjection**: rowRef, owner kind, revision, typed values, allowed field/actions, source/freshness/provenance. Derived cache можно удалить и пересоздать; он не source of truth.
- **RelationDefinition**: stable field IDs, target entity kinds/schema, cardinality, inverse mapping; relation values = EntityRef. Existing Rox2Relation kinds используются там, где их смысл совпадает; произвольная user relation не маскируется под blocks/assigned.

### 4.2 Предлагаемый контракт, не текущий API

~~~ts
// Design-only types: future names must align with platform implementation.
type BaseDefinition = {
  schemaVersion: number
  ref: Rox2EntityRef                     // page + contentKind=base
  source: SourceSelector                // kinds / membership / refs / folder adapter
  fields: BaseField[]                    // stable fieldId, label, type, owner mapping
  views: BaseViewConfig[]
  revision: string
}
type BaseRowProjection = {
  ref: Rox2EntityRef
  revision: string
  values: Record<FieldId, TypedCellValue>
  capabilities: Record<FieldId, FieldCapability>
  freshness: 'live' | 'cached' | 'stale' | 'offline'
  provenance: ProvenanceRef[]
}
type BaseQueryResult = {
  queryRevision: string
  permissionEpoch: string
  rows: BaseRowProjection[]
  cursor?: string
  aggregates: AuthorizedAggregate[]      // same authorized query, all pages
  freshness: 'live' | 'cached' | 'stale' | 'offline'
}
type BaseMutation = {
  ref: Rox2EntityRef
  expectedRevision: string
  operationId: string
  idempotencyKey: string
  patch: TypedFieldPatch[]
}
~~~

Владельцы: Page service владеет BaseDefinition/schema/config; каждый domain owner владеет row fields; общий permissions resolver владеет доступом; общий event bus/change feed инвалидирует проекции; существующий notification/automation runtime доставляет reminders. Встреча может предложить Task/Doc изменение через текущий proposal flow, а Base показывает тот же outcome/provenance.

### 4.3 Native field mapping

| Base field | Task adapter | Notes/Page adapter | Calendar adapter |
|---|---|---|---|
| Title | PersonalTask.title | title/frontmatter/body title согласно canonical owner | CalendarEvent.title при provider write capability |
| Status | Derived из completedAt/cancelledAt/trashedAt либо typed command complete/reopen/cancel | Typed property status | Provider-defined; не Task completion |
| Date | dueAt/startAt с explicit mapping, local/all-day precision | Named property/date precision | startAt/endAt/allDay/timeZone |
| Relation | projectId/parentId/source/links с сохранением их семантики | Typed EntityRef relation; wikilink label экспортируется отдельно | Existing linked task/page ref, не remote ID-only |
| Number/text/custom select | Existing field если есть; scoped extension props через owner migration | Frontmatter/CST patch | Unsupported/read-only если provider этого не поддерживает |
| Media | Canonical file refs в notes/attachment extensions | Existing Notes asset owner | Provider attachment capability или read-only |

Mixed source view не делает все поля writable: unsupported cell показывает «Не поддерживается этим типом», а empty writable cell — «Пусто». Bulk edit предварительно показывает eligible/skipped rows; никакой неявной частичной записи без receipt по каждой строке.

## 5. Реестр ровно 18 типов полей

Field ID неизменен при rename. Label локализуется через t(); в export отдельно хранится portable property key. Field type проверяет stored value, editor input, comparator, filter operators, sort, formatter, import/export и capabilities. Null/empty/error/redacted/unsupported — разные состояния.

| № | Тип | Значение / editor | Validation и переносимость | Основные операции |
|---:|---|---|---|---|
| 1 | Title | Unicode string; single/multi line title editor | Required только по schema; не используется как identity. CSV string, Markdown title/frontmatter | Contains, locale sort, open entity |
| 2 | Text | Plain string или explicit rich document ref; textarea | Нельзя угадать HTML по строке; multiline quoted CSV | Contains, is empty, starts/ends |
| 3 | Number | Finite decimal/numeric value; numeric editor | Locale display отделён от stored value; currency/unit metadata; NaN/Infinity invalid; большие точные суммы в decimal representation | =/≠/range, sum/avg/min/max |
| 4 | Select | Option ID; named/color option picker | Stable ID независимо от label; import unknown option pending mapping | equals/is any of, grouping |
| 5 | Multi-select | Ordered/dedup set option IDs; chips | Empty set distinct from null; YAML list/JSON array; CSV list encoding declared | contains/all/none, counts without duplicate rows |
| 6 | Checkbox | boolean/null; checkbox | No implicit conversion text “false” to true; nullable schema explicit | checked/unchecked/empty, percentage |
| 7 | Date | DateValue date-only / zoned timestamp / precision | YYYY-MM-DD или timestamp+zone; DST gaps/ambiguities explicit; display locale не меняет stored day | before/after/range, relative filters, Calendar/Timeline |
| 8 | URL | String URL; link editor | Allowlisted schemes; relative attachment refs separately; no javascript/data HTML actions | open/copy/filter; click через host |
| 9 | Email | String; email editor | Pragmatic syntax validation, original string preserved; no auto mail send | mailto/open composer; contains |
| 10 | Phone | Original string + optional normalized value | Country context explicit; leading +/zeros retained; no numeric coercion | copy/open dialer via host |
| 11 | Status | Workflow option ID + category/order | Required mapping к owner status machine; invalid transition rejected | Board groups, transition command |
| 12 | Formula | Versioned expression AST/config → typed result | Read-only; deterministic parser/interpreter, bounds, errors visible; expression exported, cache not truth | computed filter/sort/group/summary |
| 13 | Relation | EntityRef or list of refs | Target kind/schema/cardinality validated; stable identity; ACL-aware picker; unresolved imported refs retained | Link/unlink, inverse relation, graph |
| 14 | Lookup | Relation field + target field ID → typed scalar/list | Read-only derived; output cardinality explicit; no title matching | Display/filter/sort when type supports |
| 15 | Rollup | Relation + target field + aggregate → typed result | Read-only; authorized targets only; units/type check; empty/error rules explicit | sum/count/avg/min/max/distinct/list |
| 16 | Image | File/asset refs + alt/caption | MIME/size/dimensions; local vault attachment mapping; denied/broken image placeholders | Preview/Gallery cover/open file |
| 17 | Audio | File refs + duration/metadata | Media permission, external URL disclosure, no autoplay; unsupported codec state | play/pause/seek/transcript link |
| 18 | Video | File refs + poster/duration | Lazy metadata; no autoplay; denied stream URL never rendered | play/pause/captions/open media |

System createdAt/updatedAt/source/revision/assignee/provenance columns — projections/bindings к имеющимся типам, не незаметное расширение списка field types. Person/Place/ID/Button из других plugins возможны как extension descriptors после отдельного решения; Core acceptance остаётся ровно 18.

## 6. Formula, Relation, Lookup, Rollup

### 6.1 Formula

Собственный tokenizer/parser → typed AST → interpreter. Никаких JS eval, browser globals, network/file APIs. Поддерживаемые functions versioned: arithmetic/comparison/boolean, text, date, if/coalesce, list operations; function signature определяет output type. Field reference использует fieldId; editor показывает label, rename label не ломает expression. Expressions проверяются до commit и формируют dependency DAG; cycle rejected с цепочкой полей.

Query запускается с pinned evaluation time/timezone: today()/now() одинаковы для строки, chart и export в одном snapshot. Row cap, AST node/depth cap, evaluation budget и relation fanout limit заданы service config; лимит возвращает error «Лимит вычисления», не зависший UI. Error codes DIV_ZERO/TYPE/UNRESOLVED_REF/CYCLE/BUDGET отделены от null. При export пишутся expression+version и optional evaluated result/snapshot time, чтобы внешний consumer понимал потерю вычислителя.

Пример: у Tasks поле «Дней до срока» = dateDiff(dueAt, query.today, days); null dueAt → null. Просроченные задачи фильтруются явным owner status predicate, а не отрицательным numeric result у завершённых задач.

### 6.2 Relation

Relation picker выполняет authoritative readable-target search. Query может вернуть только доступные target IDs/labels; создание связи проверяет write source и допустимость readable target/cardinality. Two-way relation изменяется одной транзакцией или saga с journal/repair; UI не показывает успех второй стороны до receipt. Delete target оставляет tombstone/unresolved reference по policy; не удаляет source row и не заменяет ссылку чужим совпавшим title. Self-parent relation запрещает циклы; ordinary relation может содержать циклы и не используется как дерево без explicit layout policy.

Старые note wiki links переносятся через mapping target path/title→EntityRef с collision report. Task parentId/projectId сохраняет domain constraints. Import two-way relation не удваивает edge при повторном запуске.

### 6.3 Lookup и Rollup

Lookup следует relation ref и читает target field после target/field ACL. Не ищет строку по совпавшему title, как Notion Bases на проверенном SHA. One→one возвращает scalar; many возвращает list либо explicit first/unique policy; неоднозначность не решается случайным первым элементом.

Rollup принимает allowed relation targets с разрешённым target field; aggregates count/sum/avg/min/max/distinct/list. Count rows ≠ count non-empty values; policy хранится в field config. Непонятные unit/несовместимые типы дают TYPE. Для count пустого доступного множества → 0; sum → 0 только если schema задаёт это; avg/min/max → null. Недоступные targets не участвуют в numerator/denominator и не раскрываются через «ещё 3 скрытых»; при необходимости показ «Вычислено по доступным данным» без числа скрытых сущностей.

Инвалидация зависит от source revision, target revisions и permissionEpoch. Relation/rollup graph cache общий и производный; Base view не дублирует все target entities в браузере.

## 7. Query, ACL и итоговые значения

### 7.1 Единый порядок

1. Resolve workspace/source refs, account scope, project membership и readable source universe через existing permission resolver. Reject malformed/cross-workspace refs.
2. Применить row/field ACL до projection, relation traversal, formula, sort/group/aggregate. Запрещённые поля не доступны даже в filter builder; запрос по ним отклоняется, не возвращает совпадения как side channel.
3. Применить typed filters (AND/OR/NOT), derived fields, sort и grouping с deterministic rowRef tie-breaker. Resolve relations только в разрешённом графе.
4. Compute authorized totals по всему filtered set; pagination ограничивает returned rows, не значение summary. Отдельно возвращается totalVisibleRows только если разрешено; полный скрытый count не вычисляется для UI.
5. Render Table/Board/etc на одинаковом queryRevision/permissionEpoch. Chart drill-down повторяет те же predicates/permission snapshot; export использует этот же набор, а не полный raw owner store.
6. Mutation rechecks права и revision на server. Saved view/share permission не увеличивает доступ к underlying rows. Revocation invalidates rows/media/aggregate caches до следующего render/query; stale cached data не остаётся при новой запретной permission epoch.

Это требование к будущему Base service. Текущий notes project helper с readable flag и browser-side фильтром сам по себе не выполняет эти условия.

### 7.2 Сохраняемые view configs

Общие: viewId/name/type; source/schema revision; filter AST; sorts; groupBy; visible/order/pinned columns; widths/row density; aggregations; Board lanes/order; Gallery cover/card properties; Calendar date field/timezone; Timeline start/end/group/zoom default; Chart kind/x/y/aggregate; explicit empty/null handling; scope/private/shared ownership.

Персональные: last active view, current scroll, selection, expanded groups, temporary search, inspector width. Shared config редактируют authorized owners/editors; reader может создать private personal view, если разрешено. Local preferences keyed workspaceId+pageId+viewId+schemaVersion; не hardcoded global keys. Base definition config имеет отдельную revision от row data, конфликт view edit не отменяет Task edit.

Embedded Base в Doc хранит reference + optional local presentation override; row ownership и ACL сохраняются. Duplicate view копирует config, а Duplicate Base выбирает «ссылка на те же данные» либо explicit новый dataset с отдельным preview. Нельзя смешивать эти действия в одной неясной кнопке.

## 8. Семь views: входы, выходы, взаимодействия

Одинаковая верхняя панель: name/source/freshness, view tabs, search/filter/sort/group, field visibility, create row по source capability, export, help. Help по hover/focus/click объясняет смысл поля/единицы/formula/source/freshness с примером. Русская локализация, светлая компактная компоновка, Rox Mono, accessible contrast и reduced motion — из общих UI правил проекта.

| View | Конкретный input → output | Pointer/keyboard | Состояния и проверяемый результат |
|---|---|---|---|
| Table | Typed rows + field registry → virtualized grid, summaries | Click/F2/Enter edit; arrows navigation; Tab/Shift+Tab next cell; Escape cancel; Shift selection; paste rectangle with preview; resize/reorder columns | Unsupported/denied/read-only cells distinct. Edit commits canonical value, reload same ID/value. CSV paste validates every target; failed cells have per-cell report |
| Board | Status/select field + rows → lanes/cards/order | Drag to lane or card menu; keyboard «Переместить в…», arrows, Enter open; Escape cancel | No group field → setup, unknown status → explicit lane. Move calls existing owner transition; denied/conflict restores authoritative position. Counts use same ACL/filter snapshot |
| Gallery | Rows + cover/media field + card property list → grid cards | Click/Enter open entity; arrows/Home/End between cards, focus visible across virtualization; menu keyboard reachable | No cover, loading/broken/denied media distinct. No autoplay. Lazy rendering keeps selection; image ACL revocation removes URL/preview |
| List | Rows + compact property set + group → list/sections | Up/Down selection, Enter open, Space permitted checkbox action, inline action menu | Empty filtered result vs source empty explicit; multi-select bulk eligible report. Checkbox of Task uses complete/reopen command |
| Calendar | Date field/timezone + rows → month/week/day/list date projection | Click date create prefilled typed field; drag/reschedule or keyboard date dialog; arrows navigate days, Today command | No date → undated bucket; date-only/all-day stays date-only. DST ambiguous input explicit. Read-only remote event cannot be saved by drag |
| Timeline | start/end/duration mapping + group → time axis, intervals/milestones | Drag move/resize; keyboard schedule dialog, zoom buttons, pan controls, Fit; Escape cancel | Missing/inverted/precision dates diagnostic. Duration extension Task-owned. Move+resize transaction atomic, reload same interval; timezone/permission conflict visible |
| Chart | Authorized query + x/y/aggregate/type → bar/line/pie + data table | Hover/focus tooltip with value/unit/source/snapshot; Enter drill-down, keyboard legend/toggle, accessible data table | Empty/all-null/unsupported aggregation separate. Same values as Table summary; no hidden row count. Filter drill-down returns exactly authorized contributing rows |

Pagination/virtualization не определяет aggregate input. Board/Gallery отрисовывают окна, Chart может агрегировать весь authorized query на сервере. Selection хранится по EntityRef; hidden filtered row очищает selection actions, не остаётся тайным target. View переключение сохраняет source/filter equivalence и не переписывает records.

## 9. Создание, редактирование и Tasks/Docs workflow

### 9.1 Создать Base

Input: workspace/project context, source choice, existing schema или typed fields, default view. Sources явно подписаны «Задачи», «Документы», «События», «Новый тип записей», «Импорт Markdown/CSV». Preview показывает source capability/freshness, уже существующие fields и пример 3 разрешённых строк. Output: одна Base Page ref, persisted config revision, query receipt и первый view. Empty source имеет действие create только для writable owner; read-only connection объясняет это до ввода.

### 9.2 Edit и bulk

Cell editor получает typed value+row expectedRevision. Save отправляет общий mutation; optimistic pending visual не означает committed result. Success receipt/ref/revision, changed event и readback обновляют Tasks/Docs/Calendar projection. Validation остаётся рядом с cell; Escape отменяет локальный draft. Conflict показывает current/local и resolver; retry повторяет CAS с новым token. Offline edits сохраняются в существующем durable outbox при доступном owner support, иначе UI явно read-only/offline; outbox не новый task database.

Bulk input = explicit refs+expected revisions+patch; batch ACL/capability preview; response per-row outcome. Atomic all-or-none применим в одном supported owner, mixed providers — explicit partial receipts с retry idempotency. Undo — inverse command с preconditions, не скрытая копия всего dataset.

### 9.3 TaskNotes / Day Planner перенос

- Convert Markdown checkbox/node → существующий PersonalTask: сохранять source Page/Note blockRef+revision, title, notes, parentId/projectId, recognized dates/tags. Idempotency key sourceRef+blockId+conversion kind; повторный click открывает существующую Task. Checkbox projection читает Task completion, не поддерживает второе независимое done значение.
- Task detail может иметь linked Doc body; native task notes remains task owner. One Markdown per task — portable export/import representation с rox.entity_id и mapping, а не второй canonical store.
- Calendar Base/дневной planner выводит Tasks.startAt и CalendarEvent разными объектами. Remind/due changes вызывают existing task/reminder runtime; один dedupe delivery key, один schedule/cancel owner.
- Estimate/duration/time entries/pomodoro session — scoped extensions существующей Task/time owner. Проверять pause/resume/crash/reload; elapsed duration по monotonic clock, persisted wall times для журнала. Не создавать отдельные plugin notification loops.

### 9.4 Docs и ссылки

Embedded Base query, inline row/task mention, chart snippet и action button ссылаются на те же refs и share rules. Docs comments/annotations прикреплены к page/block/range revision; удалённый источник даёт orphan, не новое совпадение title. «Открыть запись» открывает canonical detail, «Открыть исходник» показывает provenance. Агентный контекст использует existing Rox2Context.binding snapshot/live и revisionByEntityId; выбор range/view фиксирует authorized query snapshot, не весь недоступный dataset.

## 10. Schema migrations и совместимость

1. **Bootstrap v1→v2 view migration:** прочитать текущий NoteBaseView v1 и localStorage notes:views:<workspaceId>; validate; создать BaseDefinition с Notes adapter. Четыре formulas taskCount/openTaskCount/backlinkCount/tagCount сохранять как versioned built-ins. Старые keys сохранять rollback/export receipt; clear после readback новой canonical config, не до него.
2. **Page subtype migration:** contentKind additive; current note refs remain readable через alias/adapter. Перевод Note→Page требует explicit mapping, migration receipt и link/backlink/source updates; не менять все kinds простым string replace. Existing HTML PageKind оставляется своей отдельной семантикой.
3. **Field rename:** fieldId unchanged, label update instant; portable property key change — отдельная migration с import/export/backlink/formula preview и one undo. Unknown frontmatter untouched.
4. **Type change:** scan authorized affected rows, count valid/coercible/invalid, sample conflicting values, unit/timezone/cardinality impact. Новый schemaRevision pending до conversion; invalid values retained in migration payload/repair view, не discarded/null без согласованной policy. Numeric↔phone никогда implicit.
5. **Delete field:** soft delete schema field, preserve historical values и dependencies; formula/lookup/rollup consumers visible. Drop raw property — отдельный explicit destructive operation через общий permissions model.
6. **Relations:** stable ref migration; old title/path resolving report duplicate/unknown/denied; metadataConflict по relation не превращается в «первую найденную» запись. Inverse update journal recoverable.
7. **Version future/corrupt:** preserve original bytes, read-only «Нужна новая версия»/«Конфигурация повреждена», export original/repair copy. No silent default-view replacement.
8. **Concurrency:** schema revision и row revision checked вместе. Import/migration has resumable journal/checkpoint, idempotent operations и source snapshot hash. CAS prevents row edit lost during bulk conversion; resume revalidates changed rows.

Производные caches/indexes пересоздаются после migration; source files/history оставляют snapshot и хеш. Нужна rollback policy для schema/config и owner payloads; не утверждать, что browser undo отменяет внешнюю отправку или provider side effect.

## 11. Import/export и frontmatter portability

| Формат | Input → output | Что сохраняется | Явные ограничения / проверки |
|---|---|---|---|
| Markdown/frontmatter vault | Files + attachments + optional Base schema → Notes/Page/Task adapters or optional records | Raw Markdown, unknown YAML/comments, BOM/EOL, stable source IDs, wikilinks, embeds, annotations/actions opaque blocks | Folder/title не identity; collisions/unsupported fields preview. Lossless CST patcher required. Preview validates path traversal/unsafe filename and attachment ownership |
| TaskNotes notes | Recognized task properties + source path/block refs → existing PersonalTask mappings | Status/priority/due/scheduled/recurrence/tags/links, supported custom fields and raw unmapped properties | Field-name mapping configurable; timezone/date-only explicit. Pomodoro/reminder/provider secrets are not inferred or imported as authorized accounts |
| Notion Bases folder | _database.md config + note rows → new ROX definition + original-source mapping | 7 view intents/18 field mapping, raw source/schema/property keys, relations by resolved IDs | GPL code not bundled. Formula syntax adapter translates supported functions; unsupported expression preserved with diagnostic. Title-based relations require collision resolution |
| CSV | Declared delimiter/encoding/header mapping + rows → typed staged dataset | Scalar/list encoding, ids if supplied, row provenance | CSV cannot faithfully carry nested bodies/relation identity/views/ACL. Formula injection-safe export: cells starting =/+/-/@ handled per selected safe policy; preserve exact raw data in JSON/Markdown alternative |
| JSON ROX package | Schema/version/config/row refs/history/attachments manifest → same canonical adapters | Full typed values/ref IDs, view metadata, optional revision/provenance | ACL policy ref exported separately; importer resolves authority, never grants access by trusting bundle. Secrets/tokens omitted |
| Obsidian .base | Supported portable filters/formulas/view projection → .base + Markdown files | Note-readable properties, relative refs, supported query expressions | ROX custom renderers, action blocks, ACL and non-note domain actions not automatically portable; report exact unsupported features |

Export options: selected rows / all authorized filtered rows / schema+view only. Result includes source/query/schema/permission revision, exported count, timestamp/timezone, attachment map, format/version и losses report. «Всё» всегда означает accessible source universe по текущему user context. CSV summary/report и chart export используют тот же query snapshot.

Round trip contract: export→import on empty isolated workspace→readback compares typed values, relationship graph, IDs/mapping, unknown frontmatter/comment bytes и Markdown outside edited regions. Export не выдаёт unsupported field за успешно восстановленный. Импорт в существующую entity использует expectedRevision и idempotent origin mapping; повторный импорт не создаёт дубликат Task.

## 12. Optional packages вне core

| Package | Что добавляет | Shared inputs/outputs | Граница |
|---|---|---|---|
| Dynamic cards/media | Masonry/poster, image extraction, audio/video preview, file metadata | Same authorized rows, media refs, common asset resolver; local layout preferences | Не отдельная database/query/ACL; arbitrary external scraping не включается само |
| Geography | Place hierarchy, coordinates, marker layers, geocoding proposal | Typed extension fields on existing/optional records, authorized map projection, source citations | Не новый 19-й core field; external geocoder uses explicit source capability, freshness/provider attribution |
| Evidence graph | Entity/fact/source/citation, coverage, conflicting evidence, negative findings | Common refs, fact/citation schema package, shared graph renderer and authorized filters | No truth assertion from links alone; no duplicate source store; unsupported source quality remains unknown |
| Genealogy | GEDCOM/Gramps import/export, family layouts/reports | Specialized schema/adapters + common file/record storage | Not required to accept core Bases; source file format/license and privacy assessed separately |
| Fictional time | Named calendars/precision/eras and conversion | Separate date descriptor for specialized package, export raw value/calendar ID | Не coercion в Gregorian Date core; Calendar/Timeline choose supported adapter |
| Markdown ergonomics | Action buttons, tabs, highlight annotations, code headers/folding, drag handles | Docs retained blocks, existing commands/editor transactions | No Obsidian runtime/plugin loader; render/editor package cannot invent permissions/executors |

## 13. Реализация по существующим seams

Предлагаемые новые модули перечислены как planned; их наличие в baseline не предполагается.

| Рабочий пакет / владелец | Existing files | Planned artifact | Зависимость / проверка |
|---|---|---|---|
| Platform/Page owner | core/rox2/platform-contract.ts; shared page/notes protocol | Additive contentKind payload + canonical refs/legacy mapping; shared Page service API | Root Docs decision; alias/no duplicate entity proofs |
| Mutation owner | server-core/handlers/rpc/notes.ts; tasks/personal-persist.ts; handlers/rpc/personal-tasks.ts | Required revisioned typed writes, atomic check+commit, receipts/idempotency | Permission resolver; stale/concurrent tests before editing views |
| Query/schema owner | note-views.ts; knowledge/vault-index.ts; project-membership.ts | packages/core/src/bases/* typed schema/AST; packages/server-core/src/bases/* adapters/query/aggregate | Read ACL+field types; negative no-leak proofs |
| View/config owner | NotesViewHost.tsx; note-views.ts | Shared BaseDefinition persistence/migration; common renderer contract | Page service; restart/shared/private config readback |
| Renderers owner | renderer/pages/notes + TasksPage/Calendar seams | Table→Board/List→Gallery→Calendar/Timeline→Chart planned components | Same query fixture and live owner integration; actual UI QA |
| Docs/portability owner | TiptapMarkdownEditor.tsx; document-ia.ts; vault-markdown.ts | Lossless retained source parser/CST patcher; typed import/export adapters | Existing source file snapshots; unknown-bytes tests |
| Extensions owner | platform command/resource registries; plugin-bridge reference only | Capability package descriptors + typed host actions | Core schema/query completed; no third-party execution claim |

Один writer на общий файл. Согласовать protocol/types before renderer/API parallel implementation; row owners пишут только свои packages. Все source changes/product dependencies требуют отдельной implementation task; этот пакет документов их не вносит.

## 14. Verification plan с отрицательными контролями

| Acceptance | Happy / persistence proof | Failure / concurrency proof | Seeded broken result, который должен быть отвергнут |
|---|---|---|---|
| Same Task everywhere | Change task status in Board → Tasks/List/Doc reflect same ID; restart retains status/revision | Duplicate convert click yields one task; stale request returns conflict | Board mutates independent local task copy; evaluator sees owner mismatch |
| Seven views equivalence | Authorized refs equal across Table/Board/Gallery/List and date/chart contributing sets | Filtered empty, unsupported date/media, stale source; ref tie-break stable | One renderer drops ACL/filter before pagination |
| ACL totals/relations | User A sees rows1/2 and sum30; user B sees row1 and sum10, chart/rollup/export match | Hidden target not in lookup/picker; revoke during open invalidates caches | Aggregate uses unrestricted sum/denominator; hidden name in tooltip |
| Formula | Supported expression typed result same in query/chart/export with pinned today | Cycle/div0/type/fanout/time budget return explicit error | eval executes JS or unbounded expression blocks UI |
| Required CAS | Successful write revision increments/readback; idempotent replay same receipt | Two writers same revision: exactly one commit, one conflict; schema race no lost values | READ then unguarded write allows two success/lost update |
| Markdown tree | Unknown FM/comment/text/BOM/CRLF retained outside edited spans, IDs stable after 2 cycles | Duplicate IDs, malformed/future geometry retained; external edit vs subtree move conflict | Serializer drops unknown geometry or prepends comment ahead of YAML |
| Schema migration | Rename label preserves fieldId/formula/relations; type preview and rollback verified | Unsupported version read-only; crash+resume journal; invalid rows retained | Migration silently coerces phone to number or defaults unknown config |
| Imports | TaskNotes/CSV/Markdown isolated preview→import→restart→export typed match | Repeat origin mapping no duplicates; denied refs/quarantine report | Name collision links wrong target; repeated task import creates duplicates |
| Calendar/Timeline | Date-only/zoned+DST cases preserved; schedule Task same ID after restart | Invalid end-before-start, read-only ICS drag, timezone conflict | Moving all-day date converts through UTC to adjacent local day |
| Keyboard/UI | Actual grid/tab/card/dialog focus, Enter/Escape/Tab arrows; font loaded; reduced motion | Virtualized focus, permission field disabled, validation announcement | Controls click-only or focus moves to unmounted card |

Для ACL контрольный набор включает 3 строки: доступная A=10, доступная B=20, скрытая C=900. Видимый итог =30, число=2, среднее=15; после revoke B →10/1/10. Chart drill-down, export и relation rollup обязаны совпасть. Нельзя использовать «100% pass» pure helper tests как proof server ACL или native UI.

Для invariants использовать property/generated cases и существующий harness test-quality/property/mutation механизм: stable identity/order, cycle rejection, serialize/parse preservation, relation cardinality, permission subset totals, concurrent CAS. Сохранить seed/failing input и отличие infrastructure failure от caught mutation. UI proof screenshots/video — в session-specific Agents screenshot directory, SHA/revision/environment attached. Этот документ требует проверки будущего продукта; выполненный сейчас source audit зафиксирован отдельно.

## 15. Решения и открытые зависимости

**Выбрано:** common typed projections; Base как proposed Page content subtype; native Tasks/Calendar owner сохраняется; stable EntityRef relations; own bounded formula engine; server ACL before aggregates; lossless Markdown boundary; revision/CAS first; optional evidence/geography/media packages.

**Нужно реализовать:** additive contentKind + Page API/legacy mapping; mandatory CAS/atomic writes для реальных Notes/Tasks RPC; field-level permission semantics через общий resolver; 18-field registry и 7 renderers; shared config/schema persistence; source-preserving import/export. Domain CustomRecord реализуется только для новых типов с ясным владельцем. Существующие исходники и 35 Ideascape source tests не доказывают readiness этих будущих работ.

**Нужны отдельные доказательства:** md-dragger↔Tiptap adapter prototype; source plugin UI compatibility если потребуется exact UX replication; конкретный dependency/license audit при literal reuse. Проверенные metadata conflicts Highlightr/Buttons/Notion Bases остаются в manifest, а GPL engines не встраиваются автоматически в ROX.
