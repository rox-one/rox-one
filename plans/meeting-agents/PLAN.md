# ROX Meeting Agents — Implementation Plan

> **For agentic workers:** применять `superpowers:subagent-driven-development` или `superpowers:executing-plans`, когда эти навыки доступны. Исполнять по одной задаче с проверкой требований и независимым review. Отсутствие навыка не отменяет нижеприведённые RED/GREEN и evidence gates.

**Goal:** поставлять готовую команду агентов и довести разговор до проверенной работы в нативном ROX.
**Architecture:** существующий runtime/identity/RPC плюс Meeting aggregate, версионированный транскрипт, proposals и durable execution. Conation — подтверждённые доменные функции и adapters, не отдельная оболочка.
**Tech Stack:** текущие Bun/TypeScript/Electron/React workspace; версии брать из lockfile. Новые сервисы не вводить без необходимости подтверждённого upstream-контракта.
**Spec:** [SPEC.md](SPEC.md); требования [PRD.md](PRD.md); тесты [TESTS.md](TESTS.md).
**Base SHA:** `665ec7ff3f3c4372bbdec6e25fca9b19f1cd5899`. Исполнитель перепроверяет актуальный main перед изменениями.

## Global Constraints

- Нативные UI, Notes/Tasks/Calendar и существующий агентный runtime; никаких iframe/вторых канонических графов/копий рабочих объектов.
- Ровно восемь системных определений PRD поставляются по умолчанию; enabled ≠ authorized ≠ healthy ≠ running.
- Устройство/облако/внешние действия ограничены явными grants; `allow-all` не отменяет role capability policy.
- production/fixture/simulated, lifecycle и verification независимы. HTTP 202 и fixture не являются выполненной работой.
- User-facing строки через t(), все фактические locale JSON в текущем checkout. AGENTS.md исторически говорит 10 локалей; не использовать число как allowlist.
- Не переименовывать protocol/storage/OAuth/package IDs и не удалять LICENSE/NOTICE/атрибуцию.
- Conation 404 блокирует только неподтверждённый перенос/операции. Нативный M0 развивается независимо.
- Не заменять старый registry. I-коды ниже — локальные work-package IDs программы RMA; `issues.json` связывает их с GitHub. Existing #320–#342 переиспользуются по SOURCE-AUDIT.
- Любой предложенный новый путь сначала проверить на эквивалентную реализацию. Отсутствие code search result не доказывает отсутствие файла.

## 1. Порядок и гейты

```
Контракты + предустановка + grants
               ↓
Ранний E2E harness I029
               ↓
Capture → Streaming → Transcript → Extraction
               ↓
Proposal → Approval → Executor → Native Task/Note
               ↓
M0: реальный сквозной результат после restart
               ↓
Assist / Knowledge / Artifacts / Integrations / Follow-up
               ↓
M1: работа во время и после встречи
               ↓
Conation capability + sync + domain adapters / Team
               ↓
M2: подтверждённая нативная интеграция
               ↓
Дополнительный ingress / собственные комнаты
               ↓
M3: расширенное покрытие + полный release gate
```

Числовой порядок I-кодов не является порядком исполнения. I029 запускается рано; I027 выполняется до I021–I026. У #333 отдельный владелец доступа/инвентаризации, работающий параллельно с M0. Нельзя ждать полного Conation, чтобы проверить native Task; нельзя считать native Task подтверждением Conation write.

M0 gate: I001–I013, I029, соответствующие проверки I028/I030/I031/I034 и существующие #320/#321/#331/#332/#334. Полный I028/031 может содержать более поздние сценарии; M0 readiness отмечается по конкретным E-кейсам, не автоматическим закрытием всей issue. M1: I014–I019/I017–I018 и относящиеся gates. M2: I020–I027/I032 и внешние live evidence. M3: I033. I034 не закрывается до полного согласованного scope всех milestones; промежуточный допуск отдельно фиксируется.

## 2. Обязательный цикл каждой задачи

