# Rox / Conation / RMA / Golden Gate — требования и границы программы

## Цель и статус

Создать один безопасный, проверяемый путь от восстановления источников к фактическому аудиту, исполнению атомарных требований и независимой приёмке всей программы. Конечный пользовательский результат — не «зелёная сборка», а согласованные Rox/Conation сценарии с доказанной работой на требуемой платформе, целостными данными, разрешённым доступом и точными статусами каждого обязательного acceptance-пункта.

**Статус:** реализация существующей программы из 109 задач разрешена и выполняется параллельно по DAG и неизменным границам владения; полная продуктовая приёмка НЕ ЗАВЕРШЕНА. Документы и source maps не являются доказательством приёмки. Текущий baseline build/native launch, discovery-only source map, pending AUDIT-01/DATA-01/SHARED-01 acceptance и lease bounds: [recon-evidence.json](recon-evidence.json), [shared-contract-freeze.json](shared-contract-freeze.json).

## Пользователи и ценность

- Один пользователь Rox: получает актуальную навигацию, доступные/локальные AI-сессии, понятное состояние ресурсов и сохраняемые проекты/заметки/задачи/встречи.
- Пользователь Conation и команда: загружают реальные авторизованные сущности, используют рабочие CRUD, поиск, фильтры, совместные действия и устойчивое состояние в web и установленном desktop.
- Оператор релиза: может связать каждый требуемый сценарий с исходным требованием, существующим issue или новым atomic issue, версией, платформой, ожидаемым/наблюдаемым результатом и артефактом; явно видит блокировки и не выдаёт обход за приёмку.

## Объём и непресекаемые ограничения

Охват — подтверждённые U01–U31 (30 групп; U25 отдельно как недоказанное решение), детальный исходный Conation seq703 checklist из 16 строк, именованные домены ниже, существующие задачи RMA/Golden Gate, платформенные условия, доставка и полная acceptance matrix. Один исходный пункт может иметь несколько независимо принимаемых результатов. Shared implementation может покрыть несколько требований, но не удаляет индивидуальные критерии.

Не входят: переисполнение всего backlog в рамках создания этого handoff; публичная публикация данного пакета/issue без интегратора; облачное provisioning; изменение production DNS/MX; расширение scope на system audio, Zoom/Meet, Zed importer, Liquid Glass, bot-added features; автоматический перенос/переписывание всего Conation; выводы о работе runtime без фактического аудита. U25 не даёт полномочий менять defaults.

## Источники, provenance и доказательность

Основной retained source: conversation `4ef662cc-b28f-4b7d-9d68-16f4e587da18`, seq1–1384; экспорт насчитывает 79 human prompts и 22 widget records; U01–U31 в `unfinished-tasks.md` являются группами, не полным набором функциональных требований. Использовать только source refs `Uxx`, `seqNNN`, `existing:#NNN`, `latest-user:DOMAIN`. Raw private conversation, binary attachments, tool traces, приватные пути и пользовательские данные не копировать в публичные issue. Неустановленные binaries/снимки/аккаунты нельзя додумывать. Просьба пользователя ≠ доказательство реализации; bot report ≠ независимая проверка; merge ≠ end-to-end acceptance; local mail ≠ external delivery; health 200/unauthenticated 401 ≠ authenticated data flow.

Классифицировать каждый атомарный issue: `requested` (явное требование), `verification-gap` (требование есть, реализация/статус не доказан), `proposal-audit` (предложение улучшения, не разрешение реализации), `decision-reconciliation` (неразрешённая авторизация/противоречие). Текущая code inspection и настоящие screen interactions должны обновить status перед issue publication.

## As-is → target

**Исторический as-is:** длинная переписка содержит обещания, сообщения о готовности, явные незакрытые пункты и провалившиеся stream. Есть сообщённые merges/фиксированные экраны, но audit само по себе подчёркивает отсутствие повторной проверки продукта. Для Conation часть P0 и auth/OTP/rail/локализации заявлялась доставленной; подробные панели и остальные 16 checklist items не получили полного acceptance. RMA #385 E3 был BLOCKED, #991 harness merged не доказывает продуктовый E3; #387 held. GG #556/#557/#558 были припаркованы; #541/#578 имели суженный smoke и неполное доказательство. RMA #356/#333 закрыты issue, но остаются отмеченные acceptance-требования; #389 теперь установлен как P2 media SFU, rooms, screenshare, reconnect и signed bots.

