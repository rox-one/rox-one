# [ROX Suite][Meetings] Записи и протоколы: consent, transcript, summary и связанные действия

## Цель

«Протоколы» и материалы встречи связывают recording, transcript, cited summary, decisions и actions. Сохранить настоящий local record/import/ASR pipeline. Remote egress и AI summary не объявляются готовыми из-за присутствия кнопок.

## Source truth

ROX SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807:

- [apps/electron/src/main/meetings/local-store.ts — LocalMeetingStore, L65](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/main/meetings/local-store.ts#L65): recStart150, recChunk175, recStop189, recovery245, import266, readAudio305, transcribe333. Реальные локальные файлы/recovery; current import limit2GB.
- [apps/electron/src/renderer/lib/meetings/recorder.ts — startRecording, L126](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/lib/meetings/recorder.ts#L126) — device owner/singleton/chunks/heartbeat.
- [apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx — generateSummary, L212](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx#L212) — starts agent run; не proof доступного offline summary backend.
- [apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx — action→createPersonalTask, L588](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx#L588) — current personal Task; shared canonical Task/backlink требует domain receipt.
- [packages/core/src/meetings/model.ts — EvidenceSpan, L71](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/meetings/model.ts#L71); [packages/server-core/src/meetings/security-policy.ts — staleConsent / approveThenRevoke, L41](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/security-policy.ts#L41).
- [packages/server-core/src/meetings/finalize.ts — applyNativeFinalizeIntent, L22](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/meetings/finalize.ts#L22) — intent не является device bytes.
- DF-11/12 и MTG-03/04/06/07/08 — target contracts.

## Screens/layout и controls

«Протоколы» фильтрует тот же каталог, не создаёт новый store. Detail tabs «Обзор», «Запись», «Транскрипт», «Итоги», «Решения», «Действия», «Файлы». Wide player+transcript; narrow stack. Stage card содержит status/source/asOf/version; local запись доступна без cloud.

| Control | Typed input/default→output | Keyboard/help/effect |
|---|---|---|
| Записать локально | explicit title/workspace/device→existing bytes/Meeting | pause/resume/stop; real capture indicator |
| Импорт аудио | native file handle→local artifact/queued ASR | cancel noop,2GB policy, invalid error |
| Согласие | room/draft/artifact union, ack=false→binding receipt | показать source/checksum/audience/retention; Space ack, Enter explicit |
| Запись звонка | Call+fresh consent roster+egress→starting/active | active только provider media receipt |
| Воспроизвести | RecordingRef/offsetMs→authorized local bytes/signed URL | Space player, arrows seek; access fresh |
| Поиск transcript | query≤256+revision→segments/evidence offsets | Enter seek; никаких private cross-source leaks |
| Speaker correction | segment IDs+speakerRef+revision→derivative attribution | preview/save; raw spans неизменны |
| Итоги | ready transcript revision+capability/budget→queued cited summary | unavailable reason; не fake generated text |
| Создать задачу | reviewed authored text/Task audience/EvidenceSpan→RoxTask/backlink/assignment receipt | preview/confirm; no private autoquote |
| Retry | artifact/checksum/processor version→dedup job | только failed stage; no raw upload retry |
| Доступ | common grant editor/audience→share/revoke receipt | call membership не public recording access |

## Consent contract

Room consent binds authenticated principal, Call, policy/audience/retention revisions. Join не равен согласию. Final local upload binds artifactRef/checksum/revision/device. До финального checksum разрешено только provisional LocalRecordingHandle(workspace,device,localMeetingId,captureGeneration); upload запрещён.

Final manifest review+consent.bindLocalUpload receipt фиксирует один checksum/capture/audience. Новый файл/generation/hash/policy сбрасывает acknowledgement и требует нового preview. Worker проверяет consent при dispatch и lease retry; revoke блокирует pending upload. Upload failure сохраняет local bytes. Удаление ранее опубликованного artifact отдельно регулируется retention/legal hold.

## Commands/storage/jobs/events

Один gateway/domain authority: consent.record/bindLocalUpload/revoke, call.startRecording, artifact.retry, transcript/summary/Task commands. Local IPC остаётся настоящей device boundary. Room egress signed callback→object checksum/scan/finalize→independent preview/STT/speaker/summary jobs. S3-compatible port и durable queue; AWS не копируется автоматически.

Postgres хранит metadata и revisions; raw recording защищён grants/retention. Immutable EvidenceSpan: Meeting ref/revision, segmentId/revision, start/endMs, quote. Corrections производные; summary цитирует точные spans. Local device alias связывает один canonical ref; нет второго writer journal. Summary retry не перезаписывает audio и не запускает повторную запись.

Artifact/transcript/summary/task events питают общий outbox→Search/Activity/Notifications/Agents/Memory. Index только ready+authorized sources; revoke/delete retracts retrieval. Notification coalescing без per-chunk explosion. Transcript инструкции считаются untrusted content; tool access/preview/audience checks те же, что у пользователя.

## States/focus/microcopy

«Запись локальная; загрузка не разрешена»; «Черновое согласие: нужен checksum готовой записи»; «Условия доступа изменились — подтвердите заново»; «Транскрипция недоступна: движок не установлен»; «Итоги недоступны: backend не подтверждён»; «Обработка в очереди»; «Источник удалён — повтор невозможен». Queued не Ready.

Поля/действия доступны keyboard, help раскрывает bytes/zone/source/freshness/processor version. First invalid focus; pending save сохраняет draft. Permission/provider/engine failures различаются; закрытие drawer не отменяет уже отправленный intent.

## E2E / DoD

1. Actual native synthetic voice capture→pause/resume/stop/reload→bytes/duration/transcript; renderer crash recover; wrong owner/chunk rejected.
2. Import WAV/oversize/invalid и restart ASR queue; исходный audio не теряется.
3. Real multi-user Call→required consent→actual egress object checksum→preview/STT/cited summary; absent egress disabled.
4. Capture7 consent не разрешает capture8; changed hash/audience/revoke queued блокирует любой retry. Seed wildcard consent fails.
5. Raw segment IDs/revisions сохраняются после speaker correction/reprocessing; citation открывает same offset.
6. Unavailable summary backend даёт disabled reason; fixture не PASS local summary.
7. Action→RoxTask хранит Meeting/EvidenceSpan backlink, Project и assignee notification once; wider audience требует export decision для source text.
8. Revoke/delete open source purges player/search/agent memory; retention объясняется правдиво.
9. Retry STT не rerecord/reupload; same tuple один job; out-of-order egress reconciled.
10. Wide/narrow/ARIA/player/keyboard/help; existing local documents/personal Tasks не регрессируют.

## Scope/зависимости/сложность

RS-MTG-01 catalog; remote egress требует RS-MTG-02; RS-MTG-04 читает same artifacts; RS-MTG-03 optional context. Common ACL/entity/file/queue/search/agent/Task primitives входят в feature. Existing local-store/local-ipc/local-asr/recorder/LocalMeetingDetail сохраняются. Сложность XL; slices: local bridge, final consent upload, egress finalize, transcript, cited summary, Task workflow. #568/#389/#385/#382.


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

- `apps/electron/src/renderer/components/meetings/RecordingConsentDialog.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/electron/src/renderer/components/meetings/TranscriptEvidencePane.tsx` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `apps/workspace-service/src/modules/meetings/artifact-jobs.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/consent-artifacts.spec.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
- `tests/rox-suite/meetings/native-capture-recovery.spec.ts` — PROPOSED NEW: отсутствует в baseline249b3b44.