- [ ] Прочитать свою issue, PRD требования, SPEC интерфейсы, TESTS case и существующие связанные PR; записать baseline SHA.
- [ ] Забронировать общие файлы в комментарии координационной issue; создать отдельную ветку/worktree. Не трогать рабочую ветку другого агента.
- [ ] Написать указанный failing test на реальное поведение. Запустить точную команду и сохранить RED; отсутствие helper/файла допустимо только как начальный RED, не как финальный результат.
- [ ] Внести минимальные изменения указанных файлов и связать фактический UI/RPC/storage path. Не рисовать результат из fixture в production factory.
- [ ] Запустить GREEN unit/RPC, соответствующий E-кейс, negative/recovery и regression. При изменениях UI добавить i18n/a11y/native evidence.
- [ ] Проверить данные после перезапуска/повтора команды. Для провайдера получить readback, а не только HTTP status.
- [ ] Отдельным коммитом сохранить реализацию и тесты, открыть PR с требованиями/логами/rollback; дождаться независимого review. Не merge main самостоятельно.
- [ ] Только после проверки критериев обновлять статус конкретной возможности. Draft PR, schema-only, fixture или docs не закрывают реализацию.

## 3. Карточки реализации

Все функции ниже — предлагаемые новые интерфейсы, не обещание их наличия на main. Typed input/output валидируются по SPEC до I/O. Каждая задача имеет одинаковый E-код по номеру; общий способ запуска и контур указаны в TESTS.

### I001 — Meeting/Proposal/Operation и совместимые общие контракты

Требования R25/R27/R47/R56. Зависимости: #320/#321; расширяет #336/#342, не повторяет identity migration. Modify `packages/core/src/rox2/platform-contract.ts`; Create `packages/core/src/meetings/model.ts`, `schemas.ts`, `rpc.ts`; `packages/server-core/src/meetings/repository.ts`, `journal.ts`, `migrations.ts`.

Реализовать Meeting как специализацию call; versioned Proposal и Operation, source revisions и causation. V2 codec разделяет mode/lifecycle/verification; legacy live → unknown verification. Repository использует single-writer journal/CAS, атомарную фиксацию events+outbox и quarantine повреждённого хвоста. Не держать mutable canonical data в renderer.

RED: `packages/core/src/meetings/__tests__/model.test.ts` — одинаковый remoteId разных аккаунтов; legacy false-success; неверная схема. `packages/server-core/src/meetings/__tests__/journal.test.ts` — stale expectedRevision, повтор commandId, restart после неполного хвоста. Run `bun test packages/core/src/meetings packages/server-core/src/meetings`. E01. Откат: вернуть V1 consumer, сохранить новые journals/backup; не удалить данные ради rollback.

### I002 — Предустановка восьми ролей и пользовательские overrides

R01/R02/R03/R04/R40. Независимая дорожка установки; handshake типов с I001. Read `packages/shared/src/config/storage.ts`, `packages/shared/src/skills/omp-discovery.ts`; Create `packages/shared/src/meeting-agents/catalog.ts`, `bootstrap.ts`, `prompts.ts`.

Экспортировать `ensureBuiltinMeetingAgents(workspaceId, packageVersion)` с migration ledger и восемью ID PRD. Сохранить пользовательские overrides/disabled, не создавать восемь sessions при bootstrap. Модельные роли используют существующий ROX provider; OAuth/broker — существующие. Обновление required scopes переводит readiness в authorization_required.

RED `packages/shared/src/meeting-agents/__tests__/bootstrap.test.ts`: два bootstrap/upgrade/disable/reset и scope expansion; 8 definitions и 0 idle model calls. `bun test packages/shared/src/meeting-agents`. E02. Откат definition version без удаления history/overrides.

### I003 — Consent, scoped grants и политика выполнения

R49/R54. Depends I001. Modify существующие grants/policy seams; Create `packages/shared/src/meeting-agents/policies.ts`, `apps/electron/src/main/meetings/permissions.ts`.

`authorizeMeetingAction` проверяет actor/workspace/device/source/operation/payloadHash/budget/expiry. Отдельные grants для mic, system audio, screen, cloud processing, archive и external writes. Denied/revoked/expired/challenge различаются. Перед I/O повторная проверка; неизвестный speaker не получает authority.

RED `packages/shared/src/meeting-agents/__tests__/policies.test.ts`: allow-all без meeting grant, revoke после approve, archive=no и cloud=no, narrow target grant. E03; `bun test packages/shared/src/meeting-agents/__tests__/policies.test.ts`. Откат — запрет новых чувствительных действий, не сброс consent.

