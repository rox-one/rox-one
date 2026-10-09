# RECON-01 — текущее состояние, реестр доказательств (#1158)

- Наблюдение: **2026-10-08T22:20:00Z**, база чтения — `origin/main` @ `8c5abc7a32a3773645b695b79a81c327b8e6758d`.
- Метод: read-only. Только чтение git-состояния существующих чек-аутов и GitHub API; никаких `reset/checkout/clean` поверх чужой работы, никаких изменений issues/PR.
- Канонический артефакт RECON-01 предыдущего прогона (`docs/september-program/recon-evidence.json`, `observedAt 2026-09-30T02:21:32.311Z`) **сохранён без изменений**; этот отчёт его не перезаписывает.
- Область: U01–U31, деревья RMA / Golden Gate / Conation / Macro / ROX Suite / Rox Unified, текущие чек-ауты и открытые PR.

## 1. Чек-ауты на этой машине (read-only снимок)

| # | Репозиторий | Тип | ref | HEAD | dirty | Примечание |
|---|---|---|---|---|---|---|
| A | rox-one/rox-one | bare mirror (shared object store) | `refs/heads/fix/residual-ci-reds-20261008` | `0b8a4dda1fe3` | — | 279 local branches, 832 remote refs; origin/main=8c5abc7a3 |
| B | rox-one/rox-one | linked worktree | `feat/w1-09-activity-notifications-inbox` | `3b88d1a0084c` | 804 | staged overlay: 403 A / 380 M / 21 D; PR #1621 head; preserve |
| C | rox-one/rox-one | linked worktree | `feat/w1-14-collab-xsc-drive-contracts` | `f842f3402e59` | 0 | clean; PR #1626 head |
| D | rox-one/rox-one | linked worktree | `feat/w1-15-chrome-agent-panel-xfn` | `93e5a86ccae6` | 0 | clean; PR #1625 head |
| E | rox-one/rox-one | linked worktree | `perf/p2-keepalive-prefetch` | `1922d50c3a70` | 0 | clean; PR #1620 head |
| F | rox-one/rox-one | linked worktree | `(detached)` | `3f1a978e9188` | 0 | detached at e01-decisions tip (merge of origin/main); no branch moved |
| G | rox-one/rox-one | linked worktree | `feat/e01-voice-wave` | `c61a3536a476` | 46 | MERGE IN PROGRESS: MERGE_HEAD=8c5abc7a3 (origin/main); 19 unmerged-ish entries incl 4 UU; do not touch |
| H | rox-one/rox-one | separate clone | `main` | `e6c899357e3a` | 15540 | 15540 staged deletions (index-only) pending owner decision; preserve |
| I | rox-one/rox-one | separate clone | `fix/product-tour-native-green` | `bbeb2d543011` | 62 | origin/main=8c5abc7a3; 47 M / 15 ??; PR #1627 source; 80 registered worktrees in this clone |
| J | rox-one/rox-one | separate clone | `main` | `7f70d5f2` | 0 | clean; behind origin/main |
| K | agisota/craft-agents-oss (upstream fork) | separate clone | `audit/final-readiness-2026-10-03` | `9fca38a5` | 42 | 35 M / 7 ??; not the rox-one delivery repo |
| L | rox-one/rox-one | linked worktree of clone I | `develop/hosted-web-readiness-2026-10-03` | `76228cc33` | 4 | holds docs/macro-integration analysis; 2 M / 2 ?? |
| M | macro-inc/macro (donor, AGPL/rights-reserved) | separate clone | `main` | `b8638add7c` | 3 | 1 M / 1 D / 1 ??; donor repository for Conation/Macro review |
| N | no origin remote | separate clone | `operator/hour-baseline` | `1a9cf85667` | 0 | isolated upstream baseline; not a delivery surface |

Чек-аут **I** дополнительно зарегистрировал **80 worktrees** (основная масса — рабочие деревья агентских задач под `<HOME>/.codex/worktrees/**` и `<HOME>/Projects/**`);
наибольшие несохранённые overlay: ветка `release/desktop-runtime-20261003` (чек-аут `<HOME>/Projects/rox-release-20261003`) — 220 записей, включая 19 unmerged; сам `rox-one` — 62.
Все перечисленные overlay **не трогались**; ни одна операция не изменяла содержимое или индекс чужих деревьев.

