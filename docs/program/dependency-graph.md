# Граф зависимостей программы

**Issue:** [#1157](https://github.com/rox-one/rox-one/issues/1157) · **наблюдение:** 2026-10-08T22:27:59Z · **источник рёбер:** `task-registry.json`
(109 задач, 464 рёбер, циклов — 0)

Все блоки ниже проверены парсером **mermaid@11** (см. §5); это отображение зарегистрированных
зависимостей, а не подтверждение исполнения.

## 1. Master-контур программы

```mermaid
flowchart LR
  ROOT["PROGRAM-01 #1157<br/>root, dependsOn = []"] --> RECON["RECON-01 #1158<br/>источники, dedup, активная работа"]
  RECON --> AUDIT["AUDIT-01 #1159<br/>фактический аудит экранов"]
  AUDIT --> DATA["DATA-01 #1212<br/>контракт сущности и синхронизации"]
  RECON --> DATA
  DATA --> SHARED["SHARED-01 #1160<br/>заморозка общих корней<br/>блокирует 103 задач"]
  SHARED --> DOMAINS["Доменные потоки<br/>knowledge · comm · work · runtime · delivery"]
  DOMAINS --> INTEGRATE["INTEGRATE-01 #1161<br/>последовательная интеграция"]
  INTEGRATE --> RELEASE["RELEASE-01 #1162<br/>финальная матрица, DoD не сужается"]
  classDef root fill:#dbeafe,stroke:#2b6cb0,stroke-width:2px
  classDef gate fill:#fff2cc,stroke:#b58900,stroke-width:2px
  class ROOT root
  class SHARED,DATA,RELEASE gate
```

## 2. Доменные контуры

```mermaid
flowchart TB
  SH["SHARED-01 #1160"]
  subgraph KB["knowledge"]
    N["NOTES-01/02/03<br/>#1163 · #1164 · #1165"]
    C["CANVAS-01/02<br/>#1166 · #1167"]
    M["MEMORY-01/02<br/>#1168 · #1169"]
    S["SEARCH-01 #1174"]
  end
  subgraph CM["comm"]
    CH["CHAT-01/02 · TEAMS-01..03"]
    CO["COLLAB-01..05"]
    IN["INTEGRATIONS-01..03 · SYNC-01"]
  end
  subgraph WK["work"]
    PR["PROJECTS-01 #1194 · OKR-01 #1193 · OKR-02 #1192"]
    TK["TASKS-01 #1195 · REMINDERS-01 #1201"]
    HM["HOME-01 #1196 · DASHBOARD-01 #1197 · INBOX-01 #1198"]
  end
  subgraph RT["runtime"]
    RU["RUNTIME-01/02 · REMOTE-01/02 · AUTOMATION-01/02"]
    AG["AGENT-BUDGET-01 #1213 · FOCUS-01 #1214 · AGENTCENTER-01 #1210"]
    BE["BACKEND-01 #1224 · BACKEND-02 #1225 · CLI-01 #1223"]
  end
  subgraph DL["delivery"]
    GG["GG-01 #1147 · GG-02 #1148 · GG-03 #1149"]
    RM["RMA-01 #1150 · RMA-02 #1151 · RMA-03 #1152"]
    CN["CONATION-AUTH-01 #1153 · CONATION-E2E-01 #1154<br/>CONATION-DELIVERY-01 #1155 · CONATION-SHARE-01 #1229"]
  end
  SH --> KB & CM & WK & RT & DL
```

## 3. Внешние цепочки блокировок

```mermaid
flowchart LR
  E385["#385 RMA-I029<br/>реальное E3 — OPEN"] --> E387["#387 RMA-I031<br/>поставка — HELD"]
  E385 --> R1["RMA-01 #1150"] --> R2["RMA-02 #1151"]
  E389["#389 RMA-I033 · P2"] -.-> R3["RMA-03 #1152<br/>proposal-audit"]
  GG541["#541 + 25 детей<br/>24 OPEN, #567 CLOSED"] --> GG3["GG-03 #1149"]
  E387 --> REL["RELEASE-01 #1162"]
  GG3 --> REL
  E389 -.-> REL
  REL --> ACC["Финальная матрица<br/>Linux · macOS · Windows · iOS"]
  classDef blocked fill:#fde2e2,stroke:#c53030
  classDef held fill:#fff2cc,stroke:#b58900
  class E385 blocked
  class E387 held
```

## 4. Кросс-программные связи (связаны, не дублируются)

```mermaid
flowchart LR
  SEP["September-программа<br/>#1157 + 109 задач"]
  UNI1["Rox Unified wave 1<br/>#1499…#1512 · 6 PR"]
  UNI2["Rox Unified wave 2<br/>#1513…#1534"]
  MAC["Macro integration<br/>52 WP · 61 экран · 219 контролов<br/>PREPARED_NOT_LAUNCHED"]
  SUITE["ROX Suite<br/>#1092…#1120 · #1261…#1291"]
  ORIG["Первичные деревья<br/>RMA #356 · GG #541 · Conation #333"]
  UNI1 -->|замороженные контракты| UNI2
  SEP -.->|сверка scope| UNI1
  SEP -.->|сверка scope| UNI2
  SEP -.->|сверка scope| SUITE
  MAC -.->|reuse требований, не кода| SEP
  ORIG -->|residual / acceptance| SEP
```

## 5. Проверка графов

| Проверка | Результат |
|---|---|
| Все блоки `mermaid` распарсены `mermaid@11.17.2` | PASS (см. отчёт коммита) |
| Циклы в реестре задач | 0 |
| Дубликаты ID | нет |
| `PROGRAM-01` dependsOn | `[]` |
| Зависит от `SHARED-01` | 103 задач |
| Зависит от `DATA-01` | 77 задач |
| Зависит от `RELEASE-01` | 0 (цикл невозможен) |

