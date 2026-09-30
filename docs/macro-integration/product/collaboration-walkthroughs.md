# Collaboration walkthroughs — Revision 4

**PROPOSED. Product runtime NOT_RUN.** Authored flows refine existing COL controls; no new navigation destination/component ownership introduced. Input artifacts commit `249b3b44220bcfbd7d467de9cfc18f76e1c37807`; code source `f63294ba4fffa7238b46b24e918925a313ad0b12`. Показанные refs и actors — controlled fixtures, не пользовательские реальные данные.

## Что уточняется

Текстовые wireframes ниже описывают ожидаемый product UX, не снимки работающего приложения. Каждый шаг связывает user action → canonical data → receipt → recovery. Generic loading/empty states остаются в leaf screen catalog; здесь приведены конкретные transitions и fail assertions. Existing route base и proposed query/representation отдельно отмечены; current source не объявляется collaborative implementation.

## CWT-01 — Один Page: двое редакторов, offline replay и отзыв открытого доступа

**Entry existing:** pages → pages/page/{slug}; fixture pages/page/launch-brief.

**Proposed:** Same route resolves page:P1 contentKind=collaborative_document; history adds ?panel=history.

**Current code limit:** Existing PageConfig/PageView are artifact runtime. Collaborative body/remote caret/revoke UX are proposed, not inferred from SessionPresenceAvatars.

**Actors:** A owner/editor, B editor on deviceB1, A2 second device of A, V viewer, X outsider.

**Identity:** Page library, opened document, remote cursor room, history and Project link all resolve page:P1. Body versions/frontiers are revisions; never new Page IDs. Existing html_app Page subtype remains separately preserved.

```text
Страницы / Launch brief              [Алёна] [Борис] [Доступ]
Launch brief                                              
[Сохранено на сервере · 10:00:12] [История]                 
─────────────────────────────────────────────────────────
Заголовок документа                                        
План запуска  |Борис                                      
→ обсуждение выделения                         [Обсуждения]
OFFLINE: Нет связи · На устройстве: 2 изменения             
```

### Numbered actions and observable results

#### 1. A — Открыть Launch brief и тем же разрешённым deep link открыть его у B.

**Control:** `COL-01.open` («Открыть страницу»). **UI owner:** WP-10; **mechanisms:** WP-02, WP-03, WP-10.

- **Input**: page:P1 slug alias launch-brief; workspaceW1
- **Ожидаемый экран**: Один документ, одинаковый title и начальный body; skeleton завершается разрешённым query, а не пустым экраном.
- **Данные**: A/B entityId page:P1; same initial frontierF0
- **Receipt**: Read query has pageRef/revision/policyEpoch; no mutation receipt for open.
- **Focus / hover / help**: Enter по row переносит focus в title/body; hover row не вызывает edit/read receipt раньше установленной viewing policy.
- **RU microcopy**: Загружаем документ…
- **Recovery**: При 403 показать «Нет доступа к документу», не «Документ пуст».
- **Negative assertion**: X route returns denied; no title/snippet leaked.

#### 2. A — Навести и сфокусировать avatar B, затем B поставить caret после слова «План».

**Control:** `COL-02.presence` («Участники»). **UI owner:** WP-10; **mechanisms:** WP-03, WP-10.

- **Input**: Awareness actorB peer deviceB1 CRDT position
- **Ожидаемый экран**: Avatar «Борис · редактирует» и помеченный caret видимы A; V остаётся viewer.
- **Данные**: Presence keys by principal/device; expiry removes stale peer; no persisted body operation.
- **Receipt**: Awareness no durable content ACK; show freshness from peer event.
- **Focus / hover / help**: Tab avatar открывает ту же card, click «О присутствии» поясняет TTL/источник; cursor events не aria-live announcements.
- **RU microcopy**: Борис · редактирует
- **Recovery**: После peer timeout avatar «Не в сети», caret удалён; не навечно online.
- **Negative assertion**: B email/contact private attributes absent from presence card.

#### 3. A+B — Одновременно A добавить «1. Подготовить материалы», B добавить «2. Проверить доступ» в разных позициях.

**Control:** `COL-02.body` («Содержимое документа»). **UI owner:** WP-10; **mechanisms:** WP-04, WP-05, WP-10.

- **Input**: CRDT opA/opB at F0; distinct opIds
- **Ожидаемый экран**: Обе строки появились на обоих устройствах; caret позиции скорректированы без прыжка focus в начало.
- **Данные**: One CRDT document; same converged frontierF1/hash; no last-write-wins loss.
- **Receipt**: Append ACK only after durable WAL commit; opId/accepted frontier retained.
- **Focus / hover / help**: Body remains focused; editing does not open new panel. Screen reader announces save state once, not every keystroke.
- **RU microcopy**: Сохранено на сервере
- **Recovery**: Если append timeout, оставить pending с opId, retry idempotent; UI не рисует server saved заранее.
- **Negative assertion**: Seed ACK-before-persist crashes service: restored body must retain every ACKed op.

#### 4. B — Отключить сеть B, добавить «3. Собрать обратную связь»; A online добавить строку «4. Опубликовать».

**Control:** `COL-02.sync` («Синхронизация»). **UI owner:** WP-10; **mechanisms:** WP-05, WP-10.

- **Input**: Controlled proxy offline forB; queued opB2; A opA2
- **Ожидаемый экран**: B видит «Нет связи» и local queued count; A видит только свой acknowledged edit.
- **Данные**: Local WAL keeps B pending bytes; server has A op only before reconnect.
- **Receipt**: Local persistence receipt ≠ remotely committed; no green live badge.
- **Focus / hover / help**: Focus badge: help shows lastAckAt and queued count, click opens queue inspector; body remains usable under valid offline authority policy.
- **RU microcopy**: Нет связи · На устройстве: 1 изменение
- **Recovery**: Failure local WAL leaves visible «Не удалось сохранить на устройстве»; keep draft in memory, do not claim saved.
- **Negative assertion**: Before reconnect server/search snapshot cannot contain B opB2.

#### 5. B + controlled upgrade fixture — При offline pending edit имитировать новый app build/cache schema и открыть статус синхронизации перед reload.

**Control:** `COL-02.sync` («Синхронизация»). **UI owner:** WP-10; **mechanisms:** WP-05, WP-10, WP-51.

- **Input**: Pending doc opB2, old/new appBuildVersion and cacheSchemaVersion; CRDT document schemaVersion/frontier tracked independently.
- **Ожидаемый экран**: Показывается upgrade pending и причина задержки reload. Текущий документ/selection остаётся; app-cache disposal не считается сохранением document ops.
- **Данные**: Durable local document WAL/checkpoint preserved across app cache reset only through supported writer migration. App asset/cache epochs differ from doc CRDT schema/frontier. Protected content is not dumped into unguarded recovery file.
- **Receipt**: App-build preparation/drain result separate from doc local persistence/durable server ACK. Unsupported WAL/cache migration blocks reload; no fake document-saved receipt.
- **Focus / hover / help**: Focus sync badge, click help «Обновление приложения»: версия приложения, версия локального cache, pending ops и lastAckAt показаны отдельно; Escape returns body focus.
- **RU microcopy**: Обновление приложения. Изменения ещё синхронизируются.
- **Recovery**: После reconnect дождаться ACK для opB2, завершить app/cache request drain, только затем reload и проверить same page:P1/frontier/hash. Если offline reload допускается конкретной writer implementation, нужна verified durable WAL migration; иначе дождаться сети. App asset cache можно восстановить без потери document WAL.
- **Negative assertion**: Seed app-cache disposal also clearing document WAL: scenario must fail on lost pending op. Cache upgrade completion alone cannot produce «Сохранено на сервере».

#### 6. B — Пока B offline изменить title, а A online тоже переименовать документ.

**Control:** `COL-02.title` («Название документа»). **UI owner:** WP-10; **mechanisms:** WP-03, WP-05, WP-10.

- **Input**: B expectedMetadataRevision=r1 title «План B»; A title «План запуска»
- **Ожидаемый экран**: После reconnect body merge разрешён, title показывает conflict compare: current «План запуска», local «План B».
- **Данные**: Metadata CAS separate from body CRDT. Only chosen rename commits new metadata revision.
- **Receipt**: page.rename conflict expectedr1/currentr2; bodyACK independent.
- **Focus / hover / help**: Inline conflict gets focus; compare buttons «Оставить серверное» / «Применить моё» require explicit fresh command, no silent retry overwrite.
- **RU microcopy**: Название уже изменено другим участником
- **Recovery**: Keep local proposed title through network retry; choosing current cancels rename only, not body ops.
- **Negative assertion**: A title cannot be overwritten by automatic offline queue replay.