**Sentinel (негативная проверка сохранности).** Маркером выбраны реальные чужие изменения: чек-аут **B** (804 staged-записи),
**G** (merge in progress, `MERGE_HEAD = 8c5abc7a3`), **H** (15 540 staged-удалений), `rox-release-20261003` (220 записей, 19 unmerged).
Повторное чтение после сбора: **B** = 804 и HEAD `3b88d1a0084c`; **H** = 15 540 и HEAD `e6c899357e3a`; `rox-release-20261003` = 220 и HEAD `29e86bcc515e` — совпадают.
**G**: HEAD и `MERGE_HEAD` не изменились, но число записей `git status --porcelain` сместилось 46 → 45 (один путь вышел из конфликтного состояния).
Изменение зафиксировано как **сделанное владельцем этого дерева в промежутке между двумя чтениями**; RECON не выполнял ни одной операции записи ни в одном чек-ауте, кроме создания собственного worktree ветки `docs/sept-program-1158-recon`.

**Деревья живые.** После повторного чтения чек-аут **B** был изменён его владельцем ещё раз (804 → 0 записей, HEAD `3b88d1a0084c` → `945182eb8`).
Это ожидаемое поведение параллельной работы и не является следствием RECON: все значения в этом реестре — снимок на момент наблюдения, а не текущее состояние.
Перед любым dispatch владелец обязан перечитать конкретный ref, а не опираться на таблицу выше.

## 2. Открытые PR (11) и их ветки

| PR | head | base | mergeable | draft | Локальная ветка pushed |
|---|---|---|---|---|---|
| #1615 | `feat/w1-06-workitem-v3-schemas` | `main` | MERGEABLE | False | да (совпадает с origin) |
| #1618 | `perf/p2-query-cache` | `main` | MERGEABLE | False | да (совпадает с origin) |
| #1620 | `perf/p2-keepalive-prefetch` | `perf/p2-query-cache` | MERGEABLE | False | да (совпадает с origin) |
| #1621 | `feat/w1-09-activity-notifications-inbox` | `main` | CONFLICTING | False | да (совпадает с origin) |
| #1622 | `feat/w1-12-domain-rule-engine` | `main` | MERGEABLE | False | да (совпадает с origin) |
| #1623 | `feat/w1-11-identity-agent-governance` | `main` | CONFLICTING | False | да (совпадает с origin) |
| #1624 | `feat/e01-voice-wave` | `main` | CONFLICTING | False | да (совпадает с origin) |
| #1625 | `feat/w1-15-chrome-agent-panel-xfn` | `main` | CONFLICTING | False | да (совпадает с origin) |
| #1626 | `feat/w1-14-collab-xsc-drive-contracts` | `main` | MERGEABLE | False | да (совпадает с origin) |
| #1627 | `fix/product-tour-native-green` | `main` | UNKNOWN | False | да (совпадает с origin) |
| #1628 | `feat/rox-batch2-20261008` | `main` | UNKNOWN | False | да (совпадает с origin) |

Исторические: PR **#1293** (`feat/september-program-20260930` → main) — **MERGED** 2026-10-03T02:08:50Z; PR **#584** (`codex/golden-gate-workspace`) — **CLOSED без merge**; PR **#991** — **MERGED** 2026-09-22T16:08:12Z.

## 3. Реестр U01–U31 → первичный владелец и задача