**Текущее доказательство:** источники/issue и исследовательские заметки установлены, однако этот пакет не выполнил реальный аудит всех экранов и не проверил среды. Rox main содержит некоторые поздние branding/onboarding claims. Macro integration пакет уже существует как `PREPARED_NOT_LAUNCHED`, включает 52 work packages / 61 экран / 219 controls и должен быть связан/reused; не создавать второй параллельный план. У прав Macro: корень AGPL, web права зарезервированы — только reuse с явным юридическим основанием и provenance.

**Цель:** каждое требование имеет первоисточник и классификацию, идентифицированного владельца, bounded file ownership, интерфейс, зависимости, наблюдаемый критерий, положительный и отрицательный путь и доказательство. Доступное реальное поведение исправлено, сохранено и доставлено в согласованную ветку без посторонних пользовательских изменений. Не-доступный hardware/provider/cloud path остаётся отдельно BLOCKED до точной предпосылки.

## Функциональные домены / полный U-coverage

| U / группа | Требуемый результат (развернуть в atomic acceptance, сверить актуальный runtime) |
|---|---|
| U01 | Весь Rox: карта экранов/кнопок/данных/переходов; на каждый экран 2–3 обоснованных улучшения как отдельные `proposal-audit`; регистрировать подтверждённые дефекты отдельно. Включить Notes, Tasks, Memory, Home widgets, Feed, Connections, Dossier/Radar/Decisions, весь Settings matrix (22 страницы), keyboard board/table semantics и экранные состояния. Проверить Memory source→usage, pin/disable, duplicate handling, context budget, backup-before-lessons-rewrite, archive/overflow. Для Tasks проверить весь Things3-style набор views, deadlines, natural-language input и reminders/persistence. |
| U02 | Локальный постоянный Stalwart `@rox.one`, mailbox provisioning, JMAP/Keychain, list/read/reply/send/realtime, loopback и startup; отдельная внешняя delivery-приёмка только с фактической внешней доставкой и DNS/reachability prerequisites; согласовать пересечение с #380 без изменения production MX автоматически. |
| U03 | Определить по коду/config реальную session voice STT model/engine и место исполнения; это не meeting Whisper. |
| U04 | Русский edge-tts playback/stop внутри Rox и системный voice fallback при отключённой сети. |
| U05 | После транскрипции встречи получать summary/decisions/tasks/open questions; diarization и переименование спикера, source timestamps/audio navigation; сохранять/интегрировать и восстанавливать после перезапуска. Recorder не переписывать без подтверждённой причины. |
| U06–08 | Актуальная top navigation всех экранов с overflow/scroll, отдельный icon Home, компактный sidebar и Inter; последний оригинальный прозрачный `rox copy.png` в согласованных поверхностях (приложение/header/workspace/splash/onboarding/About) с alpha/размерами/cache проверкой; name-only onboarding, Rox defaults, connections в Settings, причина повторного onboarding. Аудировать уже существующие main changes. |
| U09 | Проект/roadmap: goal/outcome, input/source/files/notes, milestones/stages, functional/technical/quantitative/qualitative requirements/tasks; AI из реальных материалов строит сохраняемую спецификацию и decomposition связанной с Projects/Tasks/Notes; заменить неподходящий right inspector. |
| U10 | Работающие channels/chats для людей/bots/agents, команда и Rox branding, не статический экран; выбор интеграции только после сравнения и прав. |
| U11 | Mac mini/pet mode при сворачивании: capsule/icons, chat title, live action/status, send/stop/note/voice/expand, синхронность с основной сессией. |
| U12 | Settings consistency; extensions catalog: search/filter/tags/groups/sort; убрать только видимую resize-hover line, сохранив drag-resize. |
| U13 | Entertainment Quest: реальные quests/progress/rewards/streaks и persisted activity, не demo XP. |
| U14, U18 | Team и организация: real members, roles, presence, personal spend/balances, shared memory/projects; comments на chat messages/map nodes, note mentions, shared skills/automation/memory, recipient Inbox, permissions, handoff/review/team activity, employee spend. Настоящий sync backend обязателен; локальная очередь и текст о будущей зависимости не закрывают результат. |
| U15 | Flexoki Dark, Snazzy, Snazzy Blurred на Rox tokens; blur/contrast; code/terminal palette, preview/select/persist; screenshots реального интерфейса. Zed importer исключён. |
| U16 | Graph note/draft connected context идёт в обычный session run, объяснимо выбран и показан; positive/negative control. Не открывать заново сообщённые node create/resize/link validation/inspector без текущего дефекта. |
| U17 | Slack implementation; реальные подключения Telegram/Discord/Lark/WeChat/WhatsApp и account actions, auto-import/permitted cookie reads, consent. Отсутствие local-source/consent — prerequisite, не доказательство поломки. |
| U19 | Agent Center budget enforcement в реальном foreground/background execution; чёткая граница, предотвращение следующего шага до лимита и отказ/остаток корректны, не только предупреждение UI. |
| U20 | Focus действительно suppresses/queues предусмотренные worker questions/notifications до конца интервала, затем доставляет в исходном порядке; column clipping уже отдельно заявлялся исправленным. |
| U21 | Automation: applicable continuation существующей сессии, webhook edit+persist; сохранить заявленные CRUD/manual-run. |
| U22 | Rox cloud connection/status/balance handler загружен/связан с фактическим runtime; проверить happy/failure state; Daytona execution отдельно требует key и отдельной проверки. |
| U23 | Проверить текущую применимость panel corners/spacings, удалить устаревший «ЕЩЁ» только если присутствует; source wording, duplicate task status, settings headings/translation. Старое исправление не переносить без проверки. |
| U24 | Windows persistence atomic replace/durability: write/rename/crash/failure без повреждения, recovery тесты в Windows native. POSIX не является доказательством Windows. |
| U25 | Не issue на изменение default. Decision reconciliation: `widgetSkipped` и `respondedValue` seq458 конфликтуют, позднее ack seq654, seq660 skipped; сохранить FALSE/shortcut-only, пока не появится независимое надёжное авторизованное основание. |
| U26 | Conation полный 16-строчный исходный seq703 checklist ниже, плюс более поздние промпты/issue. Не закрывать объединённым smoke, не терять отдельные observable acceptance строки. |
| U27 | RMA #385 настоящий E3 product path; #991 merge и BLOCKED U1 harness не являются E3. Сохранить status RMA #356/#333 CLOSED как issue и отдельно зафиксировать их открытые acceptance, не «поднимать» закрытые issue автоматически. |
| U28 | RMA #387 packaged delivery/upgrade/web/i18n/a11y только после подтверждённого prerequisite #385; hold не снимать от факта merge. |
| U29 | Conation Mail #380, CRM #381, Calendar #382 после подтверждённых prerequisites; P2 #389: собственные комнаты/дополнительные ingress с настоящими media sessions и meeting bots; выбрать SFU/media provider отдельным решением с проверкой лицензии/deployment/cost, не писать собственные codecs/SFU; real room join/guest ACL/tracks/screenshare/reconnect/agent participant с явным recording consent; использовать Meeting/source/segment model и проверять server-side ACL. Пересечения с U02 не подменяют issue-specific acceptance. |
| U30 | Golden Gate #556/#557/#558 конкретные shell-grid/device/spatial сценарии, не map-toolbar. |
| U31 | Golden Gate #541/#578 full original acceptance matrix, performance/packaging/evidence без сужения; #541 имеет 25 children (#553, #555–#578). Установить почему в материалах 10 vs 12 locales и согласовать authoritative expected matrix, не выбирать меньшее число ради green результата. |