#### 7. B — Вернуть сеть и дождаться body convergence; A2 открыть тот же документ.

**Control:** `COL-02.sync` («Синхронизация»). **UI owner:** WP-10; **mechanisms:** WP-05, WP-10.

- **Input**: B reconnect anti-entropy opB2; A2 same principal newdevice
- **Ожидаемый экран**: A/B/A2 видят четыре строки и одинаковый server watermark, B queue0.
- **Данные**: Op IDs dedup; CRDT body hash equal; A devices distinct presence peers under one principal.
- **Receipt**: Replay durableAck forBop, projection watermark may lag and is shown separately.
- **Focus / hover / help**: Click queue detail lists accepted opIds; «Сохранено на сервере» only after ACK; cursor local selection restored.
- **RU microcopy**: Связь восстановлена · Изменения сохранены
- **Recovery**: Repeat reconnect/reload cannot append duplicate lines; failed search indexing displays freshness separately.
- **Negative assertion**: Seed duplicate replay: one semantic line and one receipt per opId.

#### 8. A — Открыть history и сравнить F0/F2, не меняя document body.

**Control:** `COL-04.version` («Версия»). **UI owner:** WP-15; **mechanisms:** WP-03, WP-15.

- **Input**: page:P1 allowed sourceRevisionIds
- **Ожидаемый экран**: Inspector показывает авторов/time/revision; выбранная версия readonly, live body остаётся F2.
- **Данные**: Versions belong page:P1; artifact bundle digest is not CRDT version.
- **Receipt**: Read-only version query; no restore command on select.
- **Focus / hover / help**: Arrow version list +Enter selects; Escape returns to prior Page focus. Help «Версия документа» distinguishes body/history from ACL.
- **RU microcopy**: Просмотр версии · Только чтение
- **Recovery**: Expired/missing version shows «Версия недоступна»; live page remains open.
- **Negative assertion**: Selecting history must not revert permissions or issue restore.

#### 9. A — В «Доступ» отозвать grant B, пока B редактирует; показать final revoke только после fence.

**Control:** `COL-02.share` («Доступ»). **UI owner:** WP-10; **mechanisms:** WP-03, WP-10, WP-51.

- **Input**: subjectB directgrant; expectedPolicyEpoch; revoke command
- **Ожидаемый экран**: A sees «Отзываем доступ…», then «Доступ отозван» after committed fence; B open view turns neutral denied.
- **Данные**: Policy epoch increments; sync subscriptions/HTTP/tool reads deny B; no post-fence accepted append.
- **Receipt**: Revocation command/fence receipt records epoch and cutoff; pending ≠ complete.
- **Focus / hover / help**: Dialog initial focus subject; destructive confirmation explicit. Upon B denial focus heading, body/caret/cache previews purged.
- **RU microcopy**: Доступ к документу отозван
- **Recovery**: If fence not complete show pending/retry status; no false final green. Device currently disconnected cannot be erased remotely; enforcement occurs at reconnection or policy lease boundary.
- **Negative assertion**: Seed open websocket/new RPC/direct legacy save: all B writes after revoke fence rejected.

#### 10. B — Попытаться продолжить через open editor/keyboard, перезапустить app и reconnect с unsent protected draft.

**Control:** `COL-02.body` («Содержимое документа»). **UI owner:** WP-10; **mechanisms:** WP-03, WP-05, WP-51.

- **Input**: B oldpolicy/writer tokens, queued postrevoke op
- **Ожидаемый экран**: Editor недоступен; neutral message no previous private body/title/cursors; no copy/export protected content by default.
- **Данные**: No new server op; received revoke purges protected projection and queue per policy. Recovery of declassified self-authored draft needs separate approved export, never implicit.
- **Receipt**: Denied receipt currentepoch; no success ACK/outbox search/notification.
- **Focus / hover / help**: Keyboard event on disabled editor cannot dispatch. «О доступе» focusable help explains request-access only if supported.
- **RU microcopy**: Нет доступа к документу
- **Recovery**: Preserve error/correlation without protected text. Regrant requires fresh read/session; old token does not become valid.
- **Negative assertion**: Server read/tool/search denies B after app reload; physical erasure on unreachable device is not asserted.

### Identity / files / closure

Source refs: R03, R06, R20, R21, R22, C03. Allocated component/test paths are read-only references to current leaf + manifest; no second component proposed.

| Role | Exact paths |
|---|---|
| Existing source | apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx<br>apps/electron/src/shared/routes.ts<br>packages/core/src/rox2/platform-contract.ts<br>packages/core/src/types/page.ts |
| Allocated planned change | apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx<br>apps/electron/src/renderer/components/app-shell/nav-destinations.ts<br>apps/electron/src/renderer/components/pages/CollaborativeDocumentEditor.tsx<br>apps/electron/src/renderer/components/pages/PagesHome.tsx<br>apps/electron/src/renderer/pages/NotesPage.tsx<br>apps/electron/src/shared/routes.ts<br>packages/shared/src/workspace-domain/collaboration/contracts.ts<br>tests/macro-integration/ui/col-01.spec.ts<br>tests/macro-integration/ui/col-02.spec.ts<br>tests/macro-integration/ui/col-04.spec.ts |

Testable ambiguity resolved:

- App-build/cache-schema request drain/reload не заменяет document WAL persistence. Latest Macro upgrade delta остаётся root-owned audit; proposed gate не объявлен текущей ROX реализацией.
- Metadata rename uses CAS while body uses CRDT.
- Presence freshness differs from content durability.
- Revocation pending/final fence and unreachable-device limit explicit.

DoD **PLANNED_NOT_RUN**: All authored happy/negative/reload/concurrency steps yield stated screen/data/receipt outcomes; screenshot/ARIA, content hashes, source revisions and real gate receipts required; provider lane only where an external write is actually added. A/B separateauthcontexts, clock/networkfaultcontrols, seededmechanismmutationwithspecificassertion; baselinepass≠infrastructurefailure; nofeaturepassfromwireframe/schema.

## CWT-02 — Private сообщение → shared Task: ручной текст и нейтральный backlink

**Entry existing:** tasks/task/{encodeURIComponent(taskId)} and projects/project/{slug} already supported.

**Proposed:** Project→Channels→channel:C1→thread=channel-message:M1→CreateTask overlay; after receipt tasks/task/T1.

**Current code limit:** Current PersonalTask has source/links, but atomic shared Message→Task/export authorization is proposed.

**Actors:** A private channel member / Task editor, B Project assignee without source.read, X outsider.

**Identity:** createdFrom TaskT1→channel-message:M1 preserves source revision without copying source ACL/body. Project overview and Tasks list resolve same TaskT1; B denied source placeholder has no channel title.

```text
Создать задачу                                      [×]
Источник: сообщение в закрытом канале [Открыть]             
Название [                                                ]
Описание [написать вручную                               ]
Проект [Launch]      Доступ [Участники проекта]             
Исполнитель [Борис]                                       
Текст источника не будет скопирован.                       
[Отмена]                                  [Создать задачу]
```

### Numbered actions and observable results

#### 1. A — Открыть toolbar конкретного private сообщения и выбрать «Создать задачу».

**Control:** `COL-08.more` («Действия сообщения»). **UI owner:** WP-08; **mechanisms:** WP-08, WP-11.

- **Input**: M1 body contains PRIVATE-MSG-73; currentread allowedA
- **Ожидаемый экран**: Overlay attached to selectedM1; source readonly preview forA only, blank manual title/body by default for widerProject audience.
- **Данные**: SourceRef M1/revisionm-r7 captured; no Task row created yet.
- **Receipt**: No mutation before submit.
- **Focus / hover / help**: ShiftF10 opens actions, arrow/Enter selects; dialog focus title. Hover «Создать задачу» explains backlink and recipient privacy.
- **RU microcopy**: Текст источника не будет скопирован
- **Recovery**: Escape closes unsent overlay and returns focus exactM1 toolbar; reopening same draftId restores authored fields.
- **Negative assertion**: No auto-derived title/body/excerpt contains private marker.