| U | Строк | Первичные задачи (issue, состояние) |
|---|---|---|
| U01 | 15 | AUDIT-01 #1159 (open) ×6; FEED-01 #1202 (open) ×3; HOME-01 #1196 (open) ×2; NOTES-01 #1163 (open) ×1; TASKS-01 #1195 (open) ×1; MEMORY-02 #1169 (open) ×1; IMPORTS-01 #1173 (open) ×1 |
| U02 | 8 | MAIL-01 #1181 (open) ×7; MAIL-02 #1182 (open) ×1 |
| U03 | 1 | VOICE-01 #1185 (open) ×1 |
| U04 | 3 | VOICE-02 #1186 (open) ×3 |
| U05 | 7 | MEETINGS-01 #1187 (open) ×6; MEETINGS-02 #1190 (open) ×1 |
| U06 | 4 | UX-01 #1136 (open) ×3; DESIGN-01 #1138 (open) ×1 |
| U07 | 3 | DESIGN-01 #1138 (open) ×3 |
| U08 | 4 | ONBOARD-01 #1139 (open) ×4 |
| U09 | 6 | PROJECTS-01 #1194 (open) ×6 |
| U10 | 4 | CHAT-02 #1122 (open) ×3; CHAT-01 #1121 (open) ×1 |
| U11 | 4 | NATIVE-01 #1145 (open) ×4 |
| U12 | 6 | MARKETPLACE-01 #1172 (open) ×4; SETTINGS-01 #1144 (open) ×1; UX-01 #1136 (open) ×1 |
| U13 | 3 | QUEST-01 #1203 (open) ×3 |
| U14 | 4 | TEAMS-01 #1123 (open) ×2; TEAMS-02 #1124 (open) ×1; TEAMS-03 #1125 (open) ×1 |
| U15 | 5 | THEME-01 #1140 (open) ×5 |
| U16 | 3 | CANVAS-01 #1166 (open) ×3 |
| U17 | 8 | INTEGRATIONS-02 #1132 (open) ×5; INTEGRATIONS-01 #1131 (open) ×1; IMPORTS-01 #1173 (open) ×1; INTEGRATIONS-03 #1135 (open) ×1 |
| U18 | 9 | COLLAB-05 #1130 (open) ×3; COLLAB-01 #1126 (open) ×2; COLLAB-04 #1129 (open) ×2; COLLAB-03 #1128 (open) ×1; SYNC-01 #1133 (open) ×1 |
| U19 | 3 | AGENT-BUDGET-01 #1213 (open) ×3 |
| U20 | 3 | FOCUS-01 #1214 (open) ×3 |
| U21 | 3 | AUTOMATION-01 #1215 (open) ×1; AUTOMATION-02 #1216 (open) ×1; SCHEDULED-02 #1218 (open) ×1 |
| U22 | 4 | REMOTE-01 #1219 (open) ×3; REMOTE-02 #1220 (open) ×1 |
| U23 | 5 | UX-01 #1136 (open) ×2; L10N-01 #1142 (open) ×1; TASKS-01 #1195 (open) ×1; SETTINGS-01 #1144 (open) ×1 |
| U24 | 3 | WINDOWS-01 #1146 (open) ×3 |
| U26 | 343 | CONATION-E2E-01 #1154 (open) ×101; CONATION-AUTH-01 #1153 (open) ×32; DASHBOARD-01 #1197 (open) ×27; CANVAS-02 #1167 (open) ×19; L10N-01 #1142 (open) ×19; MAIL-04 #1184 (open) ×18; INBOX-01 #1198 (open) ×14; A11Y-01 #1143 (open) ×14; CALENDAR-01 #1199 (open) ×12; DRIVE-01 #1175 (open) ×11; CRM-01 #1200 (open) ×11; TASKS-01 #1195 (open) ×10; SEARCH-01 #1174 (open) ×9; PAYMENTS-01 #1211 (open) ×8; SPREADSHEET-01 #1178 (open) ×7; CONATION-DELIVERY-01 #1155 (open) ×6; REMINDERS-01 #1201 (open) ×6; AGENTCENTER-01 #1210 (open) ×5; CONATION-SHARE-01 #1229 (open) ×3; NOTES-03 #1165 (open) ×3; PDF-01 #1179 (open) ×3; SPLIT-01 #1180 (open) ×3; ACTIVITY-01 #1206 (open) ×2 |
| U27 | 3 | RMA-01 #1150 (open) ×3 |
| U28 | 6 | RMA-02 #1151 (open) ×6 |
| U29 | 5 | MAIL-03 #1183 (open) ×2; CRM-01 #1200 (open) ×1; CALENDAR-01 #1199 (open) ×1; RMA-03 #1152 (open) ×1 |
| U30 | 3 | GG-02 #1148 (open) ×2; GG-01 #1147 (open) ×1 |
| U31 | 6 | GG-03 #1149 (open) ×6 |

U25 в реестре требований **не имеет строк** (0): это `decision-reconciliation`, а не подтверждённая задача. Источник — `requirements-full.json` (484 строки) и `requirements-addendum.json` (5 строк OKR).

## 4. Реестр задач программы (task-registry.json)

