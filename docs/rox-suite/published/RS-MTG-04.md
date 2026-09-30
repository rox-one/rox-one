# [ROX Suite][Meetings] История: detail drawer, участие, lifecycle и verified readback

## Цель и reference

Изображение4: выбранная history row открывает правый drawer с title, временем, duration, display ID, participants и joined/left timeline. В ROX это view того же Meeting/Call, а не новая history entity с отдельной identity. Close возвращает выбранную row/scroll.

## Source truth

ROX SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807:

- [apps/electron/src/renderer/pages/MeetingsPage.tsx — selected / detailPanel, L150](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/MeetingsPage.tsx#L150) — текущий selection/detail flow.
- [apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx — LocalMeetingDetail, L74](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx#L74) — сохранить overview/recording/transcript/decisions/actions/documents.
- [packages/server-core/src/meetings/journal.ts — JournalSnapshot / MeetingJournal, L13](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/journal.ts#L13) — CAS/dedupe/snapshot/quarantine; journal не доказывает provider участие.
- [packages/core/src/meetings/model.ts — MeetingEntityRef / EvidenceSpan, L69](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/meetings/model.ts#L69); [apps/electron/src/shared/routes.ts — routes.view.meetings, L180](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/shared/routes.ts#L180).
- Catalog сегодня local; remote participation появляется после signed events из RS-MTG-02.

## Drawer layout и controls

Wide drawer~400px; narrow full detail с Back. Header «Технический обзор», Close. Metadata дата/время/zone, duration, «ID встречи»+Copy, source/status. Authorized avatars с accessible names. Tabs «Обзор»/«Участие»/«Материалы»; existing local detail tabs сохранены.

| Control | Typed input→output | Поведение |
|---|---|---|
| History row | canonicalRef+cursor→drawer | ↑↓/Enter; selected aria; allowed hover peek |
| Закрыть | drawer presentation state→history focus | Escape учитывает inner dialog/dirty edit; не заканчивает Call |
| ID/Copy | authorized display ID→clipboard | не token/provider secret; help поясняет display≠identity |
| Participant | PrincipalRef/scoped guest→authorized context | нет private email tooltip |
| Timeline | eventID/occurredAt/observedAt→immutable view | дата в display zone; arrival отдельно от occurred time |
| Обновить | ref+watermark→fresh detail | read retry, не повторный room create |
| Материал | ArtifactRef→RS-MTG-05 | denied/unavailable placeholder без secret title |

Local recording показывает реальные capture/pause/resume/stop events. Если участники введены текстом, подпись «Участники введены вручную»; не превращать эти имена в provider joined/left. Rejoin даёт несколько интервалов под тем же principal.

## Query/DB/realtime/lifecycle

Расширить GetArchivedCall/Meeting context projection: ref/revision/title/source/startedAt/endedAt/durationMs/authorized participants/events/artifacts/watermark/asOf. Event: canonical ID, principal/ref, joined/left/rejoined, occurredAt, observedAt, provider sequence/delivery ID и source confidence. Paging для длинной timeline.

DB: append participation events/derived intervals, verified provider aliases, общий outbox. Stable order occurredAt→provider sequence→eventID; duplicates ignored, late end reconciles. Duration считается по числовым server intervals; active duration явно «Текущая длительность». Unknown final duration: «Длительность не подтверждена».

Realtime cursor/watermark обеспечивает reconnect catch-up; out-of-order не создаёт отрицательную duration. Room ending/ended и artifact processing независимы. Local adapter сохраняет existing atomic writer/recovery; shared projection не становится вторым writer.

## ACL/search/notifications/agents

Call read/channel/source grants проверяются для каждого field/material. Denied участники/count/title отсутствуют. Revocation while open purges detail/audio URLs/cache и показывает «Доступ отозван». Search, notification, favorite и agent context открывают тот же canonical ref и authorized evidence. Agent не видит guest token; selecting history не выдаёт share.

## States/focus/help

Loading сохраняет selection; no events «История участия пока отсутствует»; offline cache+asOf; partial materials показывают отдельные reasons. Notfound/denied не раскрывает запрещённую сущность. Reload deep link открывает same ref. Focus после close возвращается row; participant/source/duration help одинаков для hover/focus/click; timeline не редактируется click.

## E2E / DoD

1. Два synthetic participants join/leave/rejoin signed callbacks → distinct intervals, one principal и one event per delivery.
2. Replay/out-of-order/late end → stable order и неотрицательная duration; reconnect восстанавливает пропущенные события.
3. Drawer/close/reload/narrow Back сохраняют selection/scroll/focus.
4. Manual local participants не отображаются как verified provider presence.
5. Revoke open drawer purges audio/detail; search/agent same ACL; seed unfiltered participants fails.
6. Fixture timeline не доказывает live Call; provider evidence отдельно.
7. Zones/DST/duration integer, loading/empty/offline/error screenshots/ARIA.
8. Existing local tabs/tasks/files из #568 доступны с прежними refs и reload.

## Scope/зависимости/сложность

RS-MTG-01 host; remote history после RS-MTG-02; материалы после RS-MTG-05. Root MeetingsPage, LocalMeetingDetail, Meeting model/journal/provider event ingestion, contextual drawer. Одна ownership area на shared files. Сложность L; local history можно доставить первым slice с честным unavailable remote состоянием. #568/#389/#385.


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

- `apps/electron/src/renderer/components/meetings/MeetingHistoryDrawer.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/electron/src/renderer/components/meetings/CallParticipationTimeline.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/history-recovery.spec.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-MTG-01 — #1101](https://github.com/rox-one/rox-one/issues/1101)
- Связанный ранее созданный issue: [#568](https://github.com/rox-one/rox-one/issues/568)
- Связанный ранее созданный issue: [#389](https://github.com/rox-one/rox-one/issues/389)
- Связанный ранее созданный issue: [#385](https://github.com/rox-one/rox-one/issues/385)

Specification ID: RS-MTG-04. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