### I004 — Реальный захват, импорт и очные встречи

R07/R08/R09/R16. Depends I001/I003. Create `apps/electron/src/main/meetings/capture.ts`; Modify `packages/shared/src/voice/host.ts`; экспортировать `startMeetingCapture`, `pauseMeetingCapture`, `stopMeetingCapture`, `importMeetingMedia` через device host.

Раздельные mic/system streams, монотонные метки, bounded buffers, валидный codec, SHA-256 и настоящая duration. Journal только по archive grant. Импорт дедуплицируется по source hash+workspace, symlink/path/size validation; отказ mic не блокирует импорт. NSAudioCaptureUsageDescription и loopback реально проверяются в package, не только dev.

RED `apps/electron/src/main/meetings/__tests__/capture.test.ts`: denied/dead stream/device unplug/pause; `packages/server-core/src/meetings/__tests__/import.test.ts`: replay/corrupt file. E04/N5. Откат отключает capture, сохраняет записи/явно допустимый импорт.

### I005 — Streaming ASR по подтверждённым gateway capabilities

R03/R11/R12. Depends I003/I004/#331. Create `packages/shared/src/voice/meeting-stream.ts`; Modify `contracts.ts`, `runtime.ts` только при подтверждённом контракте. `openMeetingStream` возвращает async segment stream и cancel.

Probe bootstrap/capabilities; validate codec/rate/resume; partial до stop. Batch fallback — самостоятельные decodable windows, overlap/dedupe, label batch_windowed. 401/429/timeout и отсутствующие веса не переводят в fixture/неразрешённое облако.

RED `packages/shared/src/voice/__tests__/meeting-stream.test.ts`: partial-before-stop, no streaming route, malformed frame, 429 backoff, abort/revoke. `bun test packages/shared/src/voice`. E05/L4/N5. Откат на честный поддержанный batch mode, без потери consent.

### I006 — Версии транскрипта, speaker binding и восстановление

R13/R14/R15/R58. Depends I001/I005. Create `packages/shared/src/voice/transcript-reducer.ts`; Modify meeting repository. Экспорт `applyTranscriptPatch(state, segment)` из TESTS; ключ streamId+segmentId, revision monotonic.

Не терять ручные corrections, отделить speaker label от Person. Persist finalized watermark и source model revision; repeated/out-of-order/old segment игнорируется, gap маркируется. Reprocess создаёт revision, не новую встречу.

RED `packages/shared/src/voice/__tests__/transcript-reducer.test.ts` — код TESTS §5 плюс второй stream, manual correction, restart. E06; `bun test packages/shared/src/voice/__tests__/transcript-reducer.test.ts`. Откат читает прежнюю selected revision, хранит все версии.

### I007 — Координатор и маршрутизация по существующему runtime

R04/R20/R56/R57. Depends I001/I002/I003. Create `packages/shared/src/meeting-agents/router.ts`; Read/extend `packages/shared/src/agent/session-tool-defs.ts` одним владельцем.

`routeMeetingEvent` выдаёт RoleJob с source snapshot, role definition version и budget. Dispatcher использует существующую backend factory/OMP; максимум 2 concurrent jobs на meeting/4 workspace, debounce 1000ms, interactive priority, cancellation. Не запускать model на каждый audio chunk.

RED `packages/shared/src/meeting-agents/__tests__/router.test.ts`: пять jobs, очередь, cancel, duplicate finalized watermark и неизвестный tool. E07; `bun test packages/shared/src/meeting-agents`. Откат выключает новые triggers, сохраняет drafts/jobs.

### I008 — Извлечение поручений, решений и исправлений

R22/R23/R24/R25. Depends I006/I007. Create `packages/shared/src/meeting-agents/extraction.ts`; extend `prompts.ts`/`schemas.ts`.

`extractMeetingCandidates` вызывает LLM через разрешённый role job, валидирует union результата, один bounded repair. EvidenceSpan обязателен; unresolved owner/date не заполняется догадкой. Учитывать отрицание, условность, цитаты и retraction. Исправление исходника делает pending proposal stale.