#### 2. A — Вручную ввести title «Подготовить предложение» и body «Согласовать срок с командой».

**Control:** `COL-15.title` («Название задачи»). **UI owner:** WP-11; **mechanisms:** WP-11.

- **Input**: manual title/body; sourceTransfer.kind=backlink_only
- **Ожидаемый экран**: Required title label and manualtext visible; title trim/nonempty, field error inline if empty.
- **Данные**: Canonical payload top-level title/body; no taskFields/sourceExcerpt serialized.
- **Receipt**: Draft only until submit.
- **Focus / hover / help**: Tab title→body; help click «Что увидит исполнитель» shows these exact fields, source access stays separate.
- **RU microcopy**: Название обязательно
- **Recovery**: Validation moves focus first invalid field; existing manual draft survives.
- **Negative assertion**: Unknown autoPrefill/sourceExcerpt rejected schema; marker absentTask payload.

#### 3. A — Выбрать Project Launch и посмотреть effective audience B/V.

**Control:** `COL-15.project` («Проект и доступ»). **UI owner:** WP-11; **mechanisms:** WP-03, WP-11, WP-12.

- **Input**: ProjectPJ1 currentpolicy revision9; B no source.read
- **Ожидаемый экран**: Audience preview displays allowed recipient principals; notice source remains private.
- **Данные**: Canonical projectRefPJ1; destination policy current at commit; not channel inherited grant.
- **Receipt**: Preview query reports policyRevision; no permission grant issued.
- **Focus / hover / help**: Enter picker/arrow selection; click help explains source vsTask policy with exampleB.
- **RU microcopy**: Задача доступна участникам проекта. Источник остаётся закрытым.
- **Recovery**: Policy changes before create invalidate exported decision/refresh audience; manual draft remains.
- **Negative assertion**: Choosing Project never auto-grants Channel/M1 toB.

#### 4. A — Выбрать Бориса как исполнителя из разрешённых workspace principals.

**Control:** `COL-15.assign` («Исполнитель»). **UI owner:** WP-11; **mechanisms:** WP-01, WP-03, WP-11.

- **Input**: assigneePrincipalIds:[B]; sourceMessageRefM1
- **Ожидаемый экран**: Assignee chipB; one notification preview, not sent yet.
- **Данные**: PrincipalB login identity reused; no CRM Contact treatedasprincipal.
- **Receipt**: Read picker no task.assign receipt yet.
- **Focus / hover / help**: Arrow search picker B; label «Исполнитель». Help says recipient will see Task only, not source body.
- **RU microcopy**: Борис получит уведомление о задаче
- **Recovery**: Deleted/disabled principal denied at commit; inline picker error retains text.
- **Negative assertion**: X otherworkspace never appears, hidden totals absent.

#### 5. A — Cmd/CtrlEnter отправить canonical backlink_only payload; повторить submit при network timeout.

**Control:** `COL-15.create` («Создать задачу»). **UI owner:** WP-11; **mechanisms:** WP-04, WP-07, WP-09, WP-11.

- **Input**: sourceMessageM1(revisionm-r7),title/body,projectPJ1,assigneeB; stablecommandIdct73; sourceTransfer:{kind:backlink_only}
- **Ожидаемый экран**: Pending «Создаём задачу…», duplicate button disabled; receipt navigatesTaskT1, toast link «Открыть задачу».
- **Данные**: Atomic TaskT1+createdFrom edge+outbox; one assignment notification; idem retry returnssameT1.
- **Receipt**: Rox2 succeeded/receipt_verified only after commit; exposesTaskRef/revision/commandId/notification enqueue, not delivery claim.
- **Focus / hover / help**: Focus newTask heading after navigation; pending Escape cannot cancel dispatched effect.
- **RU microcopy**: Задача создана
- **Recovery**: Timeout retainscommandId; reconcile before retry; no optimistic newTaskT2.
- **Negative assertion**: Seed idempotency removal: two retries must fail assertioncanonicalcount1.

#### 6. B — Открыть assigned Task через notification и выбрать «Исходный контекст».

**Control:** `COL-14.source` («Исходный контекст»). **UI owner:** WP-13; **mechanisms:** WP-03, WP-09, WP-11.

- **Input**: TaskT1 createdFromM1; B deniedM1
- **Ожидаемый экран**: Manualtitle/body visible; source neutral «Источник недоступен», withoutprivatechannelname/snippet.
- **Данные**: Task read allowed; source read denied; agent/search/push projection omitted PRIVATE-MSG-73.
- **Receipt**: Source denied result no body; attention enqueue vsdelivery independentlytracked.
- **Focus / hover / help**: Enter source chip staysneutral or permittedrequestaccess; help reachable with disabledreason.
- **RU microcopy**: Источник недоступен
- **Recovery**: Back navigation/reload preserveTask selection; no stale cached source preview.
- **Negative assertion**: B search/push/agent/screenshot string PRIVATE-MSG-73 absent; Task assignment grants no source.read.

#### 7. A — Negative branch: явно выбрать approved_export в отдельном review; подменить decisionId или изменить audience до submit.

**Control:** `COL-15.create` («Создать задачу»). **UI owner:** WP-11; **mechanisms:** WP-03, WP-11.

- **Input**: approved_export decisionIdserverstored,contentDigest,sourceRevisionm-r7,audiencePolicyRevision9; currentchanges10
- **Ожидаемый экран**: Inline denial, existing manually authored draft kept; never successTask before check.
- **Данные**: Current authenticatedactor/source/policy/digest/expiry serverbound; noTask/edge/outbox on failure.
- **Receipt**: export_decision_stale / audience_policy_changed / content_digest_mismatch / export_not_permitted.
- **Focus / hover / help**: Error focus onexportreview; help shows exact approvedcontent and targetaudience, notrenderer permission toggle.
- **RU microcopy**: Состав участников изменился. Проверьте доступ ещё раз.
- **Recovery**: Reissue signed preview from authority; removing export chooses safe backlink_only; no local caller signature accepted.
- **Negative assertion**: Unsigned/stale decision or changed digest neverexportsmarker; schema shape alone cannotprove signedauthorization.

### Identity / files / closure

Source refs: R03, R12, R15, R19, R21, R22. Allocated component/test paths are read-only references to current leaf + manifest; no second component proposed.

| Role | Exact paths |
|---|---|
| Existing source | apps/electron/src/renderer/pages/ChatPage.tsx<br>apps/electron/src/renderer/pages/tasks/QuickEntry.tsx<br>apps/electron/src/shared/routes.ts<br>packages/core/src/rox2/platform-contract.ts<br>packages/core/src/tasks/personal/types.ts |
| Allocated planned change | apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx<br>apps/electron/src/renderer/components/messaging/MessageComposer.tsx<br>apps/electron/src/renderer/components/messaging/MessageTimeline.tsx<br>apps/electron/src/renderer/components/tasks/CreateTaskFromMessageDialog.tsx<br>apps/electron/src/renderer/contexts/NavigationContext.tsx<br>apps/electron/src/renderer/pages/ChatPage.tsx<br>apps/electron/src/renderer/pages/ProjectInfoPage.tsx<br>apps/electron/src/renderer/pages/tasks/QuickEntry.tsx<br>apps/electron/src/renderer/pages/tasks/TaskDetail.tsx<br>apps/electron/src/shared/routes.ts<br>packages/shared/src/workspace-domain/messaging/contracts.ts<br>tests/macro-integration/ui/col-08.spec.ts<br>tests/macro-integration/ui/col-10.spec.ts<br>tests/macro-integration/ui/col-14.spec.ts<br>tests/macro-integration/ui/col-15.spec.ts<br>tests/macro-integration/ui/col-17.spec.ts |

Testable ambiguity resolved:

- Wider-audience default blank manual form.
- Assignment enqueue versus actual delivery distinct.
- Canonical sourceTransfer.kind and signed decision currentpolicy boundary retained.

DoD **PLANNED_NOT_RUN**: All authored happy/negative/reload/concurrency steps yield stated screen/data/receipt outcomes; screenshot/ARIA, content hashes, source revisions and real gate receipts required; provider lane only where an external write is actually added. A/B separateauthcontexts, clock/networkfaultcontrols, seededmechanismmutationwithspecificassertion; baselinepass≠infrastructurefailure; nofeaturepassfromwireframe/schema.