### U26 seq703: 16 обязательных строк — атомарно принять каждую

Эти 16 строк являются полной декомпозицией, ни одна не может быть свёрнута в «экран работает». На каждую нужны fixture/precondition, успешный путь, отрицательный/ошибочный путь, persisted/reopen, exact expected/observed и evidence:

1. **Auth populated data:** authenticated JWT endpoint 200/usable bearer и реальные rows в Inbox, Drive, Mail, Chat, Tasks, Agents, CRM; health 200/anonymous 401 недостаточно.
2. **Branch/build delivery:** устранить несогласованность Cargo.lock/wasm-pack/Vite proxy, проверить JWT/header rebrand contract, решить судьбу local commit `1a88100ff8` без слепого push и без повторного изменения.
3. **Login/onboarding:** skip сохраняет tutorial complete; post-OTP navigation/cookie+storage persistence; generated OpenAPI rebrand; invite и offer500 раздельны; signup, expired OTP, resend, clipboard/keyboard, network failure.
4. **E2E:** исправить ten xtask compile errors; недеструктивные seed данные; auth/OTP, Home/dashboard/calendar/CRM/reminders/settings/go-to, оба sidebar selector variants.
5. **Tauri/Mac:** доступный toolchain, desktop build/launch, те же screen acceptance что browser; cookie jar, HMR/WS, `conation://`.
6. **Dashboard composition:** empty CTA; row/column/gap DnD; 20 preset previews; personal/team/revert; save/error states; real entity pickers; list/markdown/timeline/channel-message/calendar/pins/KPI/activity inspectors; container tree; top-N/pinned/unread/due-today/agent-run/CRM-follow-up views; persist/hydrate/preview.
7. **Inbox:** live Signal/Noise, unread, bulk/swipe/retry/search/active-filter badge, desktop mounting, density/timestamps/detail opening.
8. **Drive:** coherent empty/error/localization, files/folders/tags, upload/mobile upload, rename/move/row menu/recent/shared/search/preview.
9. **Mail:** locale consistency, reply vs reply-all, compose/address/hover, schedule clear, threads/forward/drafts/attachments/signature/undo-send and Signal/Noise with real mail.
10. **Chat:** one load-error state, channel/DM lists, locale, unread/send/mentions/scroll/threads/reactions/search.
11. **Tasks:** badge/row-count invariant, header/error layout, filter persistence, create/status/assignee/due/sort.
12. **Agents:** retries/locale, Home-consistent composer model, reduced-motion wave, sessions/roster/stop/send/stream/tools/new-chat/switch.
13. **Notes/documents/canvas:** independent Notes, mentions/share/ask, editor/preview/find; canvas labeled real toolbar actions, pointer/pan, typo, media accessibility/mobile upload, retry/empty, explicit Comment/Crop decision, drawing/pinch/fit/floating menu/video touch.
14. **Other screens:** Home target/focus/examples/composer; Calendar locale/today/create/move/timezone; CRM validation/delete/model/team; all 22 Settings pages/sections/toggles/team creation; Search route/go-to; payments mounted or removed with permissions/errors; reminders persistence/repeat/timezone; calls/activity/sharing/mobile touch/spreadsheet/PDF/split-view.
15. **Global motion and typography:** nonzero transitions, coherent easing/press/hover/link/rail, reduced-motion behavior, shortcut hints and tooltip dismissal, retain hit targets after text-size reduction.
16. **Operational dependencies:** SQS `QueueDoesNotExist`, absent otel-collector, Lexical down are observed prerequisites to verify against live environment, not permission to provision new infrastructure by inference.