- Всего задач: **109**; статусы: IN_PROGRESS = 31, NOT_RUN = 78.
- Виды: decision-reconciliation = 1, proposal-audit = 10, requested = 51, verification-gap = 47.
- Владельцев: **68**; зависимостей: **464**.
- `productStatus` реестра: **IN_PROGRESS**; `packetStatus`: **PUBLISHED_VERIFIED**.
- Критический путь: PROGRAM-01 → RECON-01 → AUDIT-01 → DATA-01 → SHARED-01 → atomic tasks or source-backed dispositions → INTEGRATE-01 → RELEASE-01.

## 5. Деревья issue: живое состояние

| Дерево | Всего | OPEN | CLOSED |
|---|---|---|---|
| September-карточки (label `September-program`) | 109 | 109 | 0 |
| RMA (`[RMA-…]`) | 35 | 6 | 29 |
| Golden Gate (`[Golden Gate]`) | 26 | 25 | 1 |
| Conation (`[Sep-conation]` + `[ROX-AUD]`) | 27 | 4 | 23 |
| ROX Macro (`[ROX Macro]`) | 52 | 52 | 0 |
| ROX Suite (`[ROX Suite…]`) | 76 | 76 | 0 |
| Rox Unified (`[Rox Unified]`) | 37 | 35 | 2 |

### 5.1 RMA: живой срез

| Issue | Title | State | Labels |
|---|---|---|---|
| #356 | [RMA-000] ROX Meeting Agents: предустановленная команда, нативные функции Conation и скв | closed | — |
| #357 | [RMA-I001][P0] Meeting/Proposal/Operation: общий контракт, CAS-журнал и честные результа | closed | — |
| #358 | [RMA-I002][P0] Предустановка восьми агентов: версии, overrides и готовность без ручной н | closed | — |
| #359 | [RMA-I003][P0] Scoped grants: capture, облако, архив и внешние действия | closed | — |
| #360 | [RMA-I004][P0] Реальный mic/system capture, импорт записей и очные встречи | closed | — |
| #361 | [RMA-I005][P0] Потоковый ASR через ROX: partial до stop и честный fallback | closed | — |
| #362 | [RMA-I006][P0] Версии транскрипта, speaker binding, correction и resume без дублей | closed | — |
| #363 | [RMA-I007][P0] Координатор ролей поверх существующего runtime: очереди, лимиты, cancel | closed | — |
| #364 | [RMA-I008][P0] Извлечение поручений и решений: отрицания, сроки, отмены, provenance | closed | — |
| #365 | [RMA-I009][P0] Proposal Inbox: diff, уточнение, подтверждение конкретной версии действия | closed | — |
| #366 | [RMA-I010][P0] Durable executor: outbox, idempotency, receipts и readback | closed | — |
| #367 | [RMA-I011][P0] Первый E2E: встреча → подтверждение → настоящие Notes и Task → restart | closed | — |
| #368 | [RMA-I012][P0] Нативные Meetings: архив, живая страница, ручные заметки и поиск | closed | — |
| #369 | [RMA-I013][P0] Оверлей встречи и горячие клавиши без перехвата фокуса | closed | — |
| #370 | [RMA-I014][P1] Live Assist: ответы, catch-up и контекст выбранного экрана | closed | — |
| #371 | [RMA-I015][P1] Структурированные знания: свойства, diff и замещение решений | closed | — |
| #372 | [RMA-I016][P1] Автор материалов: проверенные документы, таблицы, презентации и coding ha | closed | — |
| #373 | [RMA-I017][P1] GitHub/Linear: реальные issues из встречи с target resolution и readback | closed | — |
| #374 | [RMA-I018][P1] Подготовка и follow-up: расписания, обещания и работа после закрытия UI | closed | — |
| #375 | [RMA-I019][P1] Готовые профили встреч, slash-навыки и настройка агентов | closed | — |
| #376 | [RMA-I020][P1] Conation: подтверждённые capabilities и нативная поставка модулей | closed | — |
| #377 | [RMA-I021][P1] Conation Notes/Projects: нативные чтение, правки и общая идентичность | closed | — |
| #378 | [RMA-I022][P1] Conation Board/Fund: одна нативная доска, задачи и canvas | closed | — |
| #379 | [RMA-I023][P1] Conation DSS/Files: подписанные операции, версии, загрузка и перемещение | closed | — |
| #380 | [RMA-I024][P1] Conation Mail/Channels: подготовка, согласование и проверенная отправка | open | prio:P1, area:meeting-agents, screen:Inbox, type:feature, layer:backend, user-facing |
| #381 | [RMA-I025][P1] Conation CRM: клиентский контекст и проверенные изменения без склейки по  | open | prio:P1, area:meeting-agents, screen:CRM, type:feature, layer:backend, user-facing |
| #382 | [RMA-I026][P1] Conation Calendar/Reminders/Calls/Chats: один календарь и связанные встре | open | prio:P1, area:meeting-agents, screen:Calendar, type:feature, layer:backend, user-facing |
| #383 | [RMA-I027][P1] Conation sync: checkpoints, offline, tombstones, конфликты и revoke | closed | — |
| #384 | [RMA-I028][P0] Adversarial security: prompt injection, actor spoofing, ACL и утечки | closed | — |
| #385 | [RMA-I029][P0] Ранний E2E harness: настоящий Electron → RPC → storage и уровни evidence | open | prio:P0, area:meeting-agents, type:tests, layer:infra |
| #386 | [RMA-I030][P0] Качество и эксплуатация: RU/EN eval, задержки, память и бюджеты | closed | — |
| #387 | [RMA-I031][P0] Поставка агентов: packaged app, upgrade, web, локали и доступность | open | prio:P0, area:meeting-agents, type:infra/release, layer:infra |
| #388 | [RMA-I032][P1] Командная память, совместные заметки, экспорт, clips и удаление | closed | — |
| #389 | [RMA-I033][P2] Собственные комнаты и дополнительные ingress: реальные media sessions и m | open | prio:P2, area:meeting-agents, screen:Meetings, type:feature, layer:backend, user-facing |
| #390 | [RMA-I034][P0] Release gates: сквозная приёмка M0–M3, rollout, kill switch и rollback | closed | — |

