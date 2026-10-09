# RECON-01 — граф зависимостей (#1158)

- Наблюдение: **2026-10-08T22:20:00Z**, база чтения — `origin/main` @ `8c5abc7a32a3773645b695b79a81c327b8e6758d`.
- Источник рёбер: `docs/september-program/task-registry.json` (109 задач, 464 ребра) плюс ссылки в телах issues.
- Граф ниже — **отображение зарегистрированных зависимостей**, а не подтверждение исполнения.

## 1. Критический путь программы

```mermaid
flowchart LR
  PROGRAM01["PROGRAM-01<br/>#1157<br/>IN_PROGRESS"] --> RECON01["RECON-01<br/>#1158<br/>IN_PROGRESS"]
  RECON01 --> AUDIT01["AUDIT-01<br/>#1159<br/>NOT_RUN"]
  RECON01 --> DATA01["DATA-01<br/>#1212<br/>IN_PROGRESS"]:::contra
  AUDIT01 --> DATA01
  DATA01 --> SHARED01["SHARED-01<br/>#1160<br/>IN_PROGRESS"]:::contra
  SHARED01 --> ATOMIC["103 задач зависят от SHARED-01"]
  ATOMIC --> INTEGRATE["INTEGRATE-01<br/>#1161<br/>IN_PROGRESS"]
  INTEGRATE --> RELEASE["RELEASE-01<br/>#1162<br/>NOT_RUN"]
  classDef contra fill:#fff2cc,stroke:#b58900,stroke-width:2px
```

## 2. Волны внутри программы (свёрнутый вид)

```mermaid
flowchart TB
  subgraph W0["Слой 0 — программа"]
    P["PROGRAM-01 #1157"]
    R["RECON-01 #1158"]
  end
  subgraph W1["Слой 1 — факты о поверхности"]
    AU["AUDIT-01 #1159"]
    DE["DECISION-01 #1156 (U25, FALSE)"]
  end
  subgraph W2["Слой 2 — общие контракты"]
    DA["DATA-01 #1212"]
    SH["SHARED-01 #1160"]
  end
  subgraph W3["Слой 3 — домены"]
    D1["knowledge: NOTES/CANVAS/MEMORY/SEARCH"]
    D2["comm: CHAT/TEAMS/COLLAB/INTEGRATIONS/SYNC"]
    D3["work: PROJECTS/OKR/TASKS/HOME/DASHBOARD/INBOX"]
    D4["runtime: RUNTIME/REMOTE/AUTOMATION/AGENTS/CLI/BACKEND"]
    D5["delivery: GG/RMA/CONATION"]
  end
  subgraph W4["Слой 4 — сборка и приёмка"]
    I["INTEGRATE-01 #1161"]
    REL["RELEASE-01 #1162"]
  end
  P --> R --> AU --> DA --> SH
  AU --> DE
  SH --> D1 & D2 & D3 & D4 & D5
  D1 & D2 & D3 & D4 & D5 --> I --> REL
```

## 3. Внешние зависимости программы (первичные деревья)

```mermaid
flowchart TB
  RMA01["RMA-01 #1150<br/>реальный E3"]:::inprog
  RMA02["RMA-02 #1151<br/>поставка"]:::notrun
  RMA03["RMA-03 #1152<br/>комнаты/ingress"]:::notrun
  GG01["GG-01 #1147"]:::notrun
  GG02["GG-02 #1148"]:::notrun
  GG03["GG-03 #1149<br/>приёмка"]:::notrun
  C1["CONATION-DELIVERY-01 #1155"]:::notrun
  C2["CONATION-AUTH-01 #1153"]:::notrun
  C3["CONATION-E2E-01 #1154"]:::notrun
  C4["CONATION-SHARE-01 #1229"]:::notrun
  RMA01 --> RMA02
  GG01 --> GG02 --> GG03
  C1 --> C2 --> C3
  C2 --> C4
  RMA01 -.->|эквивалент| E385["#385 RMA-I029"]:::ext
  RMA02 -.-> E387["#387 RMA-I031"]:::ext
  RMA03 -.-> E389["#389 RMA-I033 (P2)"]:::ext
  GG01 -.-> E556["#556"]:::ext
  GG02 -.-> E557["#557 + #558"]:::ext
  GG03 -.-> E541["#541 + #578 (25 детей)"]:::ext
  classDef inprog fill:#ffe9b0,stroke:#b58900
  classDef notrun fill:#eee,stroke:#888
  classDef ext fill:#e6f2ff,stroke:#2b6cb0,stroke-dasharray: 4 3
```

## 4. Кросс-программные зависимости

```mermaid
flowchart LR
  SEP["September-программа<br/>#1157 + 109 карточек"]
  W1["Rox Unified wave 1<br/>#1499…#1512"]
  W2["Rox Unified wave 2<br/>#1513…#1534"]
  MAC["Macro integration<br/>52 WP — PREPARED_NOT_LAUNCHED"]
  ORIG["Первичные деревья<br/>RMA #356 / GG #541 / Conation #333"]
  W1 -->|замороженные контракты| W2
  SEP -.->|сверка scope| W1
  SEP -.->|сверка scope| W2
  MAC -.->|только reuse после проверки прав| SEP
  ORIG -->|residual/acceptance| SEP
```

## 5. Разблокировки: что реально держит очередь

| Блокер | Держит | Условие снятия |
|---|---|---|
| SHARED-01 #1160 | 103 задач | принятие DATA-01 #1212 |
| DATA-01 #1212 | 77 задач | принятая версия контракта сущности/ревью |
| AUDIT-01 #1159 | 24 задач UI-слоя | фактический аудит экранов на живой сборке |
| #385 E3 | RMA-02 #1151, GG-03 #1149, RELEASE-01 #1162 | реальное E3-доказательство (merge #991 не является приёмкой) |
| U25 / DECISION-01 #1156 | ничего не должно блокировать | независимый достоверный источник; до него выключено |
| Windows / macOS / iOS-приёмка | RELEASE-01 | собственные наблюдения на каждой платформе |