## Обязательный аудит каждого экрана

U01 начинается с route/screen registry из текущего исходника + фактическая навигация: учитывать все 22 Settings pages, модальные и вложенные рабочие поверхности, а не только список главных экранов. На каждой поверхности документировать: цель/роль, route, переходы/links; все кнопки, меню, search/filter/sort/editor; entity ID и owner/tenant; загрузка/пусто/ошибка/повтор/busy/permission/saved; клавиатура/focus/hover/hit target; mobile/narrow window/reduced motion; persist/reopen; связь данных с другими экранами. Проверить отдельно Notes, Tasks, Memory, 5 groups of Home widget choices (20 individual choices where relevant), Feed subscription list/sort/filter/day grouping, Connections, account/cookies/imports. Каждому экрану присвоить ровно 2–3 обоснованные improvement proposals `proposal-audit`, явно отделённые от bugs. Только воспроизводимый defect становится исправлением. Macro program inventory (52 workpackages/61 screens/219 controls) — reuse как исходный coverage map после прав/licensing check, а не замена текущему Rox screen audit.

## Общие данные и интерфейсы

RECON-01 до domain assignment должен определить текущую source of truth и стабильные identity/authorization для User/Workspace/Team/Session/Message/Project/Task/Note/Memory/Meeting/Transcript/Automation/Account/Connection/Provider/Drive file/Mail thread/Calendar event/CRM entity/Payment/Notification/Widget/Quest. Нельзя выдавать желаемую схему за существующую. Зафиксировать lifecycle create/read/update/delete, ownership/scope, tombstone/retry/idempotency, offline/out-of-order, migration/backup/recovery, actor+permission и прослеживаемость в UI.