### 5.2 Golden Gate: живой срез

| Issue | Title | State | Labels |
|---|---|---|---|
| #541 | [Golden Gate] Компактная рабочая среда: навигация, панели, дизайн-система и проверка | open | prio:P0, area:golden-gate, type:ui-polish, layer:frontend, user-facing |
| #553 | [Golden Gate] Единые токены, типографика, смысловой текст и общие примитивы | open | prio:P0, area:golden-gate, screen:Design, type:ui-polish, layer:frontend, user-facing |
| #555 | [Golden Gate] Постоянная панель сервисов и контекстная навигация | open | prio:P0, area:golden-gate, screen:Home, type:ui-polish, layer:frontend, user-facing |
| #556 | [Golden Gate] Двумерная рабочая область 2×2 и 3×2 с сохранением размеров | open | prio:P0, area:golden-gate, screen:Home, type:feature, layer:frontend, user-facing |
| #557 | [Golden Gate] Пространственный фокус, скрытые панели и native lifecycle | open | prio:P0, area:golden-gate, screen:Home, type:feature, layer:frontend, user-facing |
| #558 | [Golden Gate] Чип устройства и ленивая read-only диагностика | open | prio:P0, area:golden-gate, screen:Runtime, type:feature, layer:frontend, user-facing |
| #559 | [Golden Gate] Единый временный статус в заголовке | open | prio:P0, area:golden-gate, screen:Home, type:feature, layer:frontend, user-facing |
| #560 | [Golden Gate] Контекстные предложения применить или сохранить skill/workflow | open | prio:P1, area:golden-gate, screen:Home, type:feature, layer:frontend, user-facing |
| #561 | [Golden Gate] Коллекции сессий: список, доска, таблица и heatmap | open | prio:P1, area:golden-gate, screen:Chat, type:ui-polish, layer:frontend, user-facing |
| #562 | [Golden Gate] Чат, composer, разрешения и session views | open | prio:P1, area:golden-gate, screen:Chat, type:ui-polish, layer:frontend, user-facing |
| #563 | [Golden Gate] Заметки: документ, rails, комментарии и свойства | open | prio:P1, area:golden-gate, screen:Notes, type:ui-polish, layer:frontend, user-facing |
| #564 | [Golden Gate] Заметки: таблица, canvas, outline, graph и map | open | prio:P1, area:golden-gate, screen:Notes, type:ui-polish, layer:frontend, user-facing |
| #565 | [Golden Gate] Knowledge: поиск, встроенные документы, inspector и review изменений | open | prio:P1, area:golden-gate, screen:Knowledge, type:ui-polish, layer:frontend, user-facing |
| #566 | [Golden Gate] Источники, навыки, память и Connection Fabric | open | prio:P1, area:golden-gate, screen:Knowledge, type:ui-polish, layer:frontend, user-facing |
| #567 | [Golden Gate] Проекты и личные задачи, включая выбор по deep link | closed | — |
| #568 | [Golden Gate] Встречи: каталог, запись, транскрипт и предложения | open | prio:P1, area:golden-gate, screen:Meetings, type:ui-polish, layer:frontend, user-facing |
| #569 | [Golden Gate] Автоматизации: расписания, граф, тестирование и история | open | prio:P1, area:golden-gate, type:ui-polish, layer:frontend, user-facing |
| #570 | [Golden Gate] Pages: библиотека, preview, grants и совместное использование | open | prio:P1, area:golden-gate, type:ui-polish, layer:frontend, user-facing |
| #571 | [Golden Gate] Browser, terminal, extensions и cloud run: поверхности и совместимость мар | open | prio:P1, area:golden-gate, screen:Browser, type:ui-polish, layer:frontend, user-facing |
| #572 | [Golden Gate] Настройки аккаунта, privacy, connections и организаций | open | prio:P1, area:golden-gate, screen:Settings, type:ui-polish, layer:frontend, user-facing |
| #573 | [Golden Gate] Настройки Runtime, AI, App, Input и голос | open | prio:P1, area:golden-gate, screen:Settings, type:ui-polish, layer:frontend, user-facing |
| #574 | [Golden Gate] Settings hub, Appearance, Workspace, Context, Labels и Shortcuts | open | prio:P1, area:golden-gate, screen:Settings, type:ui-polish, layer:frontend, user-facing |
| #575 | [Golden Gate] Настройки Knowledge, Marketplace, Extensions и Import | open | prio:P1, area:golden-gate, screen:Settings, type:ui-polish, layer:frontend, user-facing |
| #576 | [Golden Gate] Настройки Permissions, Security, Messaging, Server и Cloud Runs | open | prio:P1, area:golden-gate, screen:Settings, type:ui-polish, layer:frontend, user-facing |
| #577 | [Golden Gate] Onboarding, workspace wizard, меню, preview и общие состояния | open | prio:P1, area:golden-gate, screen:Home, type:ui-polish, layer:frontend, user-facing |
| #578 | [Golden Gate] Приёмка Golden Gate: visual, functional, performance и Electron/macOS | open | prio:P0, area:golden-gate, type:tests, layer:infra |

