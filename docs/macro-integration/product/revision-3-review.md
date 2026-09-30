# Revision 3 — critical product/spec review

Статус: **FINAL REREAD / ORIGINAL R3-01–13 CORRECTED IN SPEC AND GATES; R3-14 TYPED MAPPING REQUIRED**. Проверены PRD, UI-UX-CONTRACT, collaboration-screens и domain-screens, а также соответствующие JSON и source screen evidence. Это проверка совместимости спецификаций; UI/provider E2E не запускались. Root cloud packets и shared catalog ещё записывались во время review: их отсутствие не объявляется функциональным дефектом; они требуют отдельного прохода.

ROX source `f63294ba4fffa7238b46b24e918925a313ad0b12`; artifact checkout `e780e73ae84c977cf81546b49140d318dfcd6049`. Domain/collaboration Macro evidence остаётся на `c966b79d40798c6c726a3b15fe90517941fc6e61`; PRD указывает root reverified HEAD `44a2e9efa62b557c5b0378f6376db0a6c4c6a127`. Эти SHA могут сосуществовать при сохранённом per-file reverification, а не подмене старых citations.

## Blocking corrections

### R3-01 — выбрать один placement и route authority Human Channels

**Priority P1 / blocker для routing и shell packet.**

- [PRD.md:7](PRD.md#L7), строки 19 и 120: Channels открываются внутри Project и через search/favorites.
- [collaboration-screens.md:11](collaboration-screens.md#L11), строки 22, 38–41: новый native Channels destination, `routes.view.channels()`, `channels/channel/{id}`, `channels/dm/{id}`.
- Это два разных решения, а не проверенная существующая навигация. Без решения worker может создать новую rail destination, другой worker — только Project tab, затем обе системы будут владеть selection/history.

**Correction:** PRD закрепляет Project-first placement. Canonical Channel detail должен иметь один typed builder и один NavigationState entityRef; Project Channels tab — contextual collection. Глобальный Channel route, если он нужен для DM/deep links, допустим как entity route без отдельной rail destination. Новый top-level Channels entry вводится только отдельным explicit registry decision. Синхронизировать COL-07..10 и JSON; existing Sessions остаётся agent transcript.

**Independent gate:** один Channel открыт из Project, search и favorite; один ref, одинаковый read cursor/thread и единственный route resolver. Back возвращает Project filters/tab. Seeded alternate per-Project Channel ID или duplicate rail/state должен провалить assertion.

### R3-02 — local-upload consent не имеет обещанного artifact binding

**Priority P1 / blocker для публикации локального media.**

- [domain-screens.md:1791](domain-screens.md#L1791): grant input только `callRef`, `policyRevision`, `scope`.
- Строки 1794–1795 обещают consent для конкретного artifact/version.
- Строка 1821 и `domain-screen-contracts.json` `MTG-06.commands.RecordConsent` также не передают artifactRef/checksum/version/audience/retention binding.

**Correction:** discriminated payload: room scope `{scope:"room_recording",callRef,policyRevision}`; local upload scope `{scope:"local_upload",meetingRef,artifactRef,inputChecksum,artifactRevision,audiencePolicyRef,audiencePolicyRevision,retentionPolicyRevision,policyRevision}`. Principal вводит authenticated transport. Server проверяет same workspace/source ownership и сохраняет immutable consent binding. Upload job перед отправкой проверяет consent generation/revocation и exact artifact checksum. Replacement/re-transcribe/new audience не наследуют старое согласие молча.

**Independent gate:** consent для artifact A не позволяет upload artifact B с тем же meeting ID; смена audience/policy revision требует нового preview/grant. Revoke после queue, до network send блокирует payload. Seed отсутствия checksum/audience binding должен дать воспроизводимый fail.

### R3-03 — owner/revenue отображаются, но UI contract не заканчивается persistence

**Priority P1 / blocker для CRM property editing feature completeness.**

- [domain-screens.md:238](domain-screens.md#L238): header обещает inline owner/stage properties.
- Строка 476: catalog/owner/revenue с audit.
- Строки 506–512: Revenue input возвращает только `{valid,display}`; это validation, не save receipt.
- Строка 520: единственная команда секции — `UpdatePipelineCatalog`; строка 196 `UpdateCompanyPipeline` принимает лишь stageId.
- WP-24 содержит SetOwner/SetRevenue, но screen worker не получает конкретный dispatch/save/error flow для этих controls.

**Correction:** добавить в Company detail отдельные controls Owner и Revenue; canonical `SetCompanyOwner` и `SetCompanyRevenue` либо единый `PatchCompanyProperties`, привязанный к companyRef/baseRevision/idempotencyKey. Owner picker только workspace principals, business owner не меняет ACL. Money exact minor units+currency; blank/unset отличается от zero. Pending/conflict/error preserves field draft. Command result revision/receipt, property events/audit, list/board/detail одной projection.

**Independent gate:** edit owner+revenue → reload/list/board/agent read same values and revision; forbidden principal denied; CAS conflict не silently overwrite; currencies не суммируются без conversion policy. Seed UI-only save toast должен не пройти reload readback.

### R3-04 — RSVP control не связан с отдельной typed command

**Priority P1 / blocker для Calendar RSVP slice.**

- [domain-screens.md:1232](domain-screens.md#L1232), строки 1234–1239: RSVP control обещает own attendee update.
- Строки 1253–1256: query/create/update commands, но `RsvpCalendarEvent` отсутствует.
- WP-28 имеет RSVP, однако Catalog command table позволяет worker трактовать его как organizer UpdateCalendarEvent либо только optimistic radio.

**Correction:** добавить canonical RSVP command и mapping control→command: eventRef, response, expected local revision/provider etag где требуется, idempotencyKey; actor attendee identity берётся из provider account binding. Return provider-normalized attendance+receipt/revision/reconciling state. Specify provider capability и unsupported/attendee_mismatch/provider_conflict; event_updated/activity events после подтверждённого изменения. Organizer attendee editing отдельная permission.

**Independent gate:** read-only attendee может изменить собственный supported RSVP, но не organizer fields/другого attendee. Provider failure сохраняет radio draft без falsely accepted badge. Reload должен прочитать provider-normalized response.

### R3-05 — Availability DoD ссылается на отсутствующую нормативную busy policy

**Priority P1 / blocker для воспроизводимого календарного алгоритма.**

- [domain-screens.md:1318](domain-screens.md#L1318): обещана transparence/declined/cancel/all-day policy.
- Строка 1338: GetAvailability input не содержит policy version/rules или ссылку на нормативные defaults.
- Строка 1353: «Intervals match explicit policy» не даёт expected intervals для теста.

**Correction:** закрепить versioned default rules в Calendar domain spec и response policyVersion: cancelled/transparent/own-declined исключаются; tentative/needsAction и all-day treatment определяются явно. All-day вычисляется в source zone как civil [start,endExclusive), затем проецируется в query zone без фиксированных 24h. Busy union/clipping, buffers, minimum duration и overnight working hours имеют точный порядок. Неизвестная зона/недоступный календарь возвращают partial/unavailable, не free. Если правила configurable, input получает busyPolicyRef/version; privacy не раскрывает busy titles.

**Independent gate:** таблица exact UTC/civil expected intervals для DST gap/overlap, all-day, cancelled, transparent, declined, overnight и двух calendars. Seed zero-length all-day либо missing source→empty должен провалить конкретный interval/status assert.

### R3-06 — Enter policy конфликтует между global UX и discussion

**Priority P2 / blocker перед composer implementation; small correction.**

- [UI-UX-CONTRACT.md:24](UI-UX-CONTRACT.md#L24): Enter send / Shift+Enter newline.
- `domain-screens.md` CRM-05 post control: Cmd/Ctrl+Enter send, Enter newline.
- `collaboration-screens.md` COL-08: Enter-send preference и Cmd+Enter always send; Note anchored composer уже Cmd+Enter.

**Correction:** global contract не переопределяет existing composer behavior. Зафиксировать per-surface defaults: rich entity discussion и Mail — Enter newline, Cmd/Ctrl+Enter explicit send; human Channel/DM допускает discoverable user preference, одинаковую во всех representations этого composer. IME composition Enter не отправляет; Enter на menu picker выбирает item, не post. Draft/editor focus scope prevents shell shortcut interception.

**Independent gate:** multiline draft, IME, mention picker Enter и user preference в Channel/Company discussion; один фактический send только intended gesture. Seed bubbling Enter из picker/editor должен дать fail.

### R3-07 — copied source excerpt и wider Task audience требуют одного policy outcome

**Priority P1 / blocker для source→Task privacy.**

- [PRD.md:71](PRD.md#L71): task prefill использует excerpt title.
- [collaboration-screens.md:999](collaboration-screens.md#L999): private quote не копируется без разрешённого выбора.
- Строка 1009: command копирует reviewed authorized excerpts.
- Строка 1034: assignee без source.read не получает source body через Task/search/push/agent.
- «Reviewed» creator intent само по себе не определяет допустимость disclosure более широкой аудитории. Policy preview без server-bound decision может устареть между review и create.

**Correction:** safe default — wider Task audience получает manually authored title/body и source backlink placeholder; auto-prefill private quote отсутствует. Explicit copied excerpt требует определённого source.export/declassify permission и отдельного preview с audience/policy revision/content digest, сохраняемого в command/audit. Иначе удалить copied text из canonical task payload, push/search/agent projection. Revocation/source revision changes invalidates preview; ничего не расширяет source ACL автоматически.

**Independent gate:** creator sourceViewer, assignee not sourceViewer: task/search/push/agent не содержат автоматически скопированную private строку; stale audience/policy preview rejected. Если approved export поддержан, отдельный signed decision и digest required. Seed server accepting arbitrary auto-derived quote после preview должен fail.

### R3-08 — shared Message command vocabulary требует canonical mapping

**Priority P2 / blocker для общих generated client/command registry packets.**

- Domain CRM-05 именует command `PostMessage` и control-specific `PostEntityDiscussion`.
- Collaboration COL-08/11 именует ту же общую primitive `message.create`; PRD требует один common Message engine.
- У разных имён могут быть adapters, но specification пока не описывает alias mapping и canonical idempotency/event namespace.

**Correction:** canonical dispatcher operation `message.create` с typed MessageParent/EntityRef+reply/root+body/attachments/mentions. Screen-facing PascalCase функции допускаются как wrappers на тот же operation, без отдельных handlers/tables/outbox policies. В JSON добавить canonicalOperation для controls/commands; generated packets группируют по нему. Одна notification dedup namespace и единый parent permission resolver.

**Independent gate:** создать message в Channel и Company через разные wrappers; one authority, identical error envelope and duplicate command receipt semantics; recipient replay не создаёт отдельные CRM notifications. Seed divergent wrapper persistence/event engine должен fail registry/integration check.

## Confirmed sound decisions — не требуются исправления

- Calendar находится внутри Meetings во всех просмотренных текущих PRD/domain sections; Tasks stripe сохранён. Не найдено утверждение, что новый grid/Google adapter уже работает.
- Current JMAP MailService и настоящий LocalMeetingStore/MediaRecorder/Whisper пути сохраняются; live call явно unavailable до provider integration.
- Mail provider accepted/ambiguous/scheduled/cancel-race различаются. Нет обещания exactly-once SMTP доставки либо offline summary из несуществующего local model.
- Parent/link/mention не auto-grant; counts/filter facets глобально ограничены authorized set. Last interaction источник должен сохранять это условие.
- UI screenshot, JSON/path validation, Linux fixture pass и real provider/macOS evidence явно разделены. Ни один предложенный DoD не объявлен PASS.
- Macro source SHA delta review не стирает старые baseline citations; literal source copy остаётся за отдельным license gate.

## Follow-up scope

Review cloud tool packet после его записи: schema-normalized command mappings, actual route assertions, output verification lanes и count/privacy tests. Shared screens прочитаны в дополнительном проходе ниже. До cloud review не объявлять весь Revision 3 reviewed. Root применяет corrections в owned artifacts авторов; reviewer не менял PRD/shared catalogs или central WPs. Domain corrections R3-02/R3-05 выполнены по отдельному root assignment.

## Дополнительный проход: shared catalog

### R3-09 — неверная граница existing Inbox в SH-05

**Priority P1 / blocker для сохранения рабочей Inbox surface.**

- [shared-screens.md:97](shared-screens.md#L97), JSON SH-05.currentBehavior: «Inbox remains mail».
- Source ROX `f63294ba4fffa7238b46b24e918925a313ad0b12`, `apps/electron/src/renderer/pages/InboxPage.tsx:251–255` — All/Decisions/Messages/Snoozed/Done. Строки 365–385 обслуживают agent permission/credential requests. Mail присоединяется к этой уже более широкой attention surface; она не только mailbox.
- Риск: отдельный Notification panel будет создан за счёт удаления/переноса существующих actionable requests или Inbox сведётся к Mail.

**Correction:** current описать как existing mixed attention inbox + JMAP Mail section. Уточнить new Notification/Activity panel как projections common notification primitive, сохраняющие existing actionable Inbox flows и owned request state. Agent approval decision остаётся своим authenticated domain command; mark-read notification не approve/deny request. Mail thread read state не dismisses agent approval.

**Independent gate:** открыть pending agent permission и unread mail; прочитать mail/mark notification не approve/deny agent request. Existing All/Decisions/Messages/Snoozed/Done+permission/credential actions остаются после нового panel. Seed blanket attention=mail replacement или read=>approve должен дать failure.

### R3-10 — shared JSON ещё не implementation-ready для конкретных command/query packets

**Priority P1 / blocker для автоматического screen-based coding packet.**

- [shared-screens.md:109](shared-screens.md#L109), строки 111–113: generic Inputs/Outputs/States/DoD повторены для SH-05, как и остальных screens.
- SH-05 JSON имеет human-readable `notificationIds[] + stateRevision` и «dedup durable state», но не named typed mark/read query/command/error result.
- [shared-screens.md:255](shared-screens.md#L255), строки 261–265: File upload обещает chunks/finalize/checksum/quarantine, но нет upload-intent/chunk/finalize API/state transitions и конкретного interrupted-upload test. Generic stale revision/denied check не доказывает целостность bytes.
- Это не требует нового framework: недостаток в leaf contract, который должен дополнить уже существующий common envelope.

**Correction:** для каждого SH screen добавить canonicalOperation, concrete typed queries/commands, result/error unions и minimum one domain-specific positive/negative assertion. Приоритетные примеры:

1. SH-05 `notification.list({types,readState,cursor,limit}) -> authorized rows/watermark`; `notification.setRead({ids,expectedStateRevision,read,idempotencyKey}) -> applied/failedIds/newRevision/receipt`. Два устройства, partial batch error, replay и notification target revoke должны иметь exact assertions.
2. SH-12 `file.beginUpload({parentRef,size,checksum,mime,idempotencyKey}) -> uploadId/chunkPlan/expiresAt`; `file.finalizeUpload({uploadId,partReceipts,checksum}) -> quarantined/ready/ref/receipt`; typed size/checksum/upload_expired/denied/source_revoked. Обрыв, restart, wrong checksum и hostile preview проверяют actual finalized object/read route.
3. SH-08 session sharing должен иметь audienced transcript artifact digest/redaction result, отдельный workspace grant versus external capability, revoke/readback outcome — не generic share role receipt.
4. SH-10 automation trigger/test/run receipt должен определить no-write dry-run, event dedup/loop budget и ambiguous external action behavior.

Одни semantic input/output phrases нельзя автоматически считать TypeScript schema. Добавить backend/test constraints без обещания уже существующих APIs; root packet generator не должен превращать общий DoD в feature PASS.

**Independent gate:** packet из SH-05 и SH-12 называет конкретные dispatcher symbols/errors и assertions для read-state race/bytes integrity. Seed implementation сохраняет UI state, но не domain DB/object; reload/readback обязан отвергнуть «готово». Отдельный transport timeout не считается successful mutation detection.

## Выполненные domain corrections и проверка

- **R3-02 SPEC CORRECTED:** `domain-screen-contracts.json` MTG-06.normativeConsentBinding и discriminated RoomConsentInput/LocalArtifactConsentInput/LocalDraftConsentInput; provisional LocalRecordingHandle не разрешает upload. `BindLocalUploadConsent` фиксирует final checksum/artifact revision, same capture generation/device, audience policy и retention revisions. `domain-screens.md:1839–1855` синхронизированы. Added MTG-06-T3/T4 проверяют другой artifact/capture и stale audience/hash; runtime NOT_RUN.
- **R3-05 SPEC CORRECTED:** CAL-03.normativeAvailabilityPolicy `rox-availability-v1`: exact half-open intervals, source-zone all-day, working-hours window resolution, busy status rules, buffers/union/clip/subtract/duration, complete/partial и source ACL. `domain-screens.md:1333–1357` синхронизированы. Added CAL-03-T3/T4/T5; expected spring/fall Europe/Berlin23h/25h подтверждены local timezone DB. Provider/UI algorithm execution NOT_RUN.
- JSON остаётся валиден:24 screens,54 unique DoD IDs. Existing paths/source refs не менялись. Это закрытие пробелов спецификации двух findings, не product acceptance PASS.
- **R3-03 SPEC CORRECTED:** CRM-03 controls `owner-edit`/`revenue-edit`, canonical `crm.updateCompany`, field-specific facade commands SetCompanyOwner/SetCompanyRevenue, persisted normalized output+revision/receipt, membership/currency/CAS typed errors, common list/board/context/agent readback. Added CRM-03-T3/T4; owner change не grant; null unset и zero различны.
- **R3-04 SPEC CORRECTED:** CAL-02 rsvp control maps `calendar.event.rsvp`; RsvpCalendarEvent resolves attendee from owned provider account, не trusted attendeeEmail, requires own RSVP capability, provider-normalized response и committed/reconciling receipts. Added CAL-02-T3 for wrong binding, read-only own RSVP, provider rejection и success/local-persistence failure.
- **R3-08 DOMAIN SIDE CORRECTED:** CRM-05 wrappers PostEntityDiscussion/PostMessage map canonicalOperation `message.create`; same MessageParent/root validation, repository/table, operation+actor/workspace/key namespace и outbox/notification publisher. Same key/different payload typed rejected. Added CRM-05-T3. Collaboration command registry remains same canonical operation.
- **Status vocabulary corrected:** queued/provider_accepted/readback/local_durable moved to operationState. Canonical Rox2Status remains executionMode/lifecycle/verification, verification exact source enum `unverified | receipt_verified | readback_verified`. Fixture/simulated never upgraded to live by successful receipt; local projection not shared commit. Source platform-contract.ts68–112.
- **Validation:**24 screens,58 unique DoD IDs,75 controls; docs/JSON command sections synchronized. Product E2E remains NOT_RUN.
- **Final author reread:** R3-01/06/07/09/10 исправлены; точные observations и границы verification приведены в финальном разделе ниже. Cloud gates повторно выполнены, не product E2E.

## Cloud/tool packet critical review

### R3-11 — specDigest не привязывает leaf contract contents

**Priority P1 / blocker для stale-spec receipt acceptance.**

- `scripts/macro-integration/cloud/build.mjs:14` hashes JSON.stringify(packets), PRD и UI-UX-CONTRACT.
- `build.mjs:10` packets screenRefs содержат только screen/control IDs и placement/route; readFirst содержит paths leaf catalogs, не их content/hash.
- Изменение consent payload, RSVP errors, availability rules или конкретного DoD при тех же IDs не меняет projected packet или digest. Предыдущий verified receipt сможет пройти после существенного изменения acceptance contract.

**Correction:** manifest.specSources содержит exact bytes SHA256 всех three screen-contract JSON, work-packages, PRD/UI-UX, normative architecture/license/verification contracts и tool/gate version. Digest вычисляется детерминированно из content hashes+packet schema, не только path/IDs. Validator пересчитывает текущие input hashes и требует regen manifest; same stale spec refused. Scoped per-WP digests допустимы, если включают полные selected screen fields, dependencies и shared normative contracts.

**Independent gate:** изменить только MTG06 consent checksum binding или CAL03 busy rule, сохранив control IDs. Старый digest/receipt обязательно rejected, regenerated digest differs. Seed hashing paths/IDs only должен провалить test. Reviewer tool files не менял.

### R3-12 — negativeControl считается доказанным без mutant evidence

**Priority P1 / blocker для claimed mutation sensitivity.**

- `scripts/macro-integration/cloud/gates.mjs:16`: negativeControls достаточно truthy `caught`, `mutation`, `reproduction`.
- Строка20 hashes tests/visual/provider evidence, но не baseline/mutant negative-control outputs.
- Воспроизводимый reviewer probe с настоящим checksum-verified baseline log, `caught:true`, произвольной mutation description и **без любого mutant log** проходит validateReceipt({verifyProof:true}). Observed `negativeProofMissingAccepted:true`.

**Correction:** negative control содержит baseline and mutant attempt records: command, tested artifact SHA/patch digest, seed/input, structured test ID/assertion, expected result, exit code/outcome classification, logPath+sha256. Baseline проходит; mutant даёт конкретный assertion failure по seed, не timeout/infra/build failure. Все paths/hashes/owner проверяются. Evidence отрицательного теста привязывается к тем же lane и implementation/spec digest; reviewer review явно подтверждает sensitivity.

**Independent gate:** receipt без mutant log/hash rejected; timeout/infra failure не caught; altered log rejected; actual seeded wrong-idempotency build fails named invariant while baseline passes. Не выдавать proof PASS за simple caught:true JSON.

### R3-13 — changedPaths декларация не проверяет фактический Git delta

**Priority P1 / blocker для owned patch/completion receipt.**

- `scripts/macro-integration/cloud/gates.mjs:13–14` проверяет только self-reported paths against allowedPaths.
- `gates.mjs:21` проверяет ancestry, но output=input также satisfies ancestry. `cli.mjs ready` не reconciles receipt.changedPaths с actual diff inputSha→commitSha.
- Reviewer probe passes receipt с inputSha=commitSha и несуществующим declared changed path; observed `noActualImplementationDeltaAccepted:true`. Это gate probe с synthetic receipt, не product E2E.

**Correction:** trusted verifier вычисляет actual changed paths по Git committed delta (включая renames/deletes/submodules) и сопоставляет exact set с declared receipt+ownership; unowned committed file cannot be omitted from receipt. Проверить proof/test artifact принадлежность revision; normal implementation WP требует relevant actual code change либо отдельный reviewed no-code outcome reason. Empty diff не закрывает implementation посредством fabricated changedPaths. Patch artifact hash привязать к input/output SHAs.

**Independent gate:** commit добавляет unowned file, но receipt умалчивает; sameSHA с fake declared path; renamed path escapes scope — все rejected. Valid owned patch+actual tests passes. Seed declaration-only checking должен fail.

### Bounded probe evidence / boundaries

- Static code read: build.mjs, cli.mjs, gates.mjs, gates.test.mjs; cloud SPEC/EXPECTED-RESULTS. Test receipts не отправлялись в scheduler, providers/workers не запускались.
- Node reviewer probe создал только own temporary baseline log в `os.tmpdir()/rox-review-gate-*`, проверил validator и удалил этот temporary directory finally. JSON result: `{negativeProofMissingAccepted:true,noActualImplementationDeltaAccepted:true,reviewKind:"PLANNING_GATE_SENSITIVITY_ONLY_NOT_PRODUCT_E2E"}`.
- Следующий проход root после fixes должен проверить current gate bytes; прежний успешный artifact validator не является доказательством исправления этих случаев.


## Финальный reread после corrections

Дата: 2026-09-30. Прочитаны текущие authored bytes; historical findings выше сохранены как provenance original failures, а не как текущие открытые defects.

| Finding | Текущее решение | Проверка |
|---|---|---|
| R3-01 | Human Channels только Project/Search/Favorites context; existing destinations без новой Channels rail | collaboration-screens.md:11/26/42–45, COL-07–10 routes/DoD; согласовано с PRD |
| R3-02 | Room/artifact/local draft consent различаются; final artifact checksum/audience/retention binding после local draft | MTG-06 normativeConsentBinding и input unions присутствуют; dispatch/retry recheck specified |
| R3-03 | Owner/revenue CAS persist/readback; facades primary crm.updateCompany, owner не ACL grant; CRM-03 owns WP-24 | JSON workPackages includes WP-24; оба controls canonicalOperation=crm.updateCompany; docs index/affected list синхронны |
| R3-04 | Own attendee RSVP calendar.event.rsvp, immutable account binding/capability gate, organizer field edit отдельно | CAL-02 typed command/errors/negative tests; supplement separateOperations сохраняет distinct operation |
| R3-05 | Availability rox-availability-v1 actual interval intersection, DST/all-day/status/ACL/partial rules | CAL-03 normative policy, exact examples/tests; provider algorithm runtime NOT_RUN |
| R3-06 | Per-surface Enter policy; Channel default Enter send/Shift newline, CRM multiline Enter newline/CmdCtrlEnter send | UI-UX-CONTRACT.md:24 и collaboration controls keyboard/IME precedence |
| R3-07 | Manual title/body + backlink safe default; explicit signed source export required before broader audience copy | PRD.md:72; supplement serverConstraints include actor/source/audience/digest/expiry; canonical union normalized in R3-14 resolution below |
| R3-08 | Message wrappers all resolve message.create, shared parent/principal/key/table/outbox | collaboration/domain contracts + cloud/contract-amendments.dispatcherAliases agree |
| R3-09 | Inbox retains All/Decisions/Messages/Snoozed/Done, permission/credential and JMAP attention flows | SH-05.currentBehavior; read state distinct approval/deny; seeded read→approve negative assertion |
| R3-10 | Shared leaf JSON adds queryContracts/commandContracts, errors, control canonical mapping and domain-specific assertions | 18 shared screens, 51 named typed query/command contracts, 18 domain-specific definitionOfDone entries |
| R3-11 | Full authored spec inputs byte-hashed in manifest; CLI rejects current input/packet/prompt drift | build.mjs:16–18 specInputs; cli.mjs:7/11/17 verifies hashes |
| R3-12 | Baseline/mutant evidence hashes, assertion failure classification and exit codes required | gates.mjs:16/20; negative-control missing/checksum/infra tests PASS |
| R3-13 | Commit must differ from input; ready reconciles actual Git delta with declared paths | gates.mjs:11/21; cli.mjs:18 trusted git diff callback; fake omitted unowned file test PASS |

Дополнительная нормализация scope verified: ui-slices WP-27 owns initial Meetings CalendarGrid/read representation before WP-28 event editor/RSVP; unavailable provider write stays disabled. WP-24 owns CRM owner/revenue/pipeline CAS. screenRefs describe final shared DoD; каждый WP owns only its slice, consumes dependencies, не переписывает full screen. Existing Dossier/Mail/Meetings representations сохраняются. SH-18 Reminder detail добавлен как отдельный reload-safe canonical route; открыть reminder не значит автоматически перейти в source. Lead владеет latest Macro Reminder source delta и exact source reverification.

### R3-14 — explicit typed sourceTransfer adapter

**Priority P1 / bounded contract-normalization correction before packet freeze.**

- COL-15 collaboration-screen-contracts.json содержит payload sourceTransfer:link_only|exported_excerpt и discriminator sourceTransfer.mode (около строк5368–5377).
- plans/macro-integration/cloud/contract-amendments.json requestSchemaExtension использует discriminator kind со значениями backlink_only|approved_export.
- Product privacy semantics совпадают, но это разные typed wire inputs; supplement precedence не задаёт exact facade→canonical payload transformation.
- Root notified. Required mapping: leaf mode=link_only→canonical kind=backlink_only; leaf mode=exported_excerpt→canonical kind=approved_export с decisionId/contentDigest/sourceRevision/audiencePolicyRevision, подписанным server decision validation. Либо normalize leaf exact same union. Unknown combinations/missing export proof fail schema before task commit.
- Independent assertion: compile/validate actual leaf facade inputs into canonical request; no manual untyped casts; unique private marker remains absent in backlink-only task/push/search/agent. Product execution NOT_RUN.

### Фактически выполненная verification

- Command: `node --test scripts/macro-integration/cloud/gates.test.mjs`. Observed: 10 tests,10 passed,0 failed/skip/cancelled; exit0. Includes stale spec, unchanged commit, missing lane/review, fixture→provider rejection, dependency ancestry, overlapping ownership, preflight, real proof hash/symlink, omitted actual path, missing transitive prerequisite, infra/missing negative evidence. Это PASS receipt/gate test suite, не PASS продукта/провайдера.
- Domain JSON parse/current owner mapping verified:24 screens; CRM-03 workPackages includes WP-24; owner-edit/revenue-edit map crm.updateCompany. Current domain controls75 и unique DoD58; shared typed51 across18 screens. Combined lead inventory61screens219controls relies on current author catalogs, не deployed UI.
- Root final cloud rebuild/validate должен выполняться после frozen domain/leaf/supplement bytes; прежний manifest до правок считается stale. Reviewer не regenerates shared packets.
- All new UI/native/provider/collaboration product scenarios remain NOT_RUN. Cloud runners PREPARED_NOT_LAUNCHED; current test suite proves only artifact gating behavior. No prompts/memory/shared implementation files изменены.

### R3-14 resolution and R3-15 cloud file allocation

COL-15 normalized to the exact canonical `sourceTransfer.kind=backlink_only|approved_export` union, cloned from supplement. Leaf request schema and Markdown use identical oneOf; sourceRef/Project/assignee UI fields map to canonical sourceMessage/project/assigneePrincipalIds. Independent macro_collab Ajv strict/allErrors run:21cases,4accepted/17rejected; server signed-decision/runtime enforcement remains future gate. New component path is allocated CreateTaskFromMessageDialog.tsx; shared Message schema uses original messaging/contracts.ts, no parallel messages domain. R3-14 CLOSED_SPEC_CORRECTION_VERIFIED.

Root cross-file challenge found missing permissions to write proposed collaboration UI files in cloud packets. `ui-slices.screenPrimaryUiOwners` assigns all19screen implementation seams/tests to a primary UI owner present in the screen workPackages; generator includes exact paths and overlap serialization. CLI.validate rejects unallocated screen files. Actual CLI fixture baseline exits0; removing allocated path causes assertion-matched nonzero; cloud gate suite now11/11. This fixes packet ownership; it does not implement screens. Final independent readback follows in cloud validation report.

Independent routed-seam scout additionally identified root MeetingsPage (distinct from nested meetings page), Omnibox, MemoryScreen, AutomationEditor/ListPanel, SharePageDialog, SkillsListPanel, early MailPanels/Inbox and Connections. These existing write seams are explicitly allocated per owner in ui-slices.additionalRoutedSeams and validated by CLI; overlap leases serialize shared files. Licensing-only WP48 stays UI-free. Source refs remain in current-screen audit; read-only references do not automatically grant edit ownership.