AUDIT-01 записывает существующие route→service/store→persistence/data-source реальные стыки и evidence. Смена данных между поверхностями обязана проверять один stable ID и одинаковую роль/tenant; синхронные/local features не притворяются server collaboration. Shared contract owner после recon один; остальные ссылаются на принятый интерфейс.

## Non-functional, privacy, правовые и релизные требования

- Отдельные слоты приёмки: Linux/cloud (существующая авторизованная целевая среда), macOS native, Windows native и фактически поддерживаемый native iOS target/device/runner Conation Sharing. На iOS нужны существующий share action, controlled receiver с exact payload и same-object/revision return/deep-link, cancel/revoke/stale/denied controls; отсутствие target/runner — точный BLOCKED prerequisite с owner/next step, не browser/Mac PASS и не новая mobile architecture. Cloud provision требует отдельного разрешённого доступа, не является обещанием.
- Изолировать streams в worktree только если независимы по source/files; снять исходный `git status`, сохранить baseline dirty overlay, накладывать только собственную дельту и вернуть/сравнить baseline после интеграции. Никакого reset/clean/checkout-over-user-work. Lockfile и общие registry/RPC/localization/catalog/UI primitives имеют singleton owner.
- Внешние mail/AI/provider/cloud проверки использовать только при согласованном доступе; не логировать секреты/токены, не посылать реальные письма неавторизованным адресатам; не читать cookies без разрешения и scope. Отказ доступа = явный blocker.
- Conation reuse требует одобрения лицензии и происхождения: Macro root AGPL; web portion rights reserved; не копировать как будто permissive.
- WCAG/keyboard/focus/reduced-motion, контраст, локали, tooltip, доступность media, touch targets учитываются в реалистичных native/web surface tests.
- Релизный DoD включает exact build/version/hash, OS/runner, provider/key state без раскрытия секрета, fixture, шаги, expected/observed, logs/screenshot/traces безопасно очищенные, issue/commit/PR delivery. PASS только для exact criterion; absent environment — BLOCKED, не PASS.

## Приоритет и completion

Сначала recon, затем фактическая screen/source audit и решение неизвестных контрактов. Далее один владелец interfaces/schema/registry/locale/lockfile/common UI формирует совместимые seams. Только после этого независимые потоки; integrations serially around shared surfaces. Реальная acceptance завершается по issue-level matrix, не по этапу или общему smoke.

Предложенные improvements на экранах — backlog proposals после аудита, не автоматическое разрешение разработки. Дополнительные открытые решения (например authority для U25 или incompatible cloud architecture) записываются с источником/стоимостью ошибки; независимые проверяемые задачи продолжаются.

## Дополнение: OKR и ежедневный агент каждого проекта

