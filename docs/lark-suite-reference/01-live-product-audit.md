# Live Lark Suite audit через Codex Computer Use

Проверка: **30 сентября 2026**, macOS native `/Applications/LarkSuite.app` и существующие Chrome tabs. Tool: **Codex Computer Use `cua_repl`**, accessibility state + screenshots, клики по актуальному state; координаты использованы после визуального наблюдения, когда AX text click только перемещал focus. Это read-only product inspection, не тестирование всего Lark backend.

Полный AX и screenshots остаются локально в `/Users/t/Pictures/Shots/Agents/rox-lark-suite-20260930/`. Git содержит только hashes/capture IDs и очищенные функциональные наблюдения: [live-capture-index.json](../../plans/lark-suite-reference/live-capture-index.json), [live-observations.json](../../plans/lark-suite-reference/live-observations.json). Имена/почтовые адреса, частные документы, tenant/resource IDs и приватные URLs в публичный отчёт не перенесены. Framework version из file URL — не product release version.

## 1. Evidence labels

- **OBSERVED** — фактически отобразившийся UI в указанном capture. Действие изменяющее данные не выполнялось; submit/backend receipt этим не доказан.
- **DOCUMENTED** — официальный help/API/vendor source в02/03, не entitlement текущего tenant.
- **SOURCE-VERIFIED** — прочитан конкретный файл ROX/плагина при указанном SHA.
- **PROPOSED** — target architecture/UX, включая hover/focus timings и conceptual ERD.
- **NOT_VERIFIED / ACCESS_GATE** — нужный экран не открывался, не загрузился или требует другого доступа/установки. Отсутствие evidence не доказывает отсутствие функции.

63 capture attempts включают loading states и неуспешные клики. Их нельзя называть 63 проверенными экранами. Meaningful observation records находятся в JSON; записи могут ссылаться на несколько captures. Hover API и измерение стилей в native приложении не использовались: proposed hover в05/06/08 не выдаётся за поведение Lark.

## 2. Фактически проверенные поверхности