RED `packages/shared/src/meeting-agents/__tests__/extraction.test.ts` на semantic-cases TESTS; дополнительно live holdout в I030. E08; `bun test packages/shared/src/meeting-agents/__tests__/extraction.test.ts`. Откат — ручное извлечение/просмотр транскрипта, без удаления prior proposals.

### I009 — Proposal Inbox, diff и подтверждения

R31/R32. Depends I003/I008. Create `apps/electron/src/renderer/pages/meetings/ProposalInbox.tsx`, `packages/server-core/src/meetings/proposals.ts`.

`approveMeetingProposal` связывает actor, payloadHash, base revisions и target. UI: edit/clarify/approve/reject, отдельные targets и scope. Batch approve — отдельные валидированные операции, не глобальный allow-all. Источник поменялся → stale и повторное согласие.

RED `packages/server-core/src/meetings/__tests__/proposals.test.ts`: edit после approve, stale source, reject, два approvers. E09; `bun test packages/server-core/src/meetings/__tests__/proposals.test.ts`. Откат — proposals read-only, approved не исполняются автоматически.

### I010 — Durable execution, outbox и проверка результата

R33/R39/R49/R58. Depends I001/I003/I009. Create `packages/server-core/src/meetings/executor.ts`, `outbox.ts`, `verification.ts`.

`executeApprovedProposal` резервирует budget/operationId, lease worker, revalidates, вызывает domain command и сохраняет receipt. Readback сравнивает ожидаемые поля. Timeout после возможной записи → unknown/reconcile; нет provider idempotency+reconciliation → ручная проверка вместо resend.

RED `packages/server-core/src/meetings/__tests__/executor.test.ts`: duplicate execute, crash before/after effect, lease expiry, revoke, mismatched readback. E10; `bun test packages/server-core/src/meetings`. Откат kill switch новых dispatch; outbox/receipts не удаляются.

### I011 — Первый вертикальный срез Native Notes → Tasks

R27/R33/R46. Depends I010/#332/#334; Conation не является зависимостью. Create `packages/server-core/src/meetings/native-actions.ts`; Modify `packages/server-core/src/handlers/rpc/notes.ts`, `tasks.ts` совместно с владельцами.

Создать/обновить Task через canonical repository с operationId/CAS; notes link/source span, один Task ID в meeting и TasksPage. UI открывает оригинал. Нет localStorage canonical write и нет отдельной копии task в meeting store.

RED `packages/server-core/src/meetings/__tests__/native-actions.test.ts`: successful write/readback/restart/double approval/disk error. E11 через UI. Откат отключает action type, сохраняет уже созданные native entities и обратные связи.

### I012 — Нативная коллекция и страница встречи

R15/R21/R29/R30. Depends I006/I011. Create `apps/electron/src/renderer/pages/MeetingsPage.tsx`, `meetings/MeetingDetail.tsx`; Modify nav destinations; Create `packages/server-core/src/handlers/rpc/meetings.ts`.

List/read/search/pagination, live+final transcript, separate manual notes, corrections, bookmarks, decisions/materials/action history. Доступные/пустые/denied/offline/incomplete состояния различаются. Добавить stable testids TESTS, виртуализацию длинного transcript, unsubscribe on unmount.

RED `packages/server-core/src/meetings/__tests__/queries.test.ts` на ACL/cursor; E12 настоящий DOM+RPC с 100 встречами. Откат hides только новый nav, не удаляет данные.

### I013 — Оверлей и горячие клавиши

R17/R60. Depends I004/I005. Modify `apps/electron/src/renderer/voice-overlay.tsx`; Create `apps/electron/src/main/meetings/overlay.ts` как расширение existing window host, не второе независимое voice окно.

Ask/catch-up/pause/stop; showInactive, no focus steal, persistent position, hotkey conflict/rebind и доступность клавиатурой. error отображает error, не ready. Screen-share exclusion только по проверенной platform capability.

RED `apps/electron/src/main/meetings/__tests__/overlay.test.ts` lifecycle; E13/N5 при другом foreground app. Откат на прежний voice overlay, захват можно остановить через tray/главное окно.

### I014 — Live assist и выбранный экран