## CWT-03 — Project → private Channel → reply thread без нового native destination

**Entry existing:** projects/project/launch; existing Projects destination.

**Proposed:** projects/project/launch?tab=channels&channel=channel%3AC1&thread=channel-message%3AM1; these query fields require typed route/parser work, not current builder support.

**Current code limit:** ProjectInfoPage sessions/tasks/cwd/details exist. HumanChannels/tab/thread directory and timeline are proposed; AgentSession ChatPage is not the human model.

**Actors:** A Projecteditor, B invited channelmember, V Projectviewer notchannelmember.

**Identity:** ChannelC1 is linkedtoProjectPJ1, not copiedintoProject. Thread root/refM1 and replyM2 retain sameChannelparent; AgentSession IDs never assignedtohumanrows.

```text
Проект Launch: [Обзор] [Задачи] [Каналы] [Контекст]           
Каналы проекта       | # запуск            [Участники]     
# запуск             | Алёна: Начинаем подготовку          
[Новый канал]        | [1 ответ] [Реакция] [Действия]       
                     | ┌ Тред: Начинаем подготовку ┐     
                     | | Борис: Беру материалы     |     
                     | | [Ответить…] [Следить]     |     
                     | [Сообщение…] [Прикрепить] [Отправить]
```

### Numbered actions and observable results

#### 1. A — Из существующего Project открыть вкладку «Каналы».

**Control:** `COL-17.tabs` («Разделы проекта»). **UI owner:** WP-12; **mechanisms:** WP-02, WP-08, WP-12.

- **Input**: ProjectPJ1 sluglaunch
- **Ожидаемый экран**: Contextual channel directory; existing Projects nav remains selected; Sessions destination retainsagentbehavior.
- **Данные**: Query filters permittedProjectlinkedChannelRefs only; titleProject unchanged.
- **Receipt**: Read query; route/list selectionrestorable.
- **Focus / hover / help**: Arrow tablist/Enter; focus active tab then directory. Hover help «Каналы проекта» explains scoped list, no globalduplicate.
- **RU microcopy**: Каналы проекта
- **Recovery**: If nochannels «В этом проекте пока нет каналов» +create; denied query notempty.
- **Negative assertion**: NativeAPP_NAV_DESTINATIONS gains no duplicateChannels/MacroChat destination.

#### 2. A — Создать private канал «запуск», добавить B, оставить history policy explicit.

**Control:** `COL-07.create-channel` («Новый канал»). **UI owner:** WP-08; **mechanisms:** WP-01, WP-03, WP-08, WP-12.

- **Input**: nameзапуск,visibilityprivate,ProjectPJ1,membersA/B
- **Ожидаемый экран**: Create dialog audiencepreview; afterreceipt row#запуск selected.
- **Данные**: OneChannelC1+membership+Projectlink; ProjectviewerV notautomaticmember.
- **Receipt**: channel.create commandIdcc73 givesChannelRefC1/currentpolicy, eventoutbox.
- **Focus / hover / help**: Focusname; Enter validation nonblank; tooltipvisibility persistentdescription «Только выбранные участники».
- **RU microcopy**: Только выбранные участники
- **Recovery**: 409namecollision promptschoose existing only ifauthorized; doubleclickidemreturnsC1.
- **Negative assertion**: V channel list/search excludesprivateC1; no hidden count.

#### 3. A — Отправить «Начинаем подготовку» в канал; проверить newline/IME precedence.

**Control:** `COL-08.compose` («Сообщение»). **UI owner:** WP-08; **mechanisms:** WP-04, WP-05, WP-08.

- **Input**: body,ChannelC1,parentRef,clientMessageIdm73,commandIdmp73
- **Ожидаемый экран**: Pendingbubble thenauthor/time/editedmetadata; Enter sends,ShiftEnternewline; optionalCmdEntermode explicitpreference.
- **Данные**: MessageM1 parentChannelC1; canonicalmessage.create commonoutbox.
- **Receipt**: Committed receipt returnsM1; typing/awareness notdurable message.
- **Focus / hover / help**: Composerfocus retainedafter send. IMEcomposition/mentionpicker Enter selectscomposition/option andnever send.
- **RU microcopy**: Сообщение
- **Recovery**: Failedpost keepsdraft+attachment refs, bubblefailedretry samecommandId; offlinequeuednotSent.
- **Negative assertion**: Repeatedcanonicalalias PostMessage samecommandIdcreatesoneM1; noAgentSession transcriptwrite.

#### 4. B — Клавиатурой открыть reply у M1.

**Control:** `COL-08.reply` («Ответить в треде»). **UI owner:** WP-08; **mechanisms:** WP-03, WP-08.

- **Input**: M1 rootRef,parentChannelC1
- **Ожидаемый экран**: Rightthreadpanel rootreadonly, focusreplycomposer; maintimeline scrollanchorpreserved.
- **Данные**: No newThreadentity copy; query rootM1 and permittedreplies.
- **Receipt**: Readthreadquery no messagecreation merely onopen.
- **Focus / hover / help**: ShiftF10/arrow «Ответить в треде»; Escape closes andreturnsM1 toolbar; hoverdoesnotmarkread.
- **RU microcopy**: Ответить в треде
- **Recovery**: Rootdeleted becomes tombstone «Сообщение удалено», permittedrepliesremain; forbiddenrootdeniespanel.
- **Negative assertion**: Wrongparentroot fromotherChannel cannotattach despitevalidmessageid.

#### 5. B — Отправить «Беру материалы» и открыть thread у A.

**Control:** `COL-10.reply` («Ответить»). **UI owner:** WP-08; **mechanisms:** WP-07, WP-08.

- **Input**: ChannelC1,threadRootM1,body,commandIdreply73
- **Ожидаемый экран**: Threadone reply, maintimeline«1ответ»;rootparentcomposerpolicy inherited.
- **Данные**: ReplyM2 parentChannelC1/rootM1; commonMessagesprimitive.
- **Receipt**: message.create receiptM2; notificationdedup perrecipient/event notsecondthreadengine.
- **Focus / hover / help**: Enter send inChannelthread; ShiftEnter newline; ifentityDiscussionthread CmdEnter only. Replyfocusretained.
- **RU microcopy**: Беру материалы
- **Recovery**: If rootpermissionrevoked beforecommit typeddenied; pendingdraftnotpostedelsewhere.
- **Negative assertion**: Root+reply canonicalparent equalityasserted; rootstatusreadnotagentmemoryautoshare.

#### 6. A — Включить «Следить за тредом», затем перезагрузить route.

**Control:** `COL-10.follow` («Следить за тредом»). **UI owner:** WP-08; **mechanisms:** WP-07, WP-08, WP-40.

- **Input**: rootM1,enabledtrue,actorA
- **Ожидаемый экран**: Togglechecked persisted;reload restoresChannel+Thread with focusroot, notnewconversation.
- **Данные**: PerprincipalattentionpreferenceA; B preference unchanged.
- **Receipt**: Follow receiptcurrentpreference; readcursornotreset byreload.
- **Focus / hover / help**: Space toggles; aria-pressed/readablehelp «Ответы в этом треде»;no toggleonhover.
- **RU microcopy**: Следить за тредом
- **Recovery**: If preferencesavefails reverttoggle+toastretry, threadsafe; selectionURL remains.
- **Negative assertion**: OtherusercannotoverwriteAfollow; no notification onhover.

#### 7. A — Через contextual directory открыть «Написать человеку» B дважды.

**Control:** `COL-07.dm` («Написать человеку»). **UI owner:** WP-08; **mechanisms:** WP-01, WP-03, WP-08.

- **Input**: recipientPrincipalB,pairA/B,workspaceW1
- **Ожидаемый экран**: SameDMconversation reused; no newSessions entry; explicitparticipantheader.
- **Данные**: ensureDm uniquepair returnsoneChannelDM1; groupadditiondoesnotcopyhistoryimplicitly.
- **Receipt**: IdempotentensureDmref; read/write sameMessageauthority.
- **Focus / hover / help**: Pickerfocussearch, EnterselectB; help «Личный разговор» distinguishes AgentSessions.
- **RU microcopy**: Личный разговор с Борисом
- **Recovery**: Noaccessibleprincipal→field error; addingC opensnewgroup explicithistory choice.
- **Negative assertion**: A/B principalnamespace reused; orgadmin cannotreadprivateDMautomatically.

