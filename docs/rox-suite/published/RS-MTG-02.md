# [ROX Suite][Meetings] Join и preflight: реальные комнаты, устройства и scoped guests

## Цель

«Новая онлайн-встреча» и «Присоединиться» ведут в preflight и настоящую media room. До проверенного LiveKit/SFU backend интерфейс показывает unavailable. Guest использует scoped capability того же Call, а не второго пользователя workspace.

## Source truth

ROX SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807:

- [packages/server-core/src/meetings/rooms.ts — ROOM_PROVIDER_DECISION / joinRoom / roomCapabilityEnabled, L12](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/rooms.ts#L12) — provider null, room capability false.
- [packages/core/src/meetings/model.ts — MeetingEntityRef / EvidenceSpan, L69](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/meetings/model.ts#L69) — общий ref и evidence; типы не доказывают live комнату.
- [packages/server-core/src/meetings/security-policy.ts — actorFromRpc / approveThenRevoke, L13](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/security-policy.ts#L13) — actor/permission checks.
- [apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx — MeetingsWorkspace, L59](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/meetings/MeetingsWorkspace.tsx#L59) — existing seam; root catalog сохраняется.
- Target form DF-10 уточняет будущие поля; product runtime ещё не проверен.

## Layout и форма

Join dialog: «ID или ссылка на встречу» → разрешённый title/host → device preflight. Не раскрывать title по чужому коду. «Микрофон», «Камера», selectors и toggles default off; локальный preview помечен «Только предпросмотр». Primary «Присоединиться», secondary «Отмена». В live room: participant grid/list, mic/camera/share, реальное connection state, «Выйти» и отдельное organizer действие «Завершить для всех».

| Control | Typed input / default | Output / действие | Keyboard/help |
|---|---|---|---|
| ID/ссылка | string, empty | строгий parser разрешённого ROX join target → canonical CallRef | Enter проверяет, не подключает автоматически; arbitrary iframe запрещён |
| Mic/camera | false + local ephemeral device IDs | native permission → local preview; publish после connect | Space toggle, arrows combobox; refusal даёт явный listen-only выбор |
| Присоединиться | callRef + registered ROX deviceId | call.join → endpoint/token/expiry/participantRef → media connect | Enter один раз; loading lock; first error focus |
| Экран | native picker source после permission | screen track publication с actual receipt | cancel не меняет mic/camera; Stop keyboard accessible |
| Guest | expiring invite capability + allowedActions | вход только в этот Call | bearer не сохранять в URL/history/log/LLM context |
| Выйти | current participant/call | stop local tracks, disconnect; reconcile leave event | не заканчивает встречу остальных |
| Завершить для всех | organizer/admin + revision + confirm | call.end: ending→ended | dialog перечисляет эффекты для room/recording |

Media device ID отличается от зарегистрированного ROX device ID. Hardware IDs остаются в local adapter; actor не берётся из body. Join token memory-only; retry mint проверяет свежий ACL.

## API/backend/persistence/realtime

Proposed call.start/call.join/call.end и invite/revoke/media authorization регистрируются в том же gateway/domain module. Lookup join target — query этого модуля. Реальный start резервирует canonical ID/intent, создаёт SFU room idempotently, сохраняет provider binding, затем выдаёт token. Provider-created room + DB outage приводит к reconciliation исходного intent, не второй комнате.

Signed webhooks проверяют signature/body/deliveryId; replay/out-of-order дедуплицируется. Записываются participant join/leave/rejoin интервалы под одним principal. Token issuance не является proof joined. Revocation вызывает provider ejection; ожидания expiry недостаточно.

DB расширяет Call/provider-room alias/participation intervals/scoped grants/revocation epoch; общий outbox. LiveKit cloud/self-host заменяемы через adapter; egress capability независимо от room readiness.

## Permissions и compound integrations

call.join+channel membership либо scoped guest; publish_screen и call.end отдельно. Guest не может list workspace/read другой Call/transcript. Call события питают общие History/Activity/Notifications/Search. Search/agent context никогда не содержит token. Tools проверяют тот же principal; invite не выдаёт workspace grants.

## Состояния

«Медиапровайдер не подключён»; «Подключаемся…»; «Нет доступа к микрофону — разрешите доступ или войдите без микрофона»; «Соединение восстанавливается»; «Встреча завершена». Failed connect не показывает «Подключено», даже если token уже получен. Unplug/permission revoke сохраняют понятное состояние устройств. Closing preflight останавливает preview tracks.

## E2E / DoD

- Два пользователя в test room действительно слышат controlled tone, видят видео и демонстрацию; сохранить media/native evidence.
- Token issued + connect failed → никогда joined.
- Remote room created + DB failure + retry → одна room и canonical Call.
- Permission denied → явный listen-only; unplug; все local tracks остановлены при leave.
- Valid guest входит только в scoped Call; expiry/revoke проверяет active ejection и отсутствие workspace access.
- Replay webhook → один event; reconnect → новый интервал того же principal.
- Ordinary Leave не заканчивает room; organizer End создаёт один архив.
- Reload/offline/reconnect со сменой grants → fresh denial; keyboard/IME/narrow screenshots.
- Seed trust-body-actor, fixture-connected и revoke-only-TTL должны провалить соответствующие assertions.

## Scope / зависимости / сложность

RS-MTG-01 entrypoint; canonical entity/ACL/events; реально настроенный SFU, credentials, callback validation и наблюдаемость. Existing rooms/repository/sharing/RPC, LiveCallView/preflight, CallParticipants. Local capture сохраняется. Сложность XL: lifecycle media/security/device/provider. #389/#385 обязательные связанные задачи; #568 regression.


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

- `apps/electron/src/renderer/components/meetings/CallJoinDialog.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/electron/src/renderer/components/meetings/CallPreflight.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/electron/src/renderer/components/meetings/LiveCallView.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/workspace-service/src/modules/calls/media-adapter.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/join-native-provider.spec.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-MTG-01 — #1101](https://github.com/rox-one/rox-one/issues/1101)
- Связанный ранее созданный issue: [#568](https://github.com/rox-one/rox-one/issues/568)
- Связанный ранее созданный issue: [#389](https://github.com/rox-one/rox-one/issues/389)
- Связанный ранее созданный issue: [#385](https://github.com/rox-one/rox-one/issues/385)

Specification ID: RS-MTG-02. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