Текущий пользователь явно добавил проектные Objectives, несколько Key Results на цель, веса и ежедневное отслеживание агентом с уведомлениями. Отдельная карта — [requirements-addendum.json](requirements-addendum.json), пять новых строк сверх 484 исторических. `OKR-01` владеет проектной моделью, взвешенным расчётом, редактором, периодами и справкой/примерами; `OKR-02` потребляет этот контракт и существующие runtime/scheduler/Activity/Focus seams. Обе задачи — `requested`, не inherited proposals.

UI использует компактные иерархические карточки O/KR, редактируемые веса, текущую метрику/target/unit, источник и свежесть, понятные draft/published/saved/error/conflict состояния. Руководство объясняет измеримые результаты, нормализованные доли и формулы; примеры — русские и не копируют личный контент референсов. Цели и результаты принадлежат stable project/cycle IDs и настоящим ACL.

Весовая конвенция: конечные неотрицательные веса с положительной суммой отдельно на уровне KR и Objectives; нормализованное среднее. Числовой KR: `clamp((current-baseline)/(target-baseline),0,1)` с проверкой направления и ненулевого denominator; binary KR — доказанный 0/1. Значение unknown при положительном весе не исключается из знаменателя и не становится 100%: показать известный вклад/coverage и неизвестный общий итог. Пример: 100%/50% при 75/25 → 87.5%; 87.5%/50% при 60/40 → 72.5%.

Ежедневный мониторинг включается на проекте с local time/timezone, реальными источниками и выбранным разрешённым каналом. Durable worker сохраняет один check-in на project/cycle/localdate, фактические изменения и evidence links; не меняет targets/weights/цели без принятия пользователем. Нет данных/отказ/устаревший источник/ошибка показываются честно. Уведомления учитывают Focus/quiet hours, permission revocation, паузу/остановку и restart/dedup; очередь или запись напоминания не доказывает реальную работу либо доставку. Acceptance требует наблюдать worker, сохранённый check-in и сообщение у получателя. Подготовка этого пакета ничего не запускает ежедневно.

## Текущий статус программы и границы доказательств

Использовать существующий DAG из 109 задач и 464 рёбер; второй план не создавать. Не менять исходные 484 requirement rows и 5 additive OKR rows, 16 строк Conation seq703, U25 FALSE/decision-only, четыре отдельные платформенные цели (Linux/cloud, macOS native, Windows native, фактически поддерживаемый native iOS target/device/runner) и полный RMA E3 gate. Предложения остаются неавторизующими; права и provenance Macro/Conation сохраняются. Не разрешены этим статусом production cloud provisioning, DNS/MX изменения, неавторизованные внешние отправки, provider writes, обход auth или миграция пользовательских данных.

32 source reports — только discovery. Наблюдаемая карта: Notes RPC producer → workspace filesystem store → shared channel registry → Electron channel-map; Rox2 Notes Map — отдельная структура. Org RPC сохраняет локальный `orgs.json`; account-replica queue in-memory; Conation Soup/DSS ingest read-only. Это не доказывает entity-level authorization, durable remote sync или два принятых live consumers.

AUDIT-01 остаётся NOT_RUN как полный live UI audit: необходимы reconciled route/settings/overlay registry, действия каждого экрана и состояний, persistence/reopen, точные expected/observed результаты и 2–3 отдельно помеченных proposal для каждой поверхности. DATA-01 (#1212) и SHARED-01 (#1160) остаются NOT_RUN: источник/подпись в документе не замораживает контракт. DATA-01 требует реальной durable authorization/idempotency/revision/quarantine/recovery проверки; SHARED-01 ждёт принятого DATA-01 и требует реального producer, двух независимых authorized consumers, stale/denied negative paths и locale resolution.

Фактические baseline наблюдения ограничены: Electron build прошёл на revision `a2a91649a8b7b81e7ce49f59b1d4b7d4ea9a01e2` (build-only); isolated native launch остановился до старта приложения из-за отсутствующих Electron `path.txt`/`dist`; lead видел Rox 0.11.5 на Connections / Policies и legacy MORE label. Ни одно наблюдение не закрывает live UI, data, shared-interface или release acceptance.