### Identity / files / closure

Source refs: R01, R03, R04, R16, R19, R21, R22, C20, C21. Allocated component/test paths are read-only references to current leaf + manifest; no second component proposed.

| Role | Exact paths |
|---|---|
| Existing source | apps/electron/src/renderer/components/app-shell/nav-destinations.ts<br>apps/electron/src/renderer/contexts/NavigationContext.tsx<br>apps/electron/src/renderer/pages/ChatPage.tsx<br>apps/electron/src/renderer/pages/ProjectInfoPage.tsx<br>apps/electron/src/shared/routes.ts<br>packages/core/src/rox2/platform-contract.ts |
| Allocated planned change | apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx<br>apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx<br>apps/electron/src/renderer/components/messaging/MessageComposer.tsx<br>apps/electron/src/renderer/components/messaging/MessageTimeline.tsx<br>apps/electron/src/renderer/contexts/NavigationContext.tsx<br>apps/electron/src/renderer/pages/ChatPage.tsx<br>apps/electron/src/renderer/pages/ProjectInfoPage.tsx<br>apps/electron/src/shared/route-parser.ts<br>apps/electron/src/shared/routes.ts<br>packages/shared/src/workspace-domain/messaging/contracts.ts<br>tests/macro-integration/ui/col-07.spec.ts<br>tests/macro-integration/ui/col-08.spec.ts<br>tests/macro-integration/ui/col-09.spec.ts<br>tests/macro-integration/ui/col-10.spec.ts<br>tests/macro-integration/ui/col-17.spec.ts |

Testable ambiguity resolved:

- Exact existing Projects base versus proposed query seams.
- Thread keyboard inherits parent; IME never accidental send.
- Channelmembership separateProjectpermission; DMnotAgentSession.

DoD **PLANNED_NOT_RUN**: All authored happy/negative/reload/concurrency steps yield stated screen/data/receipt outcomes; screenshot/ARIA, content hashes, source revisions and real gate receipts required; provider lane only where an external write is actually added. A/B separateauthcontexts, clock/networkfaultcontrols, seededmechanismmutationwithspecificassertion; baselinepass≠infrastructurefailure; nofeaturepassfromwireframe/schema.

## CWT-04 — Native Note conflict → явная shared-authority conversion

**Entry existing:** notes/note/{encodeURIComponent(nativeNoteId)} from routes.view.notes(nativeNoteId); fixture resolves saved native ID, never guesses filename-derived identity.

**Proposed:** Same legacy route alias resolves canonical note:N1 after authority receipt; sharedbody embeddedinNotes editor, not newMacroPages destination.

**Current code limit:** Notes Tiptap and save queue exist. saveNote optional read-check-write/no lock and UI885 omits expectedRevision: conflict protection/atomicconversion must be implemented.

**Actors:** A nativeNoteowner, A2 externalfilewriter, B proposedsharededitor.

**Identity:** Rename/move/authority switch preserve note:N1 and registered nativealias. A Page wrapper, if laterexplicitlycreated, has distinct page ref plusrelation; never mutate note:N1 into page:N1 or duplicate samecontent writablemasters. This fixture converts authority within W1 only. Moving a personal note to a different workspace requires explicit cross-workspace mapping/new scoped ref; same entityId string does not imply same EntityRef across workspaces.

```text
Заметки / Подготовка встречи                   [Сделать совместной]
Режим: На устройстве · файл только на этом устройстве            
Содержимое…                                                     
[Конфликт сохранения]                                           
Сервер/файл: revN2    Мой черновик: revN1                         
[Сравнить] [Оставить файл] [Скопировать мой черновик]              
Конверсия: командаW1 | участникиA/B | вложениеF1 требуетразрешение
[Отмена]                                  [Сделать совместной]
```

### Numbered actions and observable results

#### 1. A — Найти native заметку «Подготовка встречи» и открыть её существующийroute.

**Control:** `COL-05.filter` («Теги и поиск»). **UI owner:** WP-16; **mechanisms:** WP-02, WP-16.

- **Input**: nativeNoteId resolvedfromread; canonicalaliasN1
- **Ожидаемый экран**: NativeNotes editor/frontmatter/wikilinks retained; filemode visible.
- **Данные**: NoteN1 stablealias, revisionn-r1=filehash; sameNote acrosslist/editor.
- **Receipt**: Native readreceipt metadatahash/mtime notsharedsyncACK.
- **Focus / hover / help**: Searchfocus followedrowEnter; filterqueryretainedreturn; help source «Файл на устройстве».
- **RU microcopy**: На устройстве
- **Recovery**: Missingfile shows «Файл заметки не найден» withreload/importchoice; notempty newnote.
- **Negative assertion**: Titlematchcannotmerge anothernote withsamefilename/title.

#### 2. A+A2 — A изменить body, A2 independently изменить nativefile beforeA save.

**Control:** `COL-06.editor` («Текст заметки»). **UI owner:** WP-16; **mechanisms:** WP-05, WP-16, WP-51.

- **Input**: expectedRevisionn-r1; disk now n-r2; localdraftAdifferent
- **Ожидаемый экран**: Target show compare conflict; localdraftkept, nofalseSaved.
- **Данные**: Per-noteatomicwrite criticalsectionchecksrevision andreplace; ordinarysourcebaseline readcheckwrite insufficient.
- **Receipt**: Targetnote.update conflict expected/actual, no overwritecurrentfile.
- **Focus / hover / help**: Conflictalertfocus compare; «Скопировать мой черновик» limitedunsharednative draft rights; noforcedreload.
- **RU microcopy**: Заметка изменилась вне приложения
- **Recovery**: Choose«Оставить файл» refreshesn-r2; manualmerge retriesnewexpectedrevision. Backup/copy never overwrites currentfile.
- **Negative assertion**: Seed bypassCAS→disk n-r2contentmustsurvive; two writers serialized atactualauthority.

#### 3. A — Открыть «Сделать совместной» после разрешения native conflict.

**Control:** `COL-06.share` («Сделать совместной»). **UI owner:** WP-16; **mechanisms:** WP-03, WP-10, WP-16, WP-51.

- **Input**: NoteN1 revisionn-r3,targetW1,proposedmembersA/B
- **Ожидаемый экран**: Conversion preview content+metadata+attachmentpolicy; no automaticshare immediatelyonclick.
- **Данные**: Noauthoritychange beforecommit; migration plan registersnativealias andsinglewriter cutover.
- **Receipt**: Previewmigrationtoken/digest notcommittedreceipt.
- **Focus / hover / help**: Dialogfocusaudience first; help «Режим хранения» shows canonicalsource/lastread/checksumandwhy file becomesprojection.
- **RU microcopy**: Файл станет проекцией совместной заметки
- **Recovery**: Cancel returnsNoteeditorfocus unchangedn-r3; conversion draftsavedonlylocally.
- **Negative assertion**: Hover/clickopen dialog cannotgrantB oruploadprivatebody.

#### 4. A — Проверить private imageF1 и wiki source before conversion; выбрать разрешённую копиюили исключить.

**Control:** `COL-06.properties` («Свойства»). **UI owner:** WP-16; **mechanisms:** WP-03, WP-09, WP-16, WP-39.

- **Input**: F1 noB grant; metadata/privatewiki refs
- **Ожидаемый экран**: Previewlists F1 «Не будет доступно Борису» andsafeplaceholder; body exportpolicyblocksunsupportedprivateembed.
- **Данные**: FileRefF1 unchanged; no automaticgrantfromnote; omit/exclude choicesinmigration plan.
- **Receipt**: Capabilityread each referencedobject;copyapprovedexplicitcommand separatelyifneeded.
- **Focus / hover / help**: Tab warning/action; clickhelp shows grant vslinkdifference, sourcefreshnessfrompolicyquery.
- **RU microcopy**: Вложение требует отдельного доступа
- **Recovery**: If sourcepermissionchanges digestpreviewinvalid, reopenreview; no permissivefallbackrender.
- **Negative assertion**: BconvertedNote must notfetchprivateF1url orwikibodythroughrendercache.

#### 5. A — Подтвердить conversion одинраз; during pending попробовать legacynative save.

