# [ROX Suite][Meetings] Планирование: форма события, availability, recurrence и Calendar sync

## Цель и reference

Изображение3 показывает event modal: поля слева, availability timeline справа, footer Cancel/Save. В ROX «Запланировать» создаёт полноценный CalendarEvent с Meeting context и provider readback. Calendar — representation внутри «Встречи»; existing Tasks Calendar stripe сохраняется.

## Source truth

ROX SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807:

- [apps/electron/src/renderer/pages/MeetingsPage.tsx — handlePlan, L198](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/MeetingsPage.tsx#L198) — сегодня создаёт local planned meeting.
- [packages/core/src/calendar/types.ts — CalendarEvent / calendarEventIdentity, L24](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/calendar/types.ts#L24) — account/calendar-scoped identity, allDay/timeZone/recurrence/etag.
- [packages/core/src/calendar/adapters.ts — createProductionAdapter, L109](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/calendar/adapters.ts#L109) — production adapter unavailable.
- [packages/core/src/calendar/occurrences.ts — occurrencesInRange, L96](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/calendar/occurrences.ts#L96) — существующая read projection.
- [packages/server-core/src/meetings/conation/calendar-calls.ts — applyCalendarWrite / bindCall, L24](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/conation/calendar-calls.ts#L24) — writes сейчас не live.
- DF-07/08/09 и CAL-03 — нормативные target contracts, не доказанная реализация.

## Layout и поля

Wide modal~1000px: editor~600px, availability~360px; фиксированный footer «Отмена»/«Сохранить событие». Right toolbar «Сегодня», предыдущий/следующий день, date/zone; authorized freebusy rows, часовая сетка, busy blocks, current-time line. Medium availability раскрывается ниже формы; narrow один редактор с отдельным timeline.

| Поле | Тип/default/validation | Изменение и help |
|---|---|---|
| Название | string, new empty, trim1..512 | first focus; имя видно приглашённым |
| Календарь | explicit writable CalendarRef | existing account/calendar immutable; move отдельно недоступен |
| Участники | Attendee[], empty; exact verified emails≤1000 | группы раскрываются только в разрешённые адреса с preview; Bcc/private данные не угадываются |
| Разрешения гостей | allowInviteOthers=false | только provider-supported organizer control; не Workspace ACL |
| Начало/конец | civil date/time + IANA | end>start; DST gap reject; fold explicit offset |
| Весь день | false | UI inclusive final date→stored exclusive next civil date; не24часа |
| Повторение | none/new или actual rule | reviewed rule; instance/following/series scope; unsupported following blocked |
| Онлайн-встреча | none до media readiness | provider link/provision только проверенным adapter |
| Гости могут начать | false | только explicit provider capability; никакого owner escalation |
| Комната/место | resourceRef либо text | resource availability/booking требует adapter; text отдельно |
| Check-in | none | unavailable до отдельного service; не fake attendance |
| Обсуждение | optional authorized ChannelRef | reuse channel; создание требует typed command/permission |
| Проект/Компания | optional EntityRefs | общая связь; не share и не auto-copy private context |

Capability fields с отсутствующим механизмом disabled с точной причиной и Connections. Не считать заполненную форму реализацией rooms/check-in/guest start.

## Availability

Query range≤31дней, duration1..480мин, buffers0..1440, authorized calendar sources/participants, working hours+IANA zone. Использовать half-open intervals: исключить cancelled/deleted/transparent/own-declined; tentative/needsAction считать busy. All-day переводить из source civil dates в instants с source zone. Busy+buffers union→clip→subtract working windows→intersection required participants→duration. Multi-source failure возвращает partial/provisional и watermarks; не «все свободны».

Freebusy не раскрывает названия private events. Denied source не выдаёт count/title. DST working hours имеет явное правило; nonexistent boundaries требуют review. asOf — реальный query watermark, не время открытия панели.

## Inputs / Outputs

Inputs: `calendarRef` для create либо immutable `eventRef` + `providerEtag` для update; title, description, location, meeting link, validated attendees, allDay, IANA time zone, resolved start/end, recurrence scope и оригинальный occurrence key. Отдельный authenticated envelope: commandId/idempotencyKey/expectedRevision; actor не вводится в форму. Fields без provider capability блокируются с объяснением, а не отбрасываются молча.

Outputs: typed eventRef/revision/receiptId и operationState committed|reconciling; нормализованное provider event + asOf/readback watermark. Validation/denied/conflict/unsupported/unknown возвращаются как ошибки или незавершённый outcome с сохранением разрешённого draft. Availability query возвращает свободные интервалы, source freshness и partial/degraded state без закрытых event titles. Persisted reload открывает тот же CalendarEvent и связанные Meeting/Project refs.

## Commands/DB/events

Один gateway: calendar.createEvent/updateEvent/updateOccurrence/event.rsvp. Typed schemas содержат title/description/allDay/location/link/attendees/timeZone и immutable existing calendar binding; CAS+ETag+idempotency. Provider normalized echo становится baseline. Remote acceptance + local DB outage → reconciling original intent, не повторная create/invitation.

Own RSVP отдельно от organizer edit: server связывает owned account с attendee; caller email не авторитет. Existing readonly event может разрешать own RSVP по capability.

DB: provider-neutral accounts/calendars/canonical event/provider aliases/master exceptions/Meeting context/outbox. Local plan сохраняется до explicit binding с receipt; no title/date heuristic merge и no Event→Task conversion. Events питают common Search/Activity/Notifications/Agents; provider invite и notification dedup согласованы.

## Focus/keyboard/states

Cmd/Ctrl+Enter сохраняет валидную форму; Enter description — newline; picker Enter выбирает, не submit. Escape dirty review; background refresh не затирает draft. First invalid focus; hover/focus/click help показывает exact UTC/offset/source.

«Календарь пока не поддерживает запись»; «Проверяем занятость…»; «Данные неполные»; «Такого местного времени нет»; «Выберите смещение»; «Провайдер изменил событие — сравните версии»; «Изменение принято, завершаем синхронизацию». Нет зелёного success от fixture.

## E2E / DoD

1. Создать в test calendar→реальный readback title/time/attendees→reload same ID/context.
2. Move/resize→provider echo; stale ETag сохраняет draft и conflict.
3. Berlin all-day spring23h/fall25h; fold02:30 choice; gap rejection.
4. Instance change сохраняет master+originalStart key; following unsupported не пишет всю series.
5. Denied/timeout freebusy → no private titles/counts, partial status; seeded24h/tentative-free ломает test.
6. Own RSVP на readonly event с capability работает; wrong account отвергается до provider call.
7. Provider accepted+DB outage → один event/invitation после reconciliation.
8. Keyboard/IME/narrow/offline/loading/empty UI evidence; fixture не закрывает provider lane.

## Scope/зависимости/сложность

RS-MTG-01; identity/ACL; verified Calendar adapter/credential binding, outbox/reconciliation. Online room link зависит от RS-MTG-02 отдельно. Root MeetingsPage, CalendarGrid/EventEditor, core calendar store/adapters/occurrences, workspace calendar module. Сложность XL; guest/resources/check-in включаются отдельными работающими slices. #382/#385; #389 только для live room; #568 local plan regression.


## Общий контракт интеграции и проверки

- Расширять существующий destination «Встречи» и `routes.view.meetings(id)`. Использовать общий `Rox2EntityRef`, существующую identity workspace и единый permission layer. Не создавать вторую систему пользователей, Calendar, Tasks, notifications или отдельное приложение Lark.
- Команды поступают через текущий authenticated gateway. Actor выводится из transport; в envelope передаются workspaceId, commandId, idempotencyKey, expectedRevision/policyRevision. Повтор одного намерения использует тот же payload/hash/key; изменённый payload создаёт новое намерение.
- Состояния `executionMode/lifecycle/verification` независимы; доменный outcome хранится отдельно. Fixture, queued, выданный token и наличие экрана не доказывают live результат. Shared authority: доменные модули, Postgres, transactional outbox. Local adapter сохраняет реальные файлы и device ownership.
- Search, linking/mentions, sharing, activity, notifications, agents и memory используют общие primitives с ACL и provenance. Упоминание/связь не выдаёт доступ автоматически. Private source не копируется в более широкую аудиторию без проверенного export decision.
- UI русский и компактный; наследует выбранную пользователем светлую/тёмную тему ROX, текущие tokens/font. Reference ROX image1 тёмный; не навязывать светлую тему. Реально загруженный шрифт проверяется в UI; не заявлять Rox font по имени CSS. Help доступен hover500ms/focus/отдельным click «Что это?» и объясняет смысл, единицы, источник, asOf, пример. Hover/focus не изменяют данные. Keyboard controls и reduced motion обязательны. Desktop controls компактные28–36px с достаточной hit area; touch targets≥44px на touch/narrow layouts.
- Скриншоты пользователя не прикладывать к публичным issues. Для fixtures использовать синтетические названия «Технический обзор», Анна/Борис, example.org и тестовый workspace.
- Definition of Done включает UI, route, entity, persistence, commands/queries, ACL, realtime где нужен, search, notifications, agent access, failure/loading/empty, reload/recovery, observability, tests и документацию. Наличие экрана не закрывает feature.
- Отдельные lanes: Linux domain/render fixtures; настоящий macOS Electron/IPC/device; реальный media/provider sandbox с readback. Для каждой проверки сохранить expected/observed, revision, логи, screenshot/ARIA. Negative control должен ломать конкретную assertion; инфраструктурная ошибка не считается пойманной мутацией.

## Предлагаемые новые файлы и проверочные entrypoints

Это implementation paths будущей задачи, не существующие компоненты и не доказанная ownership allocation. Перед реализацией task owner согласует shared-file scope и typed registry с соседними issues.

- `apps/electron/src/renderer/components/meetings/CalendarEventEditor.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/electron/src/renderer/components/meetings/AvailabilityPane.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/schedule-provider.spec.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/availability-dst.test.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