| Observation / capture | Screen | Наблюдение | Dependency / вывод для ROX |
|---|---|---|---|
| LO-01 /01 | Messenger + in-chat search | Global rail → Chats list → conversation → right search drawer. All/Subscribed; unread badges; Bot/Official/External labels; Messages/Docs/Images & Videos; From/Date/Advanced search | Human messaging separate from ROX agent Sessions; common EntityRefs, attachment search and ACL |
| LO-02 /02 | Docs Home | Home/Drive/Wiki rail, pinned Docs/Wiki + library tree. New/Upload/Templates. Recent/Owned by Me/Shared with Me/Favorites, filters/display/list-grid. Location/Owner/Created/Recent columns | Extend Notes library; preserve same document identity across Drive/Wiki |
| LO-03 /04 | Docs New menu | Docs, Sheets, Slides, Base, Form, MindNotes, Folder. Applications: Board, Flowchart | Distinct editor capabilities, not fake routes. MindNotes exists as creation type; deep behavior not live-tested |
| LO-04 /06–08 | Existing Docs editor/comment dock | Left hierarchical ToC, centered cover/title/content. Right comment bubble with anchor; click opens Comments panel with quote, author/time/body/mention. Source anchor visually highlighted | Current ROX ToC/comments already exist; upgrade durable anchors/shared discussion; exact dimensions proposed |
| LO-05 /09 | Share menu | Invite collaborators, Permission settings, Restricted link state, Copy link | View-level menu does not establish universal ACL semantics; command rechecks current grants |
| LO-06 /10 | Base Home/templates | Base library plus template gallery; categories and multiple editors | Templates need capability/schema declaration, not executable content by default |
| LO-07 /12 | Base dashboard | Total/Completed/Incomplete/Overdue metrics; assignee/section/status charts, WordCloud. Add block/filter/automation/fullscreen/share dashboard | Shared query/aggregate authorization, not independent dashboard counts |
| LO-08 /14 | Existing task-linked Base | Grid, Print View–DocuGenius, Calendar, Gantt, Kanban, Gallery. Customize field/View settings/Filter/Group/Sort/Row height/Conditional coloring. Native task-related columns; Add record disabled, zero records | Concrete precedent for Base projection of existing task domain; zero data does not prove edit pipeline |
| LO-09 /16 | Base automation center entry | Automation center menu reached after coordinate click; deep creation/editor/executor not run | Avoid claiming full Base automation test; ROX current engine audited separately |
| LO-10 /17,48,50 | Meetings / Schedule | Home New Meeting/Join/Schedule/Share Screen/Minutes. Schedule form fully loaded and visually inspected: title, contacts/groups/emails, guest permission, start/end, all-day/timezone/repeat, video meeting settings, rooms/location/check-in/group, description/attachment/alerts/calendar/visibility/Busy; availability panel right | CalendarEvent and Meeting relation; availability query; reminder primitive; media start/recording not tested |
| LO-11 /18,56 | Calendar Rooms | Calendar/Rooms/Scheduler/More; date/Today; Building/Floor and Capacity; No meeting rooms | Rooms is separate contextual view. Week drag/resize not live-tested; public docs used |
| LO-12 /19 | Tasks | All tasks, quick access/task groups; New group/task; Filter/Sort due date/Group/Subtask visibility/Customize. Title/Owner/Start/Due/List/Creator; checkbox/subtask indicators | Task/List/group models, owner/assignee semantics and query UX; no new task submitted |
| LO-13 /20 | Contacts | Organization/External/New/Starred/Email contacts/My groups/Help Desk; selected Email contacts empty, Add email contact | Common identity separate personal/external contacts; directory/API definitions in02 |
| LO-14 /21 | Wiki spaces | Pinned/All spaces, search, new Wiki space, space cards/settings/org access | Wiki space membership and placement distinct document identity |
| LO-15 /45 | Forms project library | Create Form, check-in/application/satisfaction/more template launchers, project search, owner/date table | Separate Forms project library exists; editor/response processing not live-tested |
| LO-16 /47 | Email access gate | Expired account verification; Relink/Unlink | No claim inbox/compose works in this tenant. Provider-neutral Mail/Connection expiry UX required |
| LO-17 /24 | Approval Reimbursement form | Required Type and reason, repeated details fee/date/amount currency; images max9/50MB; required approver/CC after approval; Submit/Cancel/autosave notice | One Approval engine + business schema. Values/submit unchanged; limits observed tenant-specific, not universal |
| LO-18 /25 | Attendance admin | Overtime rules table and Attendance settings/Reports/Leave management/Overtime/admin; workday/day-off/holiday contexts | Attendance/Leave policy service, no clock-in/out result tested |
| LO-19 /26 | Announcement composer | Department/member recipients, language/title/body counters, creator display, read signoff, buzz/schedule, Preview/Draft/Timed send/Send | Broadcast recipient/audience policy, read acknowledgments and scheduling. Existing draft untouched |
| LO-20 /27 | Meegle Automation config | Work items/permissions/plugins/associations/automations; Activity log/Execution record/New rules; filter notification/type/status/field/relationship/plugin/dynamic-time/invalid/search; existing rules | Meegle independent work model vs Approval. Trigger registry/error/history patterns; no rules toggled |
| LO-21 /28 | Tanca HR gate | Trial/version/welcome and Create password required | Only onboarding observed; credential setup not crossed; private HR product documented source only |
| LO-22 /29 | Coze public landing | Agent/workflow templates/search/English/Get started/Quick start | Authenticated authoring/execution not proven; provider adapter option |
| LO-23 /30 | Seleam Maintenance | To-do/initiated/handled/CC, work order lifecycle and report menu; repair table fields including reporter/schedule/department/malfunction/priority | EAM domain separate from User/Task; mappings and native request domain necessary |
| LO-24 /31 | Seleam Assets | Asset cards/register, receive/refund/borrow/return/transfer/share/update/subassets/maintenance finance/repair/handover/disposal/audit, inventory reports | Distinct typed Asset/WorkOrder/Inventory entities; adapter, no generic UI copy |
| LO-25 /32 | Seleam customization request | Contact/role/address and module-selection request form | This is service request onboarding, not proof of tenant asset form designer |
| LO-26 /33,52 | Help Desk / Admin | Miniapp Search/Create/My, inactive desks. Admin Ticket Center/Agent/FAQ/Report/Settings; business hours/assignment/tags/ticket fields/pre-inquiry/triggers/roles; activation review required | Activation gate, scoped role/queue/knowledgebase architecture; credentials page not opened |
| LO-27 /35,59 | Workplace | App categories/cards; Approval/Attendance/Forms/Announcements/OKR/Admin/Subs/Meegle, Tanca/Seleam/Coze/DocuGenius/Report, Recruitment/Leave/OOO/Purchase/Reimbursement launchers | Catalog classifies native/templates/external/bot, not one uniform native product |
| LO-28 /37 | Report | Member/Summary, Received by me, Weekly report; date/member/unread/display; summary/next week/coordination columns; Report now/Export/pagination | Concrete form/report model; no export/submission |
| LO-29 /41 | Lingo | Term search/View all; collaboration request; contributor center and Admin/Create entry | Glossary terms with contributor/approval/search context; no entries modified |
| LO-30 /61 | Subscriptions | Welcome culture communication feed, All accounts, Assistant, comment count | Content distribution feed, not billing subscription; authoring/publish not tested |
| LO-31 /53 | OKR | Goals/Alignment/Reviews, employee search/My OKRs, Objective/Key Results/status/weights, publish disabled and saved indicator | Goals/KR/check-in/alignment; existing draft untouched |
| LO-32 /54 | Suite Admin | Organization/external collaboration/rooms/workplace/API usage/billing/storage/security/compliance/reports/customization/settings; member/app/admin permissions/review shortcuts | Common membership/admin + integration availability, avoid blanket admin privileges |
| LO-33 /58 | Legacy Favorites | Read-only discontinued feature notice; use Flag for messages | Docs Favorites still separate. Historical Messenger Favorites requirements should not be cloned |
| LO-34 /51 | AnyCross install gate | Integration-solution installation instructions + Next; no workflow canvas in this live tab | User screenshot8 demonstrates builder layout reference; current execution/config not inspected beyond gate |