**Control:** `COL-06.share` («Сделать совместной»). **UI owner:** WP-16; **mechanisms:** WP-03, WP-10, WP-16, WP-51.

- **Input**: n-r3previewdigest,targetW1,A/B grants,conversioncommandIdnc73
- **Ожидаемый экран**: Pending«Переводим в совместный режим…», thenauthoritybadge«Совместная заметка» afterreceipt.
- **Данные**: Atomicalias/bodyauthority/grants cutover; oldwriterblocked. Nativefile becomesreadprojection/exportasset, notsecondmaster.
- **Receipt**: Migrationreceipt canonicalNoteRefN1,sourceAlias,from/toauthority,contentdigest,epoch andreadback; pendingnotconverted.
- **Focus / hover / help**: Focusreturn editoroncommit; sharedbodybindinginitializedonewriter; no hiddenpagecreation.
- **RU microcopy**: Совместная заметка
- **Recovery**: Crash beforecommit leavesnativeauthority; aftercommit recovery readsreceipt/idempotentmapping andsharedstate, neverdualwriter.
- **Negative assertion**: Postcutover legacy saveNote andagent rawfilewrite rejectedforN1; no cloudclaim untilreadback.

#### 6. B — Открыть разрешённую NoteN1 по старойссылке и одновременно редактировать с A.

**Control:** `COL-06.editor` («Текст заметки»). **UI owner:** WP-16; **mechanisms:** WP-05, WP-10, WP-16, WP-51.

- **Input**: samelegacyalias→NoteN1,sharedCRDTbinding,peerB
- **Ожидаемый экран**: SameNotes surface/body, sharedpresence/syncreceipt; nativeMarkdowneditorfeaturespreservedtochosenbindingconformance.
- **Данные**: CanonicalN1 preserved; onecollaborativebody, localfileupdates onlyfrommaterialization.
- **Receipt**: SharedappendACK separatefileprojectionwatermark; sourcehash preservedinmigrationreceipt.
- **Focus / hover / help**: Editorfocus/contentselectionstable; help badge «Совместная» clarifies file freshnessmaylagserver.
- **RU microcopy**: Сохранено на сервере · Файл обновляется
- **Recovery**: Projectionfailure showsfilelag/retry withoutblockingCRDTauthority; filewatcher cannotfeedprojectionbackasnewedit.
- **Negative assertion**: Seedfilewatcherloop producesno duplicatetext; manualfilechangeaftercutover cannotreplaceCRDTsilently.

#### 7. B — Обсудить выбранный фрагмент Note и reload bothroutes.

**Control:** `COL-11.new-thread` («Новое обсуждение»). **UI owner:** WP-15; **mechanisms:** WP-07, WP-08, WP-09, WP-15, WP-16.

- **Input**: parentNoteN1,sourceRevision/anchormetadata,bodymanual
- **Ожидаемый экран**: Contextualdiscussionthread anchoredtoNote; reloadanchorresolvedor«Место изменилось» fallback, nothiddenloss.
- **Данные**: CommonMessageparentNoteN1; no perNotecommentengine newtable; legacyMarkdowncomments explicitmigrationprovenance.
- **Receipt**: Canonicalmessage.create receipt+anchorversion; notificationssameoutbox.
- **Focus / hover / help**: Enternewline/CmdCtrlEntersend forentityDiscussion; Escape returnstoeditorselection; focushelp explains anchorrevision.
- **RU microcopy**: Место изменилось. Открыть исходный контекст.
- **Recovery**: Unsupportedlegacycommentanchor shownsafeunanchoredthread withoriginalrevision; no guessedcurrentselection.
- **Negative assertion**: Task/CRM wrapper sameMessageauthority; mentioning outsiderdoesnotgrantNote.

### Identity / files / closure

Source refs: R02, R08, R09, R10, R21, R24. Allocated component/test paths are read-only references to current leaf + manifest; no second component proposed.

| Role | Exact paths |
|---|---|
| Existing source | apps/electron/src/renderer/pages/NotesPage.tsx<br>apps/electron/src/renderer/pages/notes/NotesViewHost.tsx<br>apps/electron/src/shared/routes.ts<br>packages/core/src/rox2/platform-contract.ts<br>packages/server-core/src/handlers/rpc/notes.ts |
| Allocated planned change | apps/electron/src/renderer/components/app-shell/nav-destinations.ts<br>apps/electron/src/renderer/components/messaging/MessageComposer.tsx<br>apps/electron/src/renderer/components/messaging/MessageTimeline.tsx<br>apps/electron/src/renderer/pages/NotesPage.tsx<br>apps/electron/src/renderer/pages/notes/NotesViewHost.tsx<br>apps/electron/src/shared/routes.ts<br>packages/shared/src/workspace-domain/messaging/contracts.ts<br>tests/macro-integration/ui/col-05.spec.ts<br>tests/macro-integration/ui/col-06.spec.ts<br>tests/macro-integration/ui/col-11.spec.ts |

Testable ambiguity resolved:

- Native CAS absentcurrentcode; targetpernote criticalsection.
- Noteidentity preserved; Pagewrapper notsamekind.
- Atomic authority cutover, fileprojection freshness and privateembed checks explicit.

DoD **PLANNED_NOT_RUN**: All authored happy/negative/reload/concurrency steps yield stated screen/data/receipt outcomes; screenshot/ARIA, content hashes, source revisions and real gate receipts required; provider lane only where an external write is actually added. A/B separateauthcontexts, clock/networkfaultcontrols, seededmechanismmutationwithspecificassertion; baselinepass≠infrastructurefailure; nofeaturepassfromwireframe/schema.

## CWT-05 — Task один в списке, доске, detail и Project: конфликт статуса и recurrence

**Entry existing:** tasks/task/T1; projects/project/launch.

**Proposed:** tasks?view=board&project=project%3APJ1; projects/project/launch?tab=context; newview/query parsingplanned.

**Current code limit:** PersonalTask/TaskDetail/recurrence and Project tasks present. Sharedworkflow board/statusCAS,typedProjectgraph and recurrence authority are proposed; personalToday preserved.

**Actors:** A editor, B assignee/editor, V viewer.

**Identity:** List/board/detail/Projectcontext allTaskT1/revision; onlyfuture recurringoccurrences receive newTaskIDs withseriesmembership. PersonalToday is userplacement, never workflowstatus.

```text
Задачи [Мои / Команда] [Проект: Launch] [Список | Доска]      
К выполнению        | В работе             | Готово       
Подготовить КП      |                      |              
(task:T1, Борис)    |                      |              
─────────────────────────────────────────────────────────
Детали: Подготовить КП [Исполнитель] [Статус] [Срок]        
[Повтор: каждые2недели] [Следующие даты] [Исходный контекст]
Проект/Контекст: тот же TaskT1 → MessageM1(можетбытьнедоступен)
```

### Numbered actions and observable results

#### 1. B — Выбрать «Команда», Project Launch, открыть TaskT1 созданный изMessage.

**Control:** `COL-12.scope` («Мои / Команда»). **UI owner:** WP-13; **mechanisms:** WP-03, WP-06, WP-13.

- **Input**: permittedProjectPJ1/taskT1,authorisedfilters
- **Ожидаемый экран**: TaskT1 appearswithsameassignee/body; savedfilters visible; deniedrecordsnotcounted.
- **Данные**: SameTask canonicalcollection usedviews; B personalToday untouched.
- **Receipt**: task.list readquery authorised total/asOf/indexwatermark.
- **Focus / hover / help**: Comboboxkeyboard selection;clickhelp «Мои/Команда» defines assignments vsworkspace scope, authorisedcount.
- **RU microcopy**: Нет задач по выбранным фильтрам
- **Recovery**: ResetfiltersCTA onlyforfilteredempty; backendfailureinlineerror retainsoldresultsmarkedstale.
- **Negative assertion**: Vread-only no QuickEntrywrite; hiddenprivateTask notfacetcount.

#### 2. B — Переключиться «Список → Доска», выбрать ту жеTaskT1.

**Control:** `COL-13.view` («Список / Доска»). **UI owner:** WP-13; **mechanisms:** WP-12, WP-13.

