# Сводная матрица: требование → владелец → статус → доказательство

**Issue:** [#1157](https://github.com/rox-one/rox-one/issues/1157) · **наблюдение:** 2026-10-08T22:27:59Z · **база:** `origin/main` @ `8c5abc7a32a3773645b695b79a81c327b8e6758d`

Матрица собирает три уровня: подтверждённые U-группы, отдельное решение U25 и 16 строк Conation seq703.
Столбец «статус» берётся из `task-registry.json`; столбец «доказательство» указывает, **где** состояние
подтверждается, и не заявляет приёмку там, где её нет.

## 1. Подтверждённые группы U01–U31 (30 групп, 484 строки)

> U25 намеренно отсутствует в этой таблице: у неё 0 строк требований, она вынесена в §2.

| U | Строк | Вид строк | Первичный владелец (задача · issue · статус) | Доказательство |
|---|---|---|---|---|
| **U01** | 15 | verification-gap=15 | AUDIT-01 · #1159 · NOT_RUN ×6; FEED-01 · #1202 · NOT_RUN ×3; HOME-01 · #1196 · NOT_RUN ×2; NOTES-01 · #1163 · IN_PROGRESS ×1; TASKS-01 · #1195 · NOT_RUN ×1; MEMORY-02 · #1169 · IN_PROGRESS ×1; IMPORTS-01 · #1173 · IN_PROGRESS ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1159](https://github.com/rox-one/rox-one/issues/1159) |
| **U02** | 8 | requested=7, verification-gap=1 | MAIL-01 · #1181 · NOT_RUN ×7; MAIL-02 · #1182 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1181](https://github.com/rox-one/rox-one/issues/1181) |
| **U03** | 1 | verification-gap=1 | VOICE-01 · #1185 · IN_PROGRESS ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1185](https://github.com/rox-one/rox-one/issues/1185) |
| **U04** | 3 | requested=3 | VOICE-02 · #1186 · IN_PROGRESS ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1186](https://github.com/rox-one/rox-one/issues/1186) |
| **U05** | 7 | requested=6, verification-gap=1 | MEETINGS-01 · #1187 · IN_PROGRESS ×6; MEETINGS-02 · #1190 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1187](https://github.com/rox-one/rox-one/issues/1187) |
| **U06** | 4 | requested=4 | UX-01 · #1136 · NOT_RUN ×3; DESIGN-01 · #1138 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1136](https://github.com/rox-one/rox-one/issues/1136) |
| **U07** | 3 | requested=3 | DESIGN-01 · #1138 · NOT_RUN ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1138](https://github.com/rox-one/rox-one/issues/1138) |
| **U08** | 4 | requested=4 | ONBOARD-01 · #1139 · NOT_RUN ×4 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1139](https://github.com/rox-one/rox-one/issues/1139) |
| **U09** | 6 | verification-gap=6 | PROJECTS-01 · #1194 · IN_PROGRESS ×6 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1194](https://github.com/rox-one/rox-one/issues/1194) |
| **U10** | 4 | requested=4 | CHAT-02 · #1122 · NOT_RUN ×3; CHAT-01 · #1121 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1122](https://github.com/rox-one/rox-one/issues/1122) |
| **U11** | 4 | requested=4 | NATIVE-01 · #1145 · NOT_RUN ×4 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1145](https://github.com/rox-one/rox-one/issues/1145) |
| **U12** | 6 | requested=5, verification-gap=1 | MARKETPLACE-01 · #1172 · IN_PROGRESS ×4; SETTINGS-01 · #1144 · NOT_RUN ×1; UX-01 · #1136 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1172](https://github.com/rox-one/rox-one/issues/1172) |
| **U13** | 3 | requested=3 | QUEST-01 · #1203 · IN_PROGRESS ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1203](https://github.com/rox-one/rox-one/issues/1203) |
| **U14** | 4 | requested=4 | TEAMS-01 · #1123 · NOT_RUN ×2; TEAMS-02 · #1124 · NOT_RUN ×1; TEAMS-03 · #1125 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1123](https://github.com/rox-one/rox-one/issues/1123) |
| **U15** | 5 | requested=5 | THEME-01 · #1140 · NOT_RUN ×5 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1140](https://github.com/rox-one/rox-one/issues/1140) |
| **U16** | 3 | verification-gap=3 | CANVAS-01 · #1166 · NOT_RUN ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1166](https://github.com/rox-one/rox-one/issues/1166) |
| **U17** | 8 | requested=6, verification-gap=2 | INTEGRATIONS-02 · #1132 · NOT_RUN ×5; INTEGRATIONS-01 · #1131 · NOT_RUN ×1; IMPORTS-01 · #1173 · IN_PROGRESS ×1; INTEGRATIONS-03 · #1135 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1132](https://github.com/rox-one/rox-one/issues/1132) |
| **U18** | 9 | requested=9 | COLLAB-05 · #1130 · NOT_RUN ×3; COLLAB-01 · #1126 · IN_PROGRESS ×2; COLLAB-04 · #1129 · NOT_RUN ×2; COLLAB-03 · #1128 · NOT_RUN ×1; SYNC-01 · #1133 · IN_PROGRESS ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1130](https://github.com/rox-one/rox-one/issues/1130) |
| **U19** | 3 | requested=3 | AGENT-BUDGET-01 · #1213 · IN_PROGRESS ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1213](https://github.com/rox-one/rox-one/issues/1213) |
| **U20** | 3 | requested=3 | FOCUS-01 · #1214 · IN_PROGRESS ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1214](https://github.com/rox-one/rox-one/issues/1214) |
| **U21** | 3 | proposal-audit=1, requested=2 | AUTOMATION-01 · #1215 · IN_PROGRESS ×1; AUTOMATION-02 · #1216 · NOT_RUN ×1; SCHEDULED-02 · #1218 · IN_PROGRESS ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1215](https://github.com/rox-one/rox-one/issues/1215) |
| **U22** | 4 | requested=3, verification-gap=1 | REMOTE-01 · #1219 · NOT_RUN ×3; REMOTE-02 · #1220 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1219](https://github.com/rox-one/rox-one/issues/1219) |
| **U23** | 5 | requested=2, verification-gap=3 | UX-01 · #1136 · NOT_RUN ×2; L10N-01 · #1142 · IN_PROGRESS ×1; TASKS-01 · #1195 · NOT_RUN ×1; SETTINGS-01 · #1144 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1136](https://github.com/rox-one/rox-one/issues/1136) |
| **U24** | 3 | requested=3 | WINDOWS-01 · #1146 · NOT_RUN ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1146](https://github.com/rox-one/rox-one/issues/1146) |
| **U26** | 343 | decision-reconciliation=8, requested=298, verification-gap=37 | CONATION-E2E-01 · #1154 · NOT_RUN ×101; CONATION-AUTH-01 · #1153 · NOT_RUN ×32; DASHBOARD-01 · #1197 · NOT_RUN ×27; CANVAS-02 · #1167 · NOT_RUN ×19; L10N-01 · #1142 · IN_PROGRESS ×19; MAIL-04 · #1184 · NOT_RUN ×18; INBOX-01 · #1198 · NOT_RUN ×14; A11Y-01 · #1143 · NOT_RUN ×14; CALENDAR-01 · #1199 · NOT_RUN ×12; DRIVE-01 · #1175 · NOT_RUN ×11; CRM-01 · #1200 · NOT_RUN ×11; TASKS-01 · #1195 · NOT_RUN ×10; SEARCH-01 · #1174 · NOT_RUN ×9; PAYMENTS-01 · #1211 · NOT_RUN ×8; SPREADSHEET-01 · #1178 · NOT_RUN ×7; CONATION-DELIVERY-01 · #1155 · NOT_RUN ×6; REMINDERS-01 · #1201 · NOT_RUN ×6; AGENTCENTER-01 · #1210 · NOT_RUN ×5; CONATION-SHARE-01 · #1229 · NOT_RUN ×3; NOTES-03 · #1165 · NOT_RUN ×3; PDF-01 · #1179 · IN_PROGRESS ×3; SPLIT-01 · #1180 · NOT_RUN ×3; ACTIVITY-01 · #1206 · NOT_RUN ×2 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1154](https://github.com/rox-one/rox-one/issues/1154) |
| **U27** | 3 | verification-gap=3 | RMA-01 · #1150 · IN_PROGRESS ×3 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1150](https://github.com/rox-one/rox-one/issues/1150) |
| **U28** | 6 | verification-gap=6 | RMA-02 · #1151 · NOT_RUN ×6 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1151](https://github.com/rox-one/rox-one/issues/1151) |
| **U29** | 5 | proposal-audit=1, requested=1, verification-gap=3 | MAIL-03 · #1183 · NOT_RUN ×2; CRM-01 · #1200 · NOT_RUN ×1; CALENDAR-01 · #1199 · NOT_RUN ×1; RMA-03 · #1152 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1183](https://github.com/rox-one/rox-one/issues/1183) |
| **U30** | 3 | verification-gap=3 | GG-02 · #1148 · NOT_RUN ×2; GG-01 · #1147 · NOT_RUN ×1 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1148](https://github.com/rox-one/rox-one/issues/1148) |
| **U31** | 6 | verification-gap=6 | GG-03 · #1149 · NOT_RUN ×6 | [`requirements-full.json`](../september-program/requirements-full.json) + [#1149](https://github.com/rox-one/rox-one/issues/1149) |

Итого строк: **484** (совпадает с `requirements-full.json`: 484 исторические строки + 5 строк OKR-дополнения = 489).

## 2. U25 — отдельное неразрешённое решение

| Поле | Значение |
|---|---|
| Строк требований | 0 (не feature) |
| Владелец | `OwnerDecisionReconciliation` · [#1156](https://github.com/rox-one/rox-one/issues/1156) · open |
| Вид | decision-reconciliation |
| Диспозиция | decision-reconciliation only; FALSE/shortcut-only сохраняется, изменения не авторизованы |
| Доказательство | [`docs/september-program/recon-1158/unconfirmed.md`](../september-program/recon-1158/unconfirmed.md) §2; `source-backlog.md` §U25 |

## 3. Conation: 16 строк seq703

Каждая строка — из чек-листа `source-backlog.md` («Conation U26: detailed remaining checklist»).
Построчная привязка владельцев — в `requirements-conation-owners.json` (343 строки);
здесь — ровно 16 верхнеуровневых acceptance-строк, без сведения к общему smoke.

| # | Строка seq703 | Владелец (задача · issue) | Статус | Доказательство / пробел |
|---|---|---|---|---|
| C01 | Authenticated populated data | CONATION-AUTH-01 · #1153; INBOX-01 · #1198; DRIVE-01 · #1175; MAIL-04 · #1184; TASKS-01 · #1195; AGENTCENTER-01 · #1210; CRM-01 · #1200 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C02 | Branch completion/delivery | CONATION-DELIVERY-01 · #1155 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C03 | Login/onboarding | CONATION-AUTH-01 · #1153; L10N-01 · #1142; A11Y-01 · #1143 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C04 | Working E2E | CONATION-E2E-01 · #1154 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C05 | Tauri/Mac desktop | CONATION-E2E-01 · #1154 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C06 | Dashboard composition | DASHBOARD-01 · #1197; CANVAS-02 · #1167 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C07 | Inbox | INBOX-01 · #1198 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C08 | Drive | DRIVE-01 · #1175; L10N-01 · #1142 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C09 | Mail | MAIL-04 · #1184 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C10 | Chat | CONATION-E2E-01 · #1154 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C11 | Tasks | TASKS-01 · #1195; INBOX-01 · #1198 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C12 | Agents | AGENTCENTER-01 · #1210; CONATION-E2E-01 · #1154; A11Y-01 · #1143; CANVAS-02 · #1167 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C13 | Notes/documents/canvas | NOTES-03 · #1165; CANVAS-02 · #1167; SPREADSHEET-01 · #1178; PDF-01 · #1179 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C14 | Other screens | CALENDAR-01 · #1199; CRM-01 · #1200; SEARCH-01 · #1174; PAYMENTS-01 · #1211; REMINDERS-01 · #1201; ACTIVITY-01 · #1206; CONATION-SHARE-01 · #1229; SPLIT-01 · #1180 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C15 | Global motion and typography acceptance | A11Y-01 · #1143; CONATION-E2E-01 · #1154 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |
| C16 | Operational conditions still unresolved in transcript | CONATION-E2E-01 · #1154; CONATION-DELIVERY-01 · #1155 | NOT_RUN | `requirements-conation.json` (343 строки), [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) |

**Порядок счёта подтверждён: 16/16**, включая строку 16 (операционные зависимости: SQS `QueueDoesNotExist`,
otel-collector, Lexical). Эти зависимости фиксируются как условие проверки, а не как новая задача развёртывания.

## 4. Предложения и решения: НЕ авторизуют имплементацию

| Задача | Issue | Владелец | Вид |
|---|---|---|---|
| RMA-03 | [#1152](https://github.com/rox-one/rox-one/issues/1152) | OwnerRma | proposal-audit |
| MEETINGS-03 | [#1191](https://github.com/rox-one/rox-one/issues/1191) | OwnerMeetings | proposal-audit |
| ARENA-01 | [#1204](https://github.com/rox-one/rox-one/issues/1204) | OwnerArena | proposal-audit |
| COUNCIL-01 | [#1205](https://github.com/rox-one/rox-one/issues/1205) | OwnerCouncil | proposal-audit |
| SCHEDULED-01 | [#1217](https://github.com/rox-one/rox-one/issues/1217) | OwnerScheduled | proposal-audit |
| SCHEDULED-02 | [#1218](https://github.com/rox-one/rox-one/issues/1218) | OwnerScheduled | proposal-audit |
| BACKEND-01 | [#1224](https://github.com/rox-one/rox-one/issues/1224) | OwnerBackend | proposal-audit |
| ORCHESTRATION-01 | [#1226](https://github.com/rox-one/rox-one/issues/1226) | OwnerOrchestration | proposal-audit |
| SESSIONS-01 | [#1227](https://github.com/rox-one/rox-one/issues/1227) | OwnerSessions | proposal-audit |
| CODING-01 | [#1228](https://github.com/rox-one/rox-one/issues/1228) | OwnerAgents | proposal-audit |
| DECISION-01 | [#1156](https://github.com/rox-one/rox-one/issues/1156) | `OwnerDecisionReconciliation` | decision-reconciliation |

Ни одна строка выше не даёт полномочий на изменение поведения: предложения собирают факты и варианты,
решение U25 остаётся неразрешённым.

## 5. Деревья первичных issues (владельцы внешнего объёма)

| Дерево | Состояние | Владелец в программе |
|---|---|---|
| RMA #356 (закрыт) / I001–I034 | CLOSED #357…#379, #383/#384/#386/#388/#390; OPEN #380/#381/#382/#385/#387/#389 | `OwnerRma` (RMA-01/02/03) |
| Golden Gate #541 + 25 детей | 24 OPEN, #567 CLOSED | `OwnerGoldenGate` (GG-01/02/03) |
| Conation (донор `macro-inc/macro`) | #333 CLOSED; карточки #1153/#1154/#1155/#1229 OPEN | `OwnerConation` |
| ROX Macro WP-01…#WP-52 | 52 OPEN, `PREPARED_NOT_LAUNCHED` | связан, не запускается |
| ROX Suite (#1092…#1120, #1261…#1291) | OPEN | отдельный план, связан по scope |
| Rox Unified #1536 (epic) + #1499…#1534 | OPEN; 6 открытых PR | отдельный план, связан по scope |

Дубликатов не создаётся: сентябрьские карточки — residual/verification над первичными issues
(пары `#1150→#385`, `#1151→#387`, `#1152→#389`, `#1147→#556`, `#1148→#557+#558`, `#1149→#541+#578`, `#1183→#380`).