## 3. Attempts that did not prove the requested screen

03 (New text focus),05 (transient Base guide while Docs loading),11 (Base loading),13 (Task list text focus),15 (Automation text focus),22–23 (Forms/Mail loading),36 (Report loading),39–40 (Lingo widget/async),43–44/60 (Subscriptions not yet loaded),46 (Forms project click remained library),49 (Schedule shell before load),55 (Favorites shell),57 (Calendar tab text remained Rooms),62–63 (Workplace category click unchanged). These remain in local manifest for audit; a later verified record supersedes relevant loading-only attempt. No repeated click is counted as feature success.

## 4. Remaining live depth

Sheets/Slides formulas/pivots/presentation, MindNotes/Board/Flowchart editing, Drive move/share backend, Wiki page ACL changes, actual calls/recording, Rooms booking, Forms submissions, all Approval template schemas, Reminders compose/delivery, Moments bot feed and DocuGenius render/export, private Coze authoring/Tanca HR, mobile gestures and Lark hover timings are **DOCUMENTED or NOT_VERIFIED**. They have catalog/design coverage, not fabricated runtime evidence. No password created, app installed, permission widened, message sent, announcement published, expense submitted or rule executed.

## 5. Interpretation for ROX

The useful reference is the relationship among views: a native Task may be projected in Base; a document can appear in Drive/Wiki/Favorites; a reimbursement is an Approval process schema; an app launcher may lead to an external service. ROX integration therefore extends existing identity/command boundaries rather than duplicating every card as an independent application. Details and source-proven constraints: [05](05-rox-bases-design.md), [06](06-rox-docs-design.md), [07](07-domain-entity-model.md), [08](08-automation-integration.md).