- **Input**: viewboard,ProjectPJ1,selectedTaskT1,filters unchanged
- **Ожидаемый экран**: SamecardT1 anddetailselection; no creationtoast/duplicate, headerProjectsame.
- **Данные**: No secondboardstore; canonicalquery projection/workflowstablekeys.
- **Receipt**: Preference receipt if persisted, noTaskmutation.
- **Focus / hover / help**: Tablistarrows/Enter; focuscard afterswitch; hoverhelp «Колонки — статус команды».
- **RU microcopy**: Колонки — статус команды
- **Recovery**: If workflowmissing showtypedconfiguration/unsupportedstate; neverfabricatekanbanfromToday.
- **Negative assertion**: CanonicalTaskIDset list===board forsamefilters/policy watermark.

#### 3. B+A — B клавиатурой переместить T1 в «В работе» с r5, A concurrently поставить «Готово» с r5.

**Control:** `COL-13.move` («Переместить в статус»). **UI owner:** WP-13; **mechanisms:** WP-03, WP-04, WP-13.

- **Input**: workflowstablekeysin_progress/done configuredfixture; expectedr5
- **Ожидаемый экран**: One winnercommitsr6; loser seesconflictcurrentstatus, pendingcardrollback; no silentlybothsuccess.
- **Данные**: Task statusCAS; currentrevisionrenderedallviews, personalToday placement unchanged.
- **Receipt**: task.status.update successorconflict expectedr5/currentr6 +commandId.
- **Focus / hover / help**: Space card/arrowtarget/Enter commit; Escape cancelsbeforedispatch; conflictfocusdialogandfreshstatus.
- **RU microcopy**: Статус уже изменился
- **Recovery**: Refreshcurrentstate; explicitreapplynewcommand/newexpectedrevision iftransitionpermitted; do notautoforce.
- **Negative assertion**: Seed last-write-wins losesconflictassertion; stalecommand cannotoverridewinner.

#### 4. A — Открыть Taskdetail и Projectoverview после winnerreceipt/reload.

**Control:** `COL-14.status` («Статус»). **UI owner:** WP-13; **mechanisms:** WP-06, WP-12, WP-13.

- **Input**: TaskT1 ref,currentr6
- **Ожидаемый экран**: Status/assignee/titlematchboard; Projectprogresscountfreshnessshown, notoptimistic100%fake.
- **Данные**: SameTaskT1 inProjectrelation, countersauthorisedset/explicitdenominator; projectionswatermarkvisible.
- **Receipt**: task.read metadata revision andProjectqueryasOf; receiptshownonlyactualupdate.
- **Focus / hover / help**: Tabstatusreadablelabel; hoverprogresshelp formula completed/eligibleauthorisedTasks andsource/asOf.
- **RU microcopy**: Данные проекта обновляются
- **Recovery**: LagProjectprojection labelpendingwatermark; retryquerynevercreateanotherTask.
- **Negative assertion**: UIcounts may notinclude deniedTask; statuschange updatesoneT1 notProjectcopy.

#### 5. A — Настроить повтор каждые две недели, понедельник/четверг.

**Control:** `COL-16.rule` («Повторять»). **UI owner:** WP-14; **mechanisms:** WP-14.

- **Input**: interval2,weekly,weekdaysMon/Thu,seriesS1,expectedseriesrevision
- **Ожидаемый экран**: Rulevalidated; previewnotcommitted; Tasks currentitem unchanged.
- **Данные**: SeriesRule referencesT1/currentoccurrence; no newTasks duringpreview.
- **Receipt**: Readpreview only; no occurrencecreated.
- **Focus / hover / help**: Arrowcombobox and weekdaybuttons; clickhelp «Повтор» explainsnewoccurrenceID vscurrentTask.
- **RU microcopy**: Каждые 2 недели · Пн, Чт
- **Recovery**: interval0/weekdayinvalid inlinefieldvalidationfocus, manualdraftpreserved.
- **Negative assertion**: Preview cannotcreateextraTaskT2/notifications.

#### 6. A — Выбрать «По расписанию», затем timezone Europe/Moscow и сравнить «После выполнения».

**Control:** `COL-16.mode` («По расписанию / После выполнения»). **UI owner:** WP-14; **mechanisms:** WP-05, WP-14.

- **Input**: fixedvsafter,timezoneEurope/Moscow; lastcompletioncontrolled2026-10-01
- **Ожидаемый экран**: PreviewshowsIANAzone+localdates/UTCsource, explicitmodeexplanation; no shiftpersonalToday unexpectedly.
- **Данные**: Fixedbasedseriesplan; afterbasedcompletion; calendarallDay≠instant.
- **Receipt**: PreviewquerysourceRuleRevision/clockfixture; no save.
- **Focus / hover / help**: Tabmodearrowselection; samehelpviafocus/click «От какой даты считается повтор».
- **RU microcopy**: После выполнения: от даты завершения
- **Recovery**: Ambiguous/gapzone input explicitDSTchoice/errorswherezoneobservesDST; Europe/MoscowfixturesnotprovingDSTcoverage.
- **Negative assertion**: Modechange cannotoverwritepastoccurrences/immutablecompletionhistory.

#### 7. A — Сохранить повтор, затем B и A одновременно завершить одну occurrenceT1.

**Control:** `COL-16.save` («Сохранить повтор»). **UI owner:** WP-14; **mechanisms:** WP-04, WP-13, WP-14, WP-37.

- **Input**: seriesS1revision,stablecommandscompA/compB,taskT1occurrencekey
- **Ожидаемый экран**: Rule receipt; onecompletion andonenextoccurrence; no duplicate«Следующая задача».
- **Данные**: Unique(series,occurrencekey), nextTaskT2distinctidentitylinkedS1/PJ1; T1historicTaskretained.
- **Receipt**: task.recurrence.update thencompletionreceipt containingnextOccurrenceRef; duplicatecompletionreconcilesexisting.
- **Focus / hover / help**: Savefocusreturnrepeatbadge; completionariaannounceonce; newoccurrencecreationnotcheckboxUIassumption.
- **RU microcopy**: Повтор сохранён
- **Recovery**: Scheduler/notificationfailure pendingstage retry byoccurrencekey; currentcompletionnotrolledbackduetodeliverylag.
- **Negative assertion**: Seeduniqueconstraintremove→assertnextoccurrencecount1catchesduplicate.

#### 8. B — Из Project→Контекст открыть T1 backlinkM1 и собрать authorised contextmanifest дляagent.

**Control:** `COL-18.source` («Источник контекста»). **UI owner:** WP-38; **mechanisms:** WP-03, WP-06, WP-09, WP-36, WP-38.

- **Input**: ProjectPJ1→TaskT1→sourceM1; B hasnoM1read
- **Ожидаемый экран**: Taskvalid; source «Недоступно» no title/body; manifest omitsprotectedpayload whilepreservingpermittededgeprovenance.
- **Данные**: Context graph sourceRef stable; noN×Nreadbypass, sourcepolicycheckedatexecutionagain.
- **Receipt**: ManifestasOf/sourceRevision/permittedrefs; agentrun/answer verificationseparate.
- **Focus / hover / help**: Enter sourcechipneutral; «Источник контекста» help freshness/citation. Scopecheckboxreadableexcludedreason.
- **RU microcopy**: Источник недоступен
- **Recovery**: After policychanges rebuildmanifest; existingagentsessioncannotuseoldcachedM1body.
- **Negative assertion**: Askagentaccount/project containsmanualTaskfacts, neverPRIVATE-MSG-73; ProjectmembershipnotM1grant.

### Identity / files / closure

Source refs: R03, R11, R12, R13, R14, R16, R17, R21. Allocated component/test paths are read-only references to current leaf + manifest; no second component proposed.

| Role | Exact paths |
|---|---|
| Existing source | apps/electron/src/renderer/pages/ProjectInfoPage.tsx<br>apps/electron/src/renderer/pages/TasksPage.tsx<br>apps/electron/src/renderer/pages/tasks/TaskDetail.tsx<br>apps/electron/src/shared/routes.ts<br>packages/core/src/rox2/platform-contract.ts<br>packages/core/src/tasks/personal/types.ts<br>packages/shared/src/projects/types.ts |
| Allocated planned change | apps/electron/src/renderer/pages/ProjectInfoPage.tsx<br>apps/electron/src/renderer/pages/TasksPage.tsx<br>apps/electron/src/renderer/pages/tasks/QuickEntry.tsx<br>apps/electron/src/renderer/pages/tasks/TaskBoard.tsx<br>apps/electron/src/renderer/pages/tasks/TaskDetail.tsx<br>apps/electron/src/shared/routes.ts<br>tests/macro-integration/ui/col-12.spec.ts<br>tests/macro-integration/ui/col-13.spec.ts<br>tests/macro-integration/ui/col-14.spec.ts<br>tests/macro-integration/ui/col-16.spec.ts<br>tests/macro-integration/ui/col-17.spec.ts<br>tests/macro-integration/ui/col-18.spec.ts |

