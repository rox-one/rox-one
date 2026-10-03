# Проверяемая полнота интеграции: E2E acceptance suite

**План будущих проверок Revision 2; PASS не заявлен.** Baseline: Macro `c966b79d40798c6c726a3b15fe90517941fc6e61`; ROX `f63294ba4fffa7238b46b24e918925a313ad0b12`. Этот audit создал архитектуру и work packages; ниже не результаты реализованного collaborative workspace. Проверки выполняются на точном implementation SHA, deploy image digest и schema revision, указанном runner.

## 1. Общая acceptance boundary

Текущее исполнение WP-01 фиксируется отдельно: [implementation evidence](wp-01-implementation.md#фактические-проверки), `plans/compound-implementation/wp01-integration-verification.json`, `tests/macro-integration/ui/wp-01-electron.test.ts`. Реальные domain/runtime/routing проверки не подменяют ещё открытую native приёмку и финальный полный цикл программы. Исходный план ниже не является отчётом PASS.

Каждый vertical slice проверяется через настоящий changed surface: Electron renderer + RPC для desktop, поддерживаемый web client + HTTP/WS для shared workspace, native agent/MCP dispatcher для agent сценария. Direct DB fixture допустима для подготовки; пользовательские действия проходят UI/API. Mock provider подтверждает только adapter contract; provider acceptance требует реального изолированного test account и read-back через независимый provider client.

Существующие ROX local functions продолжают работать в **standalone authority mode**. Их тесты не засчитываются как multi-user shared completeness. Shared entities пишутся только workspace service; local SQLite/files становятся projection/outbox/import assets согласно 19-target-architecture. `Rox2EntityRef`, event/relation contract и triad `executionMode × lifecycle × verification` сохраняются. Fixture/simulated/queued не могут стать live/succeeded/readback_verified без соответствующего evidence. Основание: ROX `packages/core/src/rox2/platform-contract.ts:Rox2Status,Rox2EntityRef:107–141,232–239` на baseline SHA.

### Fixtures

| Fixture | Назначение / identity | Права и данные |
|---|---|---|
| A — владелец | principal UUID, два device IDs A1/A2; auth alias отдельно | owner workspace W1 и private Project P1; Gmail/JMAP test account A-mail |
| B — collaborator | другой principal; browser profile B1 | member W1, editor Page D1, channel participant, CRM commenter, назначаемый Task |
| V — viewer | отдельный authenticated principal | read D1/P1, без edit/share/manage |
| X — outsider | authenticated principal workspace W2 | не член W1; заранее знает forged refs и raw IDs W1 |
| G — guest | expiring guest identity/token | только разрешённая media room; без автоматического recording/transcript access |
| Agent-A | agent/service principal + acting user A | те же resource права A; execution policy отдельно |
| Agent-V | agent principal + acting user V, permissionMode allow-all | viewer ACL сохраняется, запрет записи |
| Contact-C | внешний sender `alice@acme.example` | Company Acme; не login principal; fixture email raw MIME + provider ID |
| Contact-D | generic email domain | contact без ложной Company Gmail/Outlook grouping |
| Shared/mail visibility | W1 team account и personal A-mail | personal message M-private доступно A; shared thread M-shared доступен A/B; ссылка не расширяет ACL |
| Calendar | account cal-A, календарь work, recurring event R1 | timezone Europe/Moscow + DST test timezone Europe/Berlin; external attendee |
| Calls | channel CH1, room prefix integration-run | synthetic audio/video stream, opt-in recording, известные speaker/text segments |

Ни email, ни display name не объединяют Principal и CRM Contact. Все fixture IDs, import batch ID и random seed записываются до запуска. Provider accounts/rooms/objects используют отдельный prefix, исключающий реальные пользовательские данные. Secrets доступны runner через credential adapter; в evidence содержатся secret reference и token expiry, без значений.

### Meaningful readiness и UI assertions

`data-testid`/ARIA labels ниже — **предлагаемый test contract**, который coding agent добавляет к существующим компонентам; это не утверждение, что markers уже существуют. Readiness определяется domain state/receipt: нужная Page загружена, task revision известна, calendar provider operation завершена. Network-idle не является readiness для polling/realtime UI.

Для каждого сценария сохранить screenshot исходного/конечного/error состояния и видео concurrency/reconnect там, где одного кадра недостаточно. Root artifact path: `~/Pictures/Shots/Agents/<canonical-session-id>/macro-integration/<run-id>/`; runner подставляет реальный native session ID. Browser tracing/ARIA dumps и JSON evidence лежат в versioned test artifact directory; не публиковать private bodies в CI logs.

## 2. Сценарий COLLAB-01: два пользователя редактируют одну ROX Page

**Work packages:** WP-01…06, WP-10, WP-15, WP-46. **UI:** существующая Pages destination; document representation рядом с сохранённой artifact representation в этой surface.

| Шаг | Действие через продукт | Ожидаемое наблюдение |
|---|---|---|
| 1 | A создаёт document Page D1 в P1, приглашает B editor; V viewer | одна Page entity, явный contentKind; B/V открывают тот же canonical ref; X denied без title/body |
| 2 | A/B открывают D1 в независимых profiles/devices | `[data-testid=entity-presence]` содержит A/B; у V read-only editor; selectionless B остаётся room participant |
| 3 | A вставляет «План», B одновременно вставляет «Согласовано» в одну исходную позицию | оба текста сохраняются; логическая CRDT content digest равен на A/B/server; не сравнивать client-local timestamps |
| 4 | A двигает selection, B вставляет текст перед selection A | B видит cursor label A; cursor привязан к ожидаемым node/span, не старому DOM offset; expiry убирает stale cursor |
| 5 | A делает undo своего текста после remote insert B, затем redo | undo удаляет только намеренное действие A; текст B сохраняется; redo не создаёт duplicate nodes |
| 6 | A offline, B редактирует; A редактирует offline и перезапускает клиент | A видит durable-local/queued статус и draft после reload; server receipt не показывается |
| 7 | A reconnect | missing operations и WAL replay сходятся; ack только после durable write; rendered text и экспорт одинаковы |
| 8 | A2 открывает D1 | один principal A, отдельный device/peer; content одинаковый; user identity не дублируется |
| 9 | A отзывает доступ B во время pending edit/await | B теряет future read/edit/subscribe, пропадает из authorized audience; pending bytes quarantined как private draft; A продолжает работу |
| 10 | Reload B; stale socket/token rejoin; X forged workspace ref | denied; нет нового content/snippet/event; draft export не публикует revoked branch |
| 11 | A открывает старую artifact Page | прежние HTML render/data refresh/action grants работают; нет forced conversion в document |

**Failure paths:** quota exceeded при WAL append; corrupt local snapshot; missing causal operation; server restart между durable append и ACK; delivered WAL pruning после snapshot failure; expired offline edits; unsupported document schema. Отличать `editing`, `durable-local`, `server-acked`, `permission_denied`, `draft_quarantined`, `sync_error`. При persistence failure нельзя показывать «сохранено».

**Seeded controls:** ACK before durable append → kill server → test обязан обнаружить потерянный edit; renderer cursor использует fixed offset → remote insert test должен показать неправильную позицию; revoke invalidation выключен → denied B test должен поймать edit или content delivery. Каждый control меняет один механизм; baseline проходит до mutation.

Источник invariants: Macro `packages/collaboration/src/collab/engine.ts:handleLocalUpdates,convergeFromServer:275–465`; `wal.ts:WAL_TTL_MS:40–41`; `services/sync-service/src/socket/protocol.rs:process_message:163–315`; Surface revocation vs legacy bypass — `durable_object/surface_api.rs:validate_surface_sockets:257–284`. Это source evidence, не test execution.

## 3. Сценарий CHAT-TASK-01: Message → Task → Project → Agent context

**Work packages:** WP-07…14, WP-36. В CH1 A пишет root Message m1 «Проверить договор Acme», B отвечает m2. UI action «Создать задачу» на m1 выбирает existing P1 и assignee B.

1. `[data-testid=message-m1]` сохраняет body, actor A, server timestamp и root; `[data-testid=task-create-from-message]` открывает preview исходного сообщения и P1.
2. После подтверждённой команды появляется один RoxTask t1; общий registry ref и source link `derived-from` указывают m1, backlink m1→t1 доступен обеим authorized сторонам.
3. Existing Tasks/P1 views показывают t1 с assignee B, status/priority/due; смена personal Today у A не меняет personal Today B.
4. B получает **одну** Notification для assignment; overlap mention/assignee/owner не умножает recipient attention. Seen/done меняют только B's recipient state.
5. Agent-A читает t1 context и получает root+bounded preceding/reply history с canonical refs/revisions; tool execution transcript отдельно от human Message.
6. Retry того же command ID/payload после network timeout возвращает t1 и тот же receipt; другой payload с тем же idempotency key rejected. Restart между DB commit и RPC reply не создаёт вторую Task/Notification/link.
7. Переназначение после revoke B проверяет явную assignment/share policy: нельзя silently вернуть доступ через ссылку или notification.

**Failure/UI states:** composer draft после offline/reload; failed message post rollback без ghost task; deleted source message tombstone/backlink fallback; denied P1 скрывает title; invalid assignee; task recurrence scheduler не запускает YAML Conductor автоматически.

**Controls:** suppress source relation → context/backlink assertion fails; duplicate outbox consume → uniqueness test sees duplicate notification; bypass task-create actor injection → X can forge command, denied test fails. **Evidence:** registry/domain/link/receipt/outbox rows, expected task count 1, notification recipient count 1, agent context refs include m1/m2 and exclude M-private.

## 4. Сценарий CRM-INGEST-01: новый email → Contact/Company

**Work packages:** WP-17…26, WP-39. Email fixture поступает provider-side в A-mail; runner не создаёт Contact/Company через DB напрямую.

| Проверка | Expected |
|---|---|
| Provider ingestion | synced MailMessage external binding включает account/provider/message ID; cursor advancing после durable ingest |
| Новый внешний sender | один Contact-C с normalized email, ContactSource/email provenance; не новый User/Principal |
| Company grouping | Acme с `acme.example`, verified normalization; domains имеют source provenance; generic-domain Contact-D не создаёт ложную provider Company |
| Interaction history | firstInteraction = минимум, lastInteraction = максимум по accepted event timestamp; out-of-order mail не уменьшает lastInteraction |
| CRM surface | existing Dossier/company representation расширена: Company row виден, contacts/email list открываются; board/list читают одну модель |
| Search/mentions | search Acme/domain/contact возвращает нужные refs; autocomplete корректный type; hidden/private записи не появляются X/V |
| Idempotency | duplicate webhook + full refresh + restart создают один message/contact/company/interaction; source key не title |
| Multi-account | одинаковый provider remote ID в разных accounts не collision; один реальный Contact может иметь несколько proven ContactSources без автоматического principal merge |
| Sharing | B видит team Company, но личный M-private не получает через Company relation; M-shared виден после отдельного разрешения |
| Enrichment failure | provider/LLM/network failure отображает pending/error; исходный email/Contact сохраняется; invented company data не заменяет verified source |

**UI assertions:** company title/contact chip/email timeline count/stage доступны после projection watermark; empty/loading/sync_error обозначены; Retry не создаёт дубликат. Hide Company изменяет visibility, не уничтожает mail history; user/team email sync controls показывают действительное состояние provider connection.

**Controls:** remove generic-domain filter → fake Gmail/Outlook Company count breaks expectation; normalize participant into login principal → Principal count invariant fails; drop account namespace → cross-account collision caught; grant project-linked personal mail → B content-negative check fails.

**Evidence:** raw fixture MIME hash, provider message ID/read-back, sync cursor revisions, ContactSource row, Company/domain IDs, interaction timestamps, search projection version, authorized/denied response sizes (без private text).

## 5. Сценарий CRM-DISCUSS-01: discussion и teammate mention

**Work packages:** WP-08/09, WP-25/26, WP-36/38. A открывает Company Acme и пишет «@B проверь новый договор» в attached discussion; B отвечает в thread.

1. Discussion parent canonical Acme; root/replies сохранены **в том же Message service**, что CH1/document discussion. CRM отдельного message store не появляется.
2. B видит notification с правильным Company deep link и thread; overlap mention/reply/owner выбирает одну semantic reason согласно policy.
3. Search на distinctive phrase возвращает Message+Company context; Contact discussion индексируется также через common projection.
4. Agent-A запрашивает Company context и получает discussion root/reply с provenance; запрос Agent-V без comment/write capability не запускает autonomous reply.
5. X знает rootId и Company ID, но HTTP/RPC/thread fetch/search/attachment URL не возвращают title/body; real-time subscription тоже denied.
6. Edit mention B→V пересчитывает occurrence/recipient effects с documented policy; reaction уникальна; thread resolve persists reload; deleted root сохраняет принятую thread navigation policy.
7. Revoke B между event enqueue и push delivery: push sender rechecks current read permission и не передаёт copied excerpt.

**Controls:** route CRM post into parallel table → common timeline/API count test fails; omit indexing → phrase search fails; notify unauthorized mention recipient → privacy test fails; follow relation без ACL recheck → X agent context leaks, test fails.

Источник: Macro `crates/messages/src/domain/models.rs:MessageParent:43–54`, `delivery.rs:MessageAudienceAccess:45–52`, `notification.rs:comment_recipients:37–76`; `crates/agent_trigger/src/outbound/message_thread_history.rs:thread_messages:81–104` на Macro baseline.

## 6. Сценарий CALENDAR-01: create / attendees / move / resize / provider read-back

**Work packages:** WP-27…30. A в ROX Calendar создаёт «Acme review» 10:00–10:30 Europe/Moscow, добавляет B/external contact attendee; provider adapter выбран в fixtures.

| Действие | Ожидаемый UI/domain/provider result |
|---|---|
| Create | event card с title/attendees/timezone; queued/running честно отображается; remoteId и readback revision после provider success |
| Drag to 11:00 | stable event entity ID сохранён; start/end меняются на 11:00–11:30, provider read-back тот же event |
| Resize to 45 minutes | ROX duration 45min, provider end 11:45; no second event; action receipt соответствует expectedRevision |
| Add RSVP | response scoped к attendee; чужой RSVP не подменяется client payload |
| Reload and second device | event/attendees/provider sync status совпадают; stale local cache не возвращает старое время |
| Search / mention | title и date metadata searchable; mention target CalendarEvent; Event→Meeting/Call link корректен |
| Provider-side edit | webhook/sync применяет новую revision; concurrent local stale revision требует explicit conflict/reconciliation |
| Recurring occurrence | изменение одного instance не меняет всю series; RRULE exceptions сохраняются после refresh |
| DST / all-day | выбранные timezone/date-only значения имеют одинаковую semantics в UI/provider; ambiguous/nonexistent local time обрабатывается явно |
| Unsupported provider feature | UI не показывает успешный resize/RSVP/scheduling, если adapter capability unavailable |

**Failures:** expired grant→reauth required; 429/backoff; provider timeout unknown outcome; invalid interval end≤start; sync token expired→full refresh preserving IDs; move while offline; provider unavailable после optimistic display. UI card pending, rollback/conflict visible; `provider_pending` не label «синхронизировано».

**Controls:** mark success before provider response → independent read-back fails; lose timezone offset → instant assertion fails; change recurring series instead of instance → non-target occurrence invariant fails; blindly retry create after timeout → remote duplicate detected.

Provider verification использует отдельный readonly client, сравнивает remote ID/start/end/attendee/etag. Network request capture самой команды без read-back не sufficient evidence.

## 7. Сценарий CALL-01: Channel → room → media → archive

**Work packages:** WP-31…35, WP-39/47. A нажимает «Начать звонок» в CH1; B joins, G joins через scoped guest link. Synthetic known audio/video streams позволяют проверить media flow, а не только room component.

1. Один Call entity с creator A/channel CH1; room provisioning receipt содержит provider room ID, token scope без token value; B membership verified server-side.
2. A/B connected UI, реальные received audio/video frames и stats; mic mute прекращает соответствующий source; screen sharing показывает known fixture pattern B. Наличие local preview без remote media не PASS.
3. G присоединяется только в разрешённую room до expiry; X или forged room/token denied; participant list identity не создаёт отдельный Calls user namespace.
4. Fixture participants explicitly opt in recording; consent UI/recording indicator visible, audit consent transitions сохраняет revision. Decline control produces call without recording artifacts; media call продолжает работать согласно выбранной policy.
5. Start recording выдаёт egress job receipt; объект сначала pending, ready только после finalized object checksum/content validation. Preview playable и duration соответствует finalized media within encoded tolerance.
6. A ends call; archive содержит canonical Call ID, participants, start/end/duration/channel context. End/retry/webhook не создают duplicate archives.
7. Recording→transcript→summary stages независимы: UI видит processing/failure/retry; transcript имеет timestamps/speaker mapping; summary ссылается на точную transcript revision и цитируемые spans.
8. Search известной phrase из transcript возвращает archived Call; authorized B opens recording/transcript; G получает только явно разрешённые assets; signed URL expiry действует.
9. Worker restart между upload/DB finalize/transcript commit не теряет artifact и не создаёт duplicate processing; corrupt/missing object produces recoverable error, не ready.
10. Existing local Meetings recording/import/finalize/reload работает отдельно от LiveKit shared mode; Calendar-linked Meeting использует существующий Call-compatible kind, без обязательной второй Meeting identity.

**Failures:** TURN unavailable; reconnect B; participant disconnect mid-call; creator disconnect; egress failure; object storage timeout; transcript provider timeout; wrong speaker identity; summary retry after transcript edit; recording consent withdrawn. UI distinguishes live/ended and recording/transcript/summary processing states. ASR accuracy измеряется относительно synthetic reference и допустимого threshold; quality нельзя «проверить» наличием непустого текста.

**Controls:** substitute dummy recording URL → playable/checksum test fails; transcript generated from unrelated media → known phrase/time segment test fails; summary loses sourceRevision → provenance test fails; guest ACL broadens to workspace → G denied content test fails; mark egress ready on queued job → object finalize assertion fails.

**Evidence:** room/egress IDs, received frame/audio energy stats, client video/screenshots, consent revision, object hash/size/duration, transcript checksum/source media hash, summary transcript revision, event/consumer receipts, search watermark. Token/raw audio/real private transcript не попадают в public logs.

## 8. Сценарий ACCOUNT-01: Company как связанный account workspace

**Work packages:** WP-12, WP-22…38. Company Acme содержит Contact-C, permitted emails, t1, CalendarEvent, Call archive, document Page, project link и discussion.

| Panel/action | Required assertion |
|---|---|
| Contacts | все linked Contacts из common graph; stable refs; no duplicate display-name merge |
| Emails | permitted thread preview/detail; M-private отсутствует у B; source/account state visible |
| Tasks | t1 открывается existing Tasks; backlink к Message и P1 сохраняется |
| Meetings/Calls | календарное событие и соответствующие Call sessions связаны; recordings по отдельному ACL |
| Documents/Files | Page/document/assets renderer правильного kind; denied file не leaking filename/snippet |
| Discussion | root/replies тот же common Message primitive, notify/index работают |
| Agent «весь аккаунт» | one authorized context response с refs/revisions/freshness; source citations across surfaces; missing/pending providers disclosed |
| Update/reload | изменения отражаются после watermark; device/restart сохраняют graph; stale revisions не перезаписывают новые |
| New entity kind probe | зарегистрированный synthetic kind получает search/mention/link/ACL/agent/activity adapters без N×N Company-specific imports |

**Controls:** one panel читает independent CRM-only model → compare ref/count/link inconsistency fails; graph resolver обходит ACL → denied personal mail appears, test fails; same title merges distinct Project → mapping fixture fails; stale memory caches body после revoke → current context negative test fails.

Agent answer должен различать source факт, inference, stale/pending projection и недоступную capability. Проверка требует deterministic context tool assertions; текстовая LLM оценка не заменяет auth/ref assertions.

## 9. Дополнительные surfaces и regression gates

| Surface / packages | Проверяемые scenarios |
|---|---|
| Tasks recurrence, WP-14 | fixed/after completion, overdue reminder, DST date boundaries, crash/retry one occurrence, cancelled/trashed series no spawn; checklist vs subtask invariant |
| JMAP Mail, WP-17…21 | существующие inbox/compose/reply/forward/draft persistence работают; labels/provider capability; attachments upload finalize; scheduled-send timezone/cancel/idempotency; multi-account reauth |
| Local Meetings, WP-35 | recording capture permission denied, ASR unavailable/import, finalize reload, approve execution pending/rejected, no claim shared audio/video |
| Notes/Files, WP-16/39/44 | external editing/import alias stable; path rename no duplicate entity; signed attachment URL; upload quarantine; denied preview/code/image/PDF metadata |
| Spreadsheet, WP-42 | cell/range edits, formula/reference errors, anchors follow stable sheet; stale cell mutation rejected; no HTML-only table claim |
| Canvas, WP-43 | whole-file revision conflict preserves both drafts; malformed graph recovery; bounds/connectors persist reload; no false CRDT parity |
| Favorites/deep links, WP-40 | canonical ref resolution across supported kinds; stale/missing/denied states; private per-user favorites; navigation history/back/panel focus |
| Agent/Skill/PR, WP-36/45 | native tool CRUD passes same ACL; deferred review not success; source Skill instructions provenance; PR context permissions; thinking/tool outputs не human messages |
| Automation, WP-37 | inbox event dedup, loop budget/correlation, restart replay, unauthorized triggered action denied, preview/outbound policy preserved |
| Desktop/mobile, WP-46 | supported viewport actual visual inspection, focus/keyboard/touch, suspended/background reconnect, lazy runtime initialization, reduced motion, loaded font |
| Deployment/retention, WP-47 | backup→fresh restore→E2E; expired signed URLs; retention deletes media/projections and preserves policy-required audit; provider secret rotations; DLQ replay |

Не добавлять UI defaults заново поверх существующих components. Actual rendered font/CSS, hover/focus/click help и keyboard accessibility проверяются там, где реализация изменяет user surface.

## 10. Feature completeness checklist — обязательна для каждой capability

В work package execution record каждому пункту присвоить `verified`, `not_applicable` с причиной или `missing`. Любой `missing` препятствует claim feature complete; `not_applicable` не допускается для permissions/search/agent только потому, что их ещё не написали.

- [ ] UI: actual interaction и visual state.
- [ ] Routing: canonical deep link, history, tabs/panels.
- [ ] Entity model: stable scoped identity, typed validation, aliases.
- [ ] Persistence: restart/reload, one authority, revision.
- [ ] Commands: authorized, idempotent, expectedRevision.
- [ ] Queries: canonical source, current ACL, bounded pagination.
- [ ] Realtime where needed: authorized delivery, replay/gap handling.
- [ ] Permissions: viewer/editor/admin/guest, revoked actor, no bypass.
- [ ] Sharing: explicit grants, inheritance rules, public-link expiry.
- [ ] Search: extractor, upsert/delete, current ACL, watermark.
- [ ] Mentions: extraction/occurrence/source revision, target policy.
- [ ] Notifications: recipient policy, dedup, seen/done/mute/snooze.
- [ ] Activity: actor/cause/revision, audit privacy.
- [ ] Agent access: common domain tools/context, acting user, provenance.
- [ ] API/MCP where applicable: identical domain checks/results.
- [ ] Observability: command/event correlation, policy epoch, queue lag, errors.
- [ ] Tests: positive, negative, persistence/recovery, sensitive seeded control.
- [ ] Documentation: behavior/limits/operator recovery/provider capabilities.
- [ ] Failure states: retryable/terminal/conflict/reauth/quarantine.
- [ ] Loading states: stale/refresh/loading without false empty.
- [ ] Empty states: genuinely empty vs denied/unconfigured/unavailable.
- [ ] Offline/reconnect where applicable: durable drafts/replay/rejection.

## 11. Invariant/property suites и seeded sensitivity

| Invariant | Generated cases / assertion | Mutation, которую suite обязана поймать |
|---|---|---|
| Scoped identity | account/provider/remote IDs, legacy aliases, Unicode names; no cross-workspace collision | omit account namespace |
| Links/tasks | parent/dependency random DAGs and attempted cycles; both endpoint rights | bypass cycle/target ACL |
| Commands | duplicate/reordered/retried command IDs, mismatched payload hash | create on every retry |
| Events | reordered revisions, duplicates, crash at each transaction/ACK point | ACK before persistence / stale projection overwrite |
| Notifications | random actor/recipient reason intersections; count≤1 per dedup key, current authorization | emit per reason or skip ACL |
| CRDT | reproducible edit schedules, partitions, import/reload; logical convergence, local selective undo | drop one WAL batch or delete remote text on undo |
| Recurrence/calendar | timezone/DST/leap-month/date-only/series exceptions | add 24h as calendar-day arithmetic |
| Mail/CRM | MIME participants, generic domains, out-of-order interactions, multi-account duplicate IDs | principal merge by email / wrong lastInteraction |
| Provider sagas | timeout after remote success, restart before receipt, webhook repeats | blind resend create |
| Memory/context | source revision/deletion/revoke, bounded graph traversal | return denied cached source |

Preserve seed and smallest failing input. Baseline must pass before mutation; infrastructure failure/timeout/unavailable provider is recorded separately and cannot count as caught mutation. Use project property/mutation tools or harness `test-quality --file <manifest>` after reading actual manifest contract; do not invent a manifest format in this architecture plan. Independent evaluator receives expected assertions and negative-control artifact without being told which is deliberately broken.

## 12. Evidence/receipt record and completion decision

Каждый run сохраняет: runId/sessionId; implementation/source commits; dirty patch hash; build image digest; lockfile/SBOM/schema revisions; actor/workspace/device IDs; fixture hash/seed; commandId/idempotencyKey; entity refs/revisions; event IDs/aggregate sequence; policyEpoch; consumer receipt/watermark; provider request/remote ID/read-back etag; artifact hash; expected/observed assertions; screenshots/traces; every attempt, duration and flaky failure.

Content hashes нужны для подтверждения checked artifact, не для раскрытия private text. Metrics include CRDT durable ACK latency, index/notification lag, reconnect convergence time, room join/media readiness, provider retry count, DLQ and permission denial. Local deterministic budget defaults: convergence ≤2s after network restoration, search/notification projection ≤10s, media join ≤15s on healthy isolated environment; production SLO определяется measured topology. Tests wait on specific assertions within budget; rerun не стирает первый failure.

Completion record имеет четыре независимых статуса: implemented, verified, delivered, journalled. Slice complete только при успешных user scenarios, актуальном failure/reload coverage и caught seeded controls; final deployment/read-back отдельно от локального pass. Полный интеграционный release требует всех семи сценариев выше, сохранения current local behaviors и disaster restore. WP-41 собирает этот release gate; он не откладывает permissions/search/agent tests из отдельных slices.