R18/R19. Depends I006/I007/I013/#338. Create `apps/electron/src/main/meetings/screen-context.ts`, `packages/shared/src/meeting-agents/assist.ts`.

`answerMeetingQuestion` потребляет SurfaceContextProvider snapshot+revisions, разрешённые finalized/partial данные с меткой стабильности и selected-frame. Бюджет контекста, citations, источник неизвестен → explicit uncertainty; revoke прекращает кадры и model queue.

RED `packages/shared/src/meeting-agents/__tests__/assist.test.ts`: forbidden source, stale snapshot, question without context, injected instruction in frame. E14/N5. Откат screen input отдельно; текстовый assist продолжает разрешённую работу.

### I015 — Знания, свойства и замещение решений

R26/R28. Depends I008/I009/I011/#321/#336. Create `packages/shared/src/meeting-agents/knowledge.ts`; Modify native Notes/knowledge proposal seam владельца #334.

`proposeKnowledgeChange` ищет существующий разрешённый объект, создаёт diff с base revision и typed fields; relation supersedes сохраняет историю. Filtered views и custom properties используют общий schema, не второй Tana-like database.

RED `packages/shared/src/meeting-agents/__tests__/knowledge.test.ts`: concurrent edit, round-trip user properties, renamed note link, superseded decision. E15. Откат disables apply, предложения/версии сохранены.

### I016 — Артефакты и coding handoff

R34/R35. Depends I007/I009/I010. Create `packages/shared/src/meeting-agents/artifacts.ts`; extend role prompts и существующие session tools.

`buildMeetingArtifact` запускает разрешённую специализированную session. Сохраняет artifact version/format/hash/source, проверяет фактическое открытие или парсинг. DOCX/XLSX/PPTX/PDF и code draft требуют соответствующих инструментов, не строкового placeholder. Coding handoff открывает draft PR только в утверждённом repo/branch, без merge/deploy.

RED `packages/shared/src/meeting-agents/__tests__/artifacts.test.ts`: empty/broken output, permission denial, secret access, successful native artifact readback. E16. Откат прекращает новые author jobs, сохраняет файлы и provenance.

### I017 — GitHub/Linear и общий контракт внешнего действия

R34/R36. Depends I010. Create `packages/server-core/src/meetings/tracker-actions.ts` поверх существующего source/tool registry; не новый credential store.

Resolve repo/team/project/assignee IDs до approval. Issue включает context/AC/source, update использует expected revision где поддерживается. Provider receipt/readback, unknown result policy и rate limits. Не перемещать failed action в другой repo автоматически.

RED `packages/server-core/src/meetings/__tests__/tracker-actions.test.ts`: wrong target, permissions, duplicate create, post-write timeout, update conflict. E17/L4 для обоих целевых providers. Откат revoke adapter capability, не удаление внешних issues.

### I018 — Подготовка, follow-up и долговечные расписания

R05/R06/R36/R38/R39. Depends I010/I011; production workflow path зависит #325. Create `packages/server-core/src/meetings/followup.ts`; extend existing automations.

Before-meeting prep, finalization jobs, overdue review по current task state; occurrence key, timezone/DST, cancel/opt-out, missed-run policy, maximum retry и бюджет. Device-only job → waiting_device, server job продолжает при закрытом UI. Не использовать simulation runner как success.

RED `packages/server-core/src/meetings/__tests__/followup.test.ts`: DST, cancel event, restart, duplicate trigger, unavailable device, already completed task. E18. Откат schedules disabled с сохранением ledger.

### I019 — Профили встреч, навыки и настройка ролей

R20/R37/R40/R64. Depends I007/I014/I015/I016/I018. Create `packages/shared/src/meeting-agents/recipes.ts`; Create `apps/electron/src/renderer/pages/meetings/AgentReadiness.tsx`.

Профили standup/discovery/design-review/client/project-review задают outputs, playbooks и permitted actions. `/` вызывает реальный skill; clone/override/reset сохраняет версии. Клиентский анализ создаёт proposals; неподключённая CRM не даёт fake update.

RED `packages/shared/src/meeting-agents/__tests__/recipes.test.ts`: schema per profile, unknown skill, override migration, clone permission escalation. E19. Откат recipe version, сохранять custom overrides.