### 5.3 Conation / Rox Unified / Macro

- Conation: #320 (closed), #321 (closed), #322 (closed), #323 (closed), #324 (closed), #325 (closed), #326 (closed), #327 (closed), #328 (closed), #329 (closed), #330 (closed), #331 (closed), #332 (closed), #333 (closed), #334 (closed), #335 (closed), #336 (closed), #337 (closed), #338 (closed), #339 (closed), #340 (closed), #341 (closed), #342 (closed), #1153 (open), #1154 (open), #1155 (open), #1229 (open); исходный `[ROX-AUD-012]` #333 — CLOSED.
- Rox Unified: epic #1536 (OPEN) — 50 work packages в 3 волнах; issues 1499–1536, закрыты [1499, 1502].
- ROX Macro: 52 issues `[ROX Macro][WP-01…WP-52]`, все OPEN, 1324–1375.
- ROX Suite: 76 issues, все OPEN, 1091–1291.

## 6. Что изменилось с прошлого прогона (2026-09-30 → сейчас)

| Факт | 2026-09-30 | Сейчас |
|---|---|---|
| PR программных документов | `feat/september-program-20260930` draft #1293 | **MERGED** 2026-10-03, документы в `main` |
| Количество Sep-карточек | 109 опубликовано | 109, все OPEN |
| `task-registry.json` productStatus | `NOT_STARTED` (в `recon-evidence.json` как конфликт) | `IN_PROGRESS`, 31 задача IN_PROGRESS / 78 NOT_RUN |
| Golden Gate | #541 + 25 детей | без изменений: 25 объявленных детей, #567 CLOSED |
| Rox Unified (Lark+Operately) | не существовал в реестре | epic #1536 + 35 issues, PR #1615/#1621/#1622/#1623/#1625/#1626 |
| Активные PR | — | 11 открытых PR, все с локальными pushed-ветками |