Testable ambiguity resolved:

- SamecanonicalTaskqueriesforviews.
- BoardCAS vsCRDT andpersonalToday distinct.
- Recurrence newoccurrenceidentity/denominator/projectionfreshness explicit.

DoD **PLANNED_NOT_RUN**: All authored happy/negative/reload/concurrency steps yield stated screen/data/receipt outcomes; screenshot/ARIA, content hashes, source revisions and real gate receipts required; provider lane only where an external write is actually added. A/B separateauthcontexts, clock/networkfaultcontrols, seededmechanismmutationwithspecificassertion; baselinepass≠infrastructurefailure; nofeaturepassfromwireframe/schema.

## Immutable evidence

| ID | Repository / SHA / path / symbol / lines | Code claim |
|---|---|---|
| R01 | [apps/electron/src/renderer/components/app-shell/nav-destinations.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/app-shell/nav-destinations.ts#L87-L181)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>APP_NAV_DESTINATIONS 87–181 | Native Projects/Pages/Tasks/Notes/Sessions exist; human Channels absent in inspected registry. |
| R02 | [apps/electron/src/shared/routes.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/shared/routes.ts#L33-L37)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>buildNotesRoute 33–37 | Existing notes/note/{encoded noteId}. |
| R03 | [apps/electron/src/shared/routes.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/shared/routes.ts#L170-L224)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>routes.view.tasks/projects/pages 170–224 | Existing tasks/task/{id}, projects/project/{slug}, pages/page/{slug} typed routes. |
| R04 | [apps/electron/src/renderer/contexts/NavigationContext.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/contexts/NavigationContext.tsx#L838-L898)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>NavigationProvider/navigate 838–898 | Typed navigation focused-panel updates/newPanel is existing extension point. |
| R06 | [packages/core/src/types/page.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/types/page.ts#L294-L320)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>PageConfig 294–320 | Artifact runtime kind, digest, action grants, refresh, publication and projectId remain; new contentKind is proposed. |
| R08 | [apps/electron/src/renderer/pages/NotesPage.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/NotesPage.tsx#L871-L924)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>NotesPage/saveCurrentNote 871–924 | Native Notes serial save queue/debounced autosave; not shared CRDT authority. |
| R09 | [apps/electron/src/renderer/pages/NotesPage.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/NotesPage.tsx#L2292-L2308)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>TiptapMarkdownEditor 2292–2308 | Existing Tiptap Markdown editor, wiki/tag callbacks, legacy engine, max70ch. |
| R10 | [apps/electron/src/renderer/pages/notes/NotesViewHost.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/notes/NotesViewHost.tsx#L58-L113)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>NotesViewHost 58–113 | Existing table/canvas/outline/graph representation dispatcher. |
| R11 | [apps/electron/src/renderer/pages/TasksPage.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/TasksPage.tsx#L149-L186)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>TasksPage/selectTask 149–186 | Existing personal task screen state/detail routing. |
| R12 | [packages/core/src/tasks/personal/types.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/tasks/personal/types.ts#L8-L92)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>PersonalTask/Recurrence/TaskProject 8–92 | Personal placement/checklist/source/links/reminder/fixed-after recurrence; TaskProject distinct ProjectConfig. |
| R13 | [apps/electron/src/renderer/pages/tasks/TaskDetail.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/tasks/TaskDetail.tsx#L151-L232)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>TaskDetail 151–232 | Title/notes/details-links-history/restorable trash exist. |
| R14 | [apps/electron/src/renderer/pages/tasks/TaskDetail.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/tasks/TaskDetail.tsx#L376-L442)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>TaskDetail recurrence controls 376–442 | Interval/weekdays/fixed-after controls exist. |
| R15 | [apps/electron/src/renderer/pages/tasks/QuickEntry.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/tasks/QuickEntry.tsx#L18-L115)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>QuickEntry/submit 18–115 | Natural language parser/preview chips/Enter/Cmd+Enter create. |
| R16 | [apps/electron/src/renderer/pages/ProjectInfoPage.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/ProjectInfoPage.tsx#L133-L204)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>ProjectInfoPage/tasksForWorkspaceProject/handleStartSession/handleSaveSettings 133–204 | Project related agent sessions/personal tasks/task creation/cwd-details settings exist. |
| R17 | [packages/shared/src/projects/types.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/shared/src/projects/types.ts#L35-L58)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>ProjectConfig 35–58 | Stable id/slug/details/cwd/archivedAt/kanbanColumns existing entity. |
| R19 | [apps/electron/src/renderer/pages/ChatPage.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/ChatPage.tsx#L89-L172)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>ChatPage/useSessionData 89–172 | Session ID keyed agent transcript/options; not human conversation. |
| R20 | [apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx#L9-L45)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>SessionPresenceAvatars 9–45 | listBroPresence query per sessionId change; no live document cursor subscription. |
| R21 | [packages/core/src/rox2/platform-contract.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L240)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>Rox2EntityRef 233–240 | Canonical workspaceId/entityId/revisionId/accountNamespace already exists. |
| R22 | [packages/core/src/rox2/platform-contract.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L17-L40)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>ROX2_ENTITY_KINDS 17–40 | Existing note/task/project/page/channel/channel-message/session kinds; thread/comment representation aliases planned, no parallel identity. |
| C03 | [packages/collaboration/src/collab/engine.ts](https://github.com/macro-inc/macro/blob/c966b79d40798c6c726a3b15fe90517941fc6e61/packages/collaboration/src/collab/engine.ts#L275-L465)<br>macro-inc/macro@c966b79d40798c6c726a3b15fe90517941fc6e61<br>handleLocalUpdates / persistSnapshot / handleSourceEvent / convergeFromServer 275–465 | WAL append, five-second snapshot cycle, pending-causal recovery and reconnect anti-entropy. |
| C20 | [crates/messages/src/domain/models.rs](https://github.com/macro-inc/macro/blob/c966b79d40798c6c726a3b15fe90517941fc6e61/crates/messages/src/domain/models.rs#L38-L159)<br>macro-inc/macro@c966b79d40798c6c726a3b15fe90517941fc6e61<br>MessageParent / ThreadAnchor 38–159 | Messages share channel, document, initiative and CRM parents plus Markdown/PDF/spreadsheet anchors. |
| C21 | [crates/messages/src/domain/models.rs](https://github.com/macro-inc/macro/blob/c966b79d40798c6c726a3b15fe90517941fc6e61/crates/messages/src/domain/models.rs#L362-L432)<br>macro-inc/macro@c966b79d40798c6c726a3b15fe90517941fc6e61<br>SimpleMention / Message / root_id 362–432 | Shared message has sender, bot profile, mentions, timestamps, tombstone, attachments and reactions. |
| R24 | [packages/server-core/src/handlers/rpc/notes.ts](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/server-core/src/handlers/rpc/notes.ts#L502-L517)<br>rox-one/rox-one@e780e73ae84c977cf81546b49140d318dfcd6049<br>saveNote 502–517 | Optional expectedRevision uses readFile/contentHash check then mkdir/writeFile/stat; no per-note lock/atomic CAS here. NotesPage:885 native call omits revision; single UI save queue is not global lost-update protection. |

## Actual artifact checks

5 walkthroughs; 39 numbered actions; 16 unique existing COL screens; 23 pinned source ranges. IDs/controls/current UI owners/manifest WP/path ownership/pinned source bounds checked programmatically; **PASS_REFERENCES_ONLY**. No browser/native/cloud feature scenarios executed. A schema or source-reference pass does not satisfy runtime DoD.

Reference validator sensitivity: three in-memory seeded mutations — unknown control, wrong current UI owner, unallocated component path — rejected by specific assertions. Runtime tests remain NOT_RUN. The JSON operation field is descriptive intent; dispatcher/schema source of truth remains canonical primary + supplement, no implicit new API.