### I020 — Подтверждённые Conation capabilities и поставка модулей

R41/R42/R43/R46. Depends I001/I003/#333. Create `packages/server-core/src/meetings/conation/capabilities.ts`, `adapters.ts`; Modify existing Soup/DSS seams только по подтверждённой схеме.

Вход #333: source SHA/schema hash/license/deployment inventory. Для каждого модуля выбрать встроенную библиотеку/управляемый сервис/optional adapter с обоснованием. Registry capability не объявляет отсутствующие mutations; auth через broker, проверка version и health. Не фиксировать неподтверждённый endpoint в коде.

RED `packages/server-core/src/meetings/conation/__tests__/capabilities.test.ts`: missing schema, incompatible version, unsupported mutation, no auth, native fallback. E20. Blocked source не заменять выдуманной реализацией. Откат capability disable, native UI остаётся.

### I021 — Conation Notes и Projects в нативных repositories

R42/R43/R46/R47. Depends I020/I027/I011/#323/#324. Create `packages/server-core/src/meetings/conation/notes-projects.ts`.

Перенести подтверждённые list/read/edit/project-link операции через общий repository. Unknown fields round-trip; external note открывается в обычном NotesPage. Использовать исправленную pagination, stable binding и source revision; edits через proposal/CAS/readback.

RED `packages/server-core/src/meetings/conation/__tests__/notes-projects.test.ts`: note on page2, rename, offline stale, denied, concurrent edit. E21/L4. Откат read-only adapter, staging backup сохраняется.

### I022 — Conation Board/Fund без вторых досок и графов

R27/R45. Depends I020/I027/I011/#336. Create `packages/server-core/src/meetings/conation/board-fund.ts`; Modify existing `KanbanBoard.tsx` и pages/mindmap seams.

Утверждённые upstream task/board/canvas операции связываются с native Task/Page/relations. Layout и semantic graph различаются; drag перемещает объект через CAS, не копирует. Deep-link как временный external action не считается реализацией.

RED `packages/server-core/src/meetings/conation/__tests__/board-fund.test.ts`: one Task across 3 views, rename/unlink, cycle rules, concurrent drag. E22/L4. Откат adapter operations, не новый second board.

### I023 — Conation DSS/Files с версиями и подписанными операциями

R44/R47/R48. Depends I020/I027/I010. Create `packages/server-core/src/meetings/conation/files.ts`; Modify `packages/core/src/conation/dss/client.ts` по схеме #333.

List/read/upload/version/move где подтверждено; path не ID; validate content hash/size/type, streaming upload, подписать запрос existing credential broker. Не использовать filesystem FileProvider как prerequisite обычного native Files UI.

RED `packages/server-core/src/meetings/conation/__tests__/files.test.ts`: page2, signature missing, corrupt upload, moved path stable id, retry. E23/L4. Откат writes off, чтение и локальные вложения сохранены.

### I024 — Conation Mail и Channels: draft отдельно от send

R36/R42/R43. Depends I020/I027/I010. Create `packages/server-core/src/meetings/conation/mail-channels.ts`; использовать native entity-list/messaging seam.

Thread/message/channel IDs и аудитории явны. Prepare draft, edit, approve и send/post — отдельные операции; UI показывает адресатов/attachments. Timeout после send не даёт auto-resend; reconcile по подтверждённому provider contract.

RED `packages/server-core/src/meetings/conation/__tests__/mail-channels.test.ts`: changed recipient after approve, revoke, duplicate callback, send unknown. E24/L4. Откат send disabled, drafts сохранены; не обещать отмену отправленного.

### I025 — Conation CRM и клиентский контекст

R37/R42/R43. Depends I020/I027/I010. Create `packages/server-core/src/meetings/conation/crm.ts`.

Company/contact/deal различать по реально доступной schema; наличие company type не доказывает contact/deal mutation. Подтверждённые read/update operations с target confirmation, CAS и source meeting relation. Не объединять по displayName.

RED `packages/server-core/src/meetings/conation/__tests__/crm.test.ts`: same-name companies/accounts, missing deal capability, concurrent update, denied source. E25/L4. Откат mutations off; аналитические предложения остаются drafts.

### I026 — Conation Calendar/Reminders/Calls/Chats

