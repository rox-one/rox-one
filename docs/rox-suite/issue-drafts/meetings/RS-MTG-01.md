# [ROX Suite][Meetings] Landing: действия, история и сохранение локальной записи

## Цель и наблюдаемый reference

Landing Встречи должен связывать быстрые действия и историю: изображение3 показывает две колонки action tiles слева и History справа. В ROX сохранить рабочие локальную запись, импорт, поиск, buckets и detail. Плитка онлайн-встречи не должна выглядеть как подтверждение работающего SFU.

## Source truth: текущее состояние

Repository rox-one/rox-one, SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807; source apps/packages совпадает с исследованным baseline.

- [apps/electron/src/renderer/pages/MeetingsPage.tsx — MeetingsPage, L59](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/MeetingsPage.tsx#L59) — фактически routed каталог локальных встреч. handleRecord171 запускает текущую запись; handleImport184 импортирует аудио; handlePlan198 создаёт local planned meeting, а не provider Calendar Event.
- [apps/electron/src/renderer/pages/meetings/local-meetings-model.ts — localBucketCounts / groupLocalMeetings, L44](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/meetings/local-meetings-model.ts#L44) — текущие группы/счётчики/поиск.
- [apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx — ModeScreenLayout, L12](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx#L12) — существующий layout; [apps/electron/src/shared/routes.ts — routes.view.meetings, L180](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/shared/routes.ts#L180) — route meetings[/meeting/id].
- [packages/server-core/src/meetings/rooms.ts — ROOM_PROVIDER_DECISION, L12](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/rooms.ts#L12) — provider сейчас null/undecided; это явная граница live calls.

## Layout и controls

Внутри существующих «Встречи» добавить landing representation. При ширине≥1100px: action area~340px, grid2колонки; справа растягиваемая история. Selected row открывает drawer~400px из RS-MTG-04. На средней ширине action grid выше истории; на узкой — одна колонка и detail drilldown. Existing app rail/buckets сохраняются. Не добавлять второй destination.

| Control | Input → output / действие | Hover/focus/keyboard |
|---|---|---|
| Новая онлайн-встреча | authorized Channel/Project context + mediaMode → RS-MTG-02 preflight | Enter открывает форму; help показывает capability, не обещает запись |
| Присоединиться | пустой join draft → ID/URL dialog | Enter только открывает; URL не встраивается через iframe |
| Запланировать | выбранный Calendar/context → RS-MTG-03 | Cmd/Ctrl+Enter применяется только внутри event editor |
| Демонстрация экрана | активный Call или отсутствие Call → native picker либо предварительное подключение | отмена picker не выключает mic/camera; состояние publication отдельно |
| Протоколы | authorized filter hasMinutes → тот же архив/refs | keyboard filter; counts только доступных entities |
| Записать локально | title/workspace/device → existing startRecording | повтор блокируется при starting; текущая запись видна |
| Импорт аудио | native file handle → existing importAudio → transcript tab | cancel не создаёт запись; oversize/error остаётся видимым |
| История / поиск | query≤256, bucket, cursor → authorized rows/watermark | Cmd/Ctrl+F, ↑↓, Enter; Esc очищает query, не запись |

History row: title, source badge «Локальная запись»/«Онлайн-звонок»/«Запланировано», дата+zone, duration только подтверждённая, разрешённые participants, отдельные стадии материалов. Цвет плитки — дополнительный признак; capability/ошибка сообщаются текстом.

## Domain/API/DB/events

Расширить один catalog projection: canonical ref, local device alias, paging, authorized source/status/asOf. Proposed meeting.list подключается к текущему gateway; существующий meetingsLocal.list/create/importAudio остаётся local adapter. Название/время не являются ключом объединения; planned local запись не превращается автоматически в provider Event.

DB: сохранить local JSON/files и существующий journal; shared entity registry/Meeting context relations/device alias, общий outbox. Открытие tile/row не выполняет write. События created/call started/recording finalized публикует владелец domain command ровно один раз; имена нормализуются центральной taxonomy.

## Permissions/search/notifications/agents

Счётчики/фасеты фильтруются по ACL, denied title отсутствует. Search, favorite и notification открывают тот же canonical ref. Agent читает typed authorized catalog/detail; UI automation не является domain integration. Company/Project link не открывает частный transcript/email.

## Состояния и микротекст

Loading skeleton без выдуманных встреч; empty «Здесь появятся ваши встречи. Запишите локально или запланируйте встречу»; filtered empty «Нет встреч по этим фильтрам». Unavailable live: «Онлайн-встречи пока недоступны: медиапровайдер не подключён» + Connections. Offline показывает cached asOf и readiness локальных действий. Reload сохраняет selection/filter/scroll и recording singleton.

## E2E / DoD

1. Existing local запись→pause→stop→reload→audio/transcript остаётся достижимой.
2. Импорт synthetic audio и invalid/oversize file дают правильные row/error без fake ready.
3. Fixture3authorized+1denied → ровно3rows/count3; удаление ACL-фильтра должно провалить test.
4. Mouse/keyboard открывают каждое действие в правильном route; unavailable live не создаёт fake room.
5. Drawer open/close и narrow back сохраняют row/scroll/focus.
6. Перезапуск renderer при записи сохраняет device ownership/recovery; нет второго capture.
7. Проверить actual screenshot/ARIA/font/loading/empty/offline/error; Sessions/Tasks не регрессируют.

## Scope, зависимости и сложность

Основной seam — root apps/electron/src/renderer/pages/MeetingsPage.tsx, не вложенный одноимённый wrapper. Также ModeScreenLayout/local-meetings-model и typed route integration. RS-MTG-02/03/04/05 подключаются как отдельные сценарии с capability gates. Landing реализуем при выключенных live capabilities. Сложность M; live backend принадлежит дочерним issues. Связанные #568 (local каталог), #382 (Calendar), #389 (rooms), #385 (native evidence).


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

- `apps/electron/src/renderer/components/meetings/MeetingsLanding.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/electron/src/renderer/components/meetings/MeetingActionTile.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/landing.spec.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