R38/R42/R43/R47. Depends I020/I027/I018/#329/#330. Create `packages/server-core/src/meetings/conation/calendar-calls.ts`; Modify existing calendar adapters.

Map occurrence identity, date-only/timezone/recurrence/cancel; reminder delivery ledger. Calls связать с Meeting, Chats с native Session по external binding; не duplicative transcript dual-write. Не строить fake dialer.

RED `packages/server-core/src/meetings/conation/__tests__/calendar-calls.test.ts`: recurring exception, account collision, cancellation, call/chat dedupe, timezone. E26/L4. Откат sync writes off, original local events сохранены.

### I027 — Общий Conation sync, checkpoints и конфликты

R43/R48/R49/R58. Depends I020/I010. Create `packages/server-core/src/meetings/conation/sync.ts`.

`syncConationPage`/subscription consumer: checkpoint после durable commit, bounded repeated cursors, tombstones, dedupe, origin/causation, revoke-generation guard после await. Offline writes сохраняются pending; remote-only updates не создают ложный conflict; concurrent edits — explicit conflict.

RED `packages/server-core/src/meetings/conation/__tests__/sync.test.ts`: replay, empty page≠delete-all, revoke during fetch, echo-loop, conflicting revisions, crash before checkpoint. E27. Откат sync остановлен с сохранением cursor/outbox/backups.

### I028 — Adversarial security и отзыв доступа

R49/R51/R54. Depends I003/I010/I014; повторить проверки после I032. Create `tests/e2e/meeting-agents/e28-adversarial.spec.ts`; extend server meeting policy tests.

Attack corpus: prompt injection в speech/screen/doc; forged actor/workspace/target; approved-but-revoked; private note in shared recap; secret retrieval из tools; экспорт чужих данных. Проверка до retrieval и перед результатом/публикацией, deny by default; sanitized audit.

RED `packages/server-core/src/meetings/__tests__/security.test.ts`: зафиксировать запрет каждого пути, test actual tool counters/storage. E28. Откат kill switch sensitive operations; не отключать проверки ради UI.

### I029 — E2E harness и evidence pipeline, начать рано

R55/R62. Depends I001/I002/I003; не ждать остальных feature tasks. Create TESTS §2 файлы и scripts; реализовать `bootMeetingApp`, fixture boundary server и isolated temp profiles.

Первый тест — bootstrap/permissions настоящего UI; затем E11 код TESTS дополняется владельцем I011. `restart()` обновляет app/page handles на том же профиле. Capture/provider mocks только DI в test entrypoint; prod flag не включает fixture. Evidence JSON и sanitized trace обязательны, no-tests-found — failure.

RED harness lifecycle/leak test; `bun run test:meetings:e2e` после добавления script. E29. Откат CI job только с явным failed/blocked gate, не «успешный skip».

### I030 — Метрики, качество, бюджеты и нагрузка

R12/R53/R55/R57. Depends I005/I007/I008/I010. Create `packages/server-core/src/meetings/observability.ts`, `tests/evals/meeting-agents/run.ts`, `tests/evals/meeting-agents/thresholds.json`.

Реализовать этапные traces, reserve/settle/reconcile budget, concurrency/backpressure и удержанный RU/EN eval. Показать task precision/recall/abstain, owner/date, citation validation и реальное p95. Длинный 60min case, 429, offline backlog, cancel, bounded memory. Conversation metrics имеют формулу/coverage.

RED `packages/server-core/src/meetings/__tests__/budgets.test.ts`: parallel reserve не превышает cap, unknown не возвращает бюджет молча. E30 + live holdout. Откат снижает concurrency/отключает дорогие роли, не скрывает счётчик.

### I031 — Поставка, обновление, web parity и доступность

R01/R02/R59/R60/R61. Depends I002/I012/I013/I029. Modify existing electron asset copying/build config и native pages; не менять bundle/protocol IDs.

Пакет включает роли/prompts/skills/schemas; signed local weights lazy. Fresh install/upgrade/uninstall-reinstall preserve explicit retention policy и overrides. Web поддерживает просмотр/подтверждения доступных операций, unsupported OS capture честно обозначен. Все locales, keyboard/screen reader, zoom200%, reduced-motion, overlay focus.

RED packaging resource assertions плюс реальные E31/N5 на заявленных OS. `bun run electron:build`, `bun run webui:build`, i18n parity/sorted; существующие build failures воспроизводить на baseline. Откат версии сохраняет user data.

### I032 — Командная память, экспорт, clips и удаление

R50/R51/R52/R54. Depends I012/I015/I028. Create `packages/server-core/src/meetings/sharing.ts`, `exports.ts`, `retention.ts`; extend existing collaboration seam.

Audience intersection для recap/export/search; личные notes отдельно. Совместные corrections с CAS/merge, ссылки с revoke, JSON/Markdown/media round-trip, clip ranges. Delete invalidates indexes/cache/derived artifacts; внешние отправленные копии помечены external-retained, не ложно удалены.

RED `packages/server-core/src/meetings/__tests__/sharing-retention.test.ts`: member revoke, private-note leak, export/import links, concurrent edit, deletion cascade. E32. Откат новые shares off, existing access policies/история сохранены.

### I033 — Собственные комнаты и дополнительные capture ingress

R10/R63. Depends I004/I006/I007/I028. Create `packages/core/src/meetings/room-contract.ts`, `packages/server-core/src/meetings/rooms.ts`, `ingress.ts`, `apps/electron/src/renderer/pages/meetings/MeetingRoom.tsx`.

Самостоятельный M3 срез. Сначала зафиксировать provider/SFU capability/deployment/стоимость и permission границы; использовать готовый media primitive, не писать собственный codec/SFU. Room joins/guest ACL/media tracks/screen share/agent participant, recording consent и reconnect проверяются двумя реальными клиентами. Bot ingress каждого сервиса отдельно с callback signature и idempotency; не заявлять все платформы от одной кнопки.

RED room command state/unauthorized guest/replayed callback tests; E33/N5/L4. Откат room feature off, сторонние встречи M0 не затронуты.

### I034 — Release gates, rollout, rollback и окончательная приёмка

R56/R62. Depends I001–I033 по полному scope; промежуточный M0/M1/M2 gate не закрывает issue. Create `docs/qa/meeting-agents-acceptance.md`, `docs/qa/meeting-agents-evidence.json`; extend relevant CI only after baseline check.

Собрать requirements→issues→tests→evidence matrix на release SHA. Failed/blocked/not_run обязательного case запрещает default-ready соответствующей capability. Поэтапный rollout внутренних capture/actions не скрывает installed definitions. Kill switch прекращает новые эффекты; rollback сохраняет journals/grants/overrides; staged migrations обратимы. Ни upstream license blocker, ни missing native proof не считать passed.

E34: fresh install→call→approve→Task→artifact/provider→restart→revoke→delete и negative cases. Отдельно полная матрица Conation операций. Закрытие только после review фактических evidence и согласованного scope, не по числу merged PR.

## 4. Инструкции по коммиту и PR

Использовать точные пути своей карточки, не `git add .`. Пример для I006:
```sh
bun test packages/shared/src/voice/__tests__/transcript-reducer.test.ts
git add packages/shared/src/voice/transcript-reducer.ts packages/shared/src/voice/__tests__/transcript-reducer.test.ts
git commit -m "feat(meetings): apply versioned transcript patches without duplicates"
```

Тело PR: issue ID/ссылка; baseline/head SHA; фактический путь UI→RPC→domain→provider; требования R; RED/GREEN команды и логи; E-кейсы с level/result; миграция/rollback; недоступные capabilities; риск privacy/budget. Не добавлять `Closes` к родительской программе или неподтверждённым требованиям.

## 5. Критический путь

Начать I002 и владельца #333 параллельно; завершить общие #320/#321 и I001/I003. Поднять I029 до UI-интеграции. Затем I004→I005→I006, параллельно I007; I008→I009→I010→I011. I012/I013 завершают первый UX. Следующий шаг выбирается по закрытым acceptance dependencies, а не по минимальному номеру issue.

Трудозатраты и даты не выдумываются до первых actual capture/gateway/packaging измерений. Новый блокер оформляется с владельцем, воспроизведением, допустимым обходом и влиянием на конкретный milestone; он не является поводом объявить весь проект недоступным или запустить заглушку как production.
