---
rx-id: RX-DOC-0006
title: Незакрытая работа из бэкапов сессий
---

# Незакрытая работа из бэкапов сессий

Документ извлекает незакрытую работу из десяти приватных recovery-репозиториев
аккаунта `agisota` от 2026-08-21. Это отдельный источник изменений: ни один из
чекпоинтов не переносился в `rox-one/rox-one` как ветка или патч.

Источник читался через GitHub Contents API (`METADATA.json`, `README.md`,
размер `RECOVERY.patch`, коммиты, `tasks/*.md`, ключевые спеки). Фильтр:
в периметр попадает только работа, применимая к монорепо `rox-one`
(форк Craft Agents). Задачи `RX-TSK-0400`…`RX-TSK-0420` выданы только для
этого периметра; у каждой есть поле `origin`.

Связанные записи: `RX-SES-0001`…`RX-SES-0010`, `RX-TSK-0400`…`RX-TSK-0420`.

## Сводная таблица сессий

| Код | Репозиторий | Тема | В периметре | Задач |
|---|---|---|---|---|
| `RX-SES-0001` | `session-recovery-20260821-craft-agents` | Connection Fabric inspector, программа A+B+C | да | 2 |
| `RX-SES-0002` | `session-recovery-20260821-craft-agents-cf2-restored` | Платформа команд OMP, CF-2 UI миграции | да | 3 |
| `RX-SES-0003` | `session-recovery-20260821-repo` | Патч правил `react-best-practices` в installer | нет | 0 |
| `RX-SES-0004` | `session-recovery-20260821-macro` | Чекпоинт `yolo-garden/macro` | нет | 0 |
| `RX-SES-0005` | `session-recovery-20260821-marklindgreen` | Вложенный `rox-one/`: sidecar + WP-UI | да | 3 |
| `RX-SES-0006` | `session-recovery-20260821-rox-system-diagrams` | Пакет системных диаграмм | нет | 0 |
| `RX-SES-0007` | `session-recovery-20260821-rox-font-reference-family` | Семейство шрифта ROX Mono | нет | 0 |
| `RX-SES-0008` | `session-recovery-20260821-do-it-all-security-slices` | SI W1–W5, CF-4 RPC, Notes, branding | да | 8 |
| `RX-SES-0009` | `session-recovery-20260821-security-external-access-20260811` | TLS, messaging authority, microVM | да | 5 |
| `RX-SES-0010` | `session-recovery-20260821-home-rox-api-network-diagnosis-20260820` | Инцидент OmniRoute / `api.rox.one` | нет | 0 |

Итого: **5 сессий в периметре**, **21 задача**.

Метаданные чекпоинтов (все приватные, созданы 2026-08-21):

| Код | Ветка чекпоинта | `METADATA.json` | `RECOVERY.patch` |
|---|---|---|---|
| `RX-SES-0001` | `checkpoint/session-audit-20260821-craft-agents` | нет (полный снимок дерева) | нет |
| `RX-SES-0002` | `checkpoint/session-audit-20260821-craft-agents-cf2-restored` | нет (полный снимок) | нет |
| `RX-SES-0003` | `checkpoint-patch/session-audit-20260821-repo` | есть | 19 232 байт, прочитан целиком |
| `RX-SES-0004` | `checkpoint-patch/session-audit-20260821-macro` | есть | 4 835 299 байт, только заголовки |
| `RX-SES-0005` | `checkpoint/session-audit-20260821-marklindgreen` | нет (sparse home) | нет |
| `RX-SES-0006` | `checkpoint/session-audit-20260821-rox-system-diagrams` | нет | нет |
| `RX-SES-0007` | `checkpoint/session-audit-20260821-rox-font-reference-family` | нет | нет |
| `RX-SES-0008` | `checkpoint/session-audit-20260821-do-it-all-security-slices` | нет (полный снимок) | нет |
| `RX-SES-0009` | `checkpoint/session-audit-20260821-security-external-access-20260811` | нет (полный снимок) | нет |
| `RX-SES-0010` | `checkpoint/session-audit-20260821-home-rox-api-network-diagnosis-20260820` | нет (sparse home) | нет |

---

## `RX-SES-0001` — craft-agents

**Репозиторий:** `agisota/session-recovery-20260821-craft-agents`  
**Тема:** основной checkout Craft Agents; программа A+B+C и доводка UI Connection Fabric.  
**HEAD чекпоинта:** `2ec65ab1` (`chore(recovery): checkpoint terminal sessions 20260821`).

### Что сделано в сессии

В `tasks/todo.md` и `tasks/plan.md` закрыты: live A0-preflight, Gate 0 как BLOCK,
CF-1…CF-9.7 на этом дереве (брокер, гранты, WorkGraph, RPC, GitHub/Infisical/импортёры,
инспектор, test/repair/rotate, convert copy→reference). Increment B (режимы
`public-inbox` / `owner-control` / `disabled`) помечен выполненным **на том дереве**.
21 августа поверх этого пошли десятки коммитов `feat(connections):` — скрытие пустых
полей, i18n меток, testid, in-place test/repair/revoke/convert/move на Services,
Policies и инспекторе.

В текущем `rox-one` базовая поверхность CF-5…CF-8 уже есть
(`ConnectionsPage`, брокер, гранты, PR `#42` / `#48`), но **августовская доводка
инспектора в `main` не попала**. Increment B тоже не в этом дереве: messaging
по-прежнему `inherit` / `allow-list` / `open` — перенос идёт задачей `RX-TSK-0416`
из `RX-SES-0009`.

### Что осталось незакрытым

- Доводка инспектора Connections (пустые плейсхолдеры, testid, in-place операции)
  не перенесена.
- Опциональный дефолт-лейбл для OMP-провайдера (остаток `docs/omp-integration-gap.md` §5).
- `АПPLY HMA-20260809-A1` и Gate 0 owner names — хост-операции / блок владельца,
  см. `RX-TSK-0420`.
- Notes / managed SiYuan сознательно не стартовали.
- Триаж веток `feat/shell-ext-activate2` и `fix/sandbox-env-strip` относился к
  `agisota/craft-agents-oss`, не к этому remote; отдельную задачу не заводим.

### Задачи

| id | title | status |
|---|---|---|
| `RX-TSK-0400` | Перенести доводку инспектора Connection Fabric | `planned` |
| `RX-TSK-0401` | Дефолт-лейбл для сессий OMP-провайдера | `planned` |

---

## `RX-SES-0002` — craft-agents-cf2-restored

**Репозиторий:** `agisota/session-recovery-20260821-craft-agents-cf2-restored`  
**Тема:** восстановленная ветка `cf2-credential-migration` плюс платформа команд OMP.  
**HEAD чекпоинта:** `6fe6dd0e`.

### Что сделано в сессии

Коммиты 2026-08-20 закрывают фазы OMP **поверх** уже смерженного v2 (G1–G4):

- Phase 0+1 — инвентарь команд, ADR, omp-rpc client.
- Phase 2+3 — capability snapshot, product registry, Command Gateway.
- Phase 4+5 — UI интеграции agent command platform.
- Phase 6a — `AdvancedConsole` для shell-команд.
- Phase 6b — `ExtensionUiDialogHost` для интерактивных OMP-запросов.
- Phase 7 — канонический export/dump как craft actions.
- Real share + copy craft actions.
- Typed implicit-fallback recovery (ADR D3/D8).

Спеки, которых нет в текущем дереве:

- `docs/specs/2026-08-20-omp-command-platform-adr.md`
- `docs/specs/2026-08-20-omp-17.2.10-command-inventory.{md,json}`
- `docs/superpowers/specs/2026-08-19-controlled-credential-migration-ui-design.md` (Approved, реализация не начата)
- `docs/superpowers/specs/2026-08-09-openclaw-security-dashboard-design.md` (черновик)

В текущем `rox-one` нет `AdvancedConsole.tsx`, `AgentCommandActivity.tsx`,
`ExtensionUiDialogHost.tsx`. OMP v2 (G1–G4) уже в `main`; command platform — нет.

### Что осталось незакрытым

- Весь контур Command Gateway / Advanced Console / share-copy-export не перенесён.
- UI контролируемой миграции CF-2 (preview / apply / rollback, без секретов в renderer)
  — дизайн утверждён, кода нет.
- Панель аудита OpenClaw — черновик, не реализовывался.
- `'omp'` в `getAvailableProviders` в ADR D8 оставлен открытой задачей, не скрытым дефолтом.

### Задачи

| id | title | status |
|---|---|---|
| `RX-TSK-0402` | Перенести платформу команд OMP (фазы 0–7) | `planned` |
| `RX-TSK-0403` | UI контролируемой миграции credentials CF-2 | `planned` |
| `RX-TSK-0404` | Панель аудита OpenClaw (черновик дизайна) | `planned` |

---

## `RX-SES-0005` — marklindgreen

**Репозиторий:** `agisota/session-recovery-20260821-marklindgreen`  
**Тема:** sparse-снимок домашнего каталога; в периметр входит только вложенный
`rox-one/` с закрытым циклом (Rust sidecar + WP-UI).  
**HEAD чекпоинта:** `11f72f0c` (sparse paths).

### Что сделано в сессии

Во вложенном `rox-one/` (это **не** текущее дерево Craft Agents, а параллельный
закрытый цикл, который никогда не вливался):

- `rox-sidecar/` — Cargo workspace: `rox-actions`, `rox-api`, `rox-cases`,
  `rox-connectors`, `rox-evals`, `rox-events`, `rox-graph`, `rox-policy`,
  `rox-projectors`, `rox-types`, `rox-verifiers`.
- `docs/wp-ui/` — исполняемые спеки поверхностей: shell, inbox, tasks, CRM, chat,
  docs, canvas, mail, calls. Запись только через `command.propose`.
- `apps/electron/` — каркас WP-UI-SHELL, mock-режим `ROX_UI_MOCK=1`, sidecar
  `127.0.0.1:7420`.
- Коммит `d48efe66` `feat(rox): approval flow — command.approve/deny end-to-end
  with restart-safe action store`.

Остальная часть снимка (`.claude` hooks, fleet OmniRoute, DSH, HMA apply-tools)
к монорепо не относится.

### Что осталось незакрытым

- Sidecar, WP-UI и approval store не существуют в текущем `rox-one`.
- Первым шагом нужен выбор владельца: поглотить закрытый цикл в это монорепо
  или официально парковать. Задачи заведены как `planned`, не как `dropped`.

### Задачи

| id | title | status |
|---|---|---|
| `RX-TSK-0405` | Решить судьбу и перенести `rox-sidecar` | `planned` |
| `RX-TSK-0406` | Перенести WP-UI поверхности закрытого цикла | `planned` |
| `RX-TSK-0407` | Перенести `command.approve` / `command.deny` | `planned` |

---

## `RX-SES-0008` — do-it-all-security-slices

**Репозиторий:** `agisota/session-recovery-20260821-do-it-all-security-slices`  
**Тема:** worktree `_craft_worktrees/do-it-all-security-slices`; product-security
срезы и локальный каталог session intelligence.  
**HEAD чекпоинта:** `a8673fd6`. Worktree от `99cd5ea9e`.

### Что сделано в сессии

По `tasks/todo.md` на **этом** worktree закрыты: `MIGRATE_NOTES → LOCAL_ONLY`,
OwnedRootPolicy + абсолютные import paths, CF-2 quarantine, session intelligence
W1–W5 (локальный каталог, review inbox, 280-символьный потолок, audit без текста
кандидата), ремонт IPC renderer capability, инвентарь
`docs/security/2026-08-13-do-it-all-inventory.md`. Сфокусированные тесты:
167 pass / 0 fail (2026-08-19).

HMA revision 3: офлайн-ремонт бандла утверждён сообщением
`APPROVE HMA-20260809-A1-R3 REMEDIATION`; live APPLY и A1–A3 **не** выполнялись.
Это хост-операции Hermes/Tailscale/Syncthing, не код монорепо — в `RX-TSK` не
выносим. Бренд-чартер позже подписан (`SIGN: ROX / Craft Agents / agisota clone`);
сам README **не** правился.

В текущем `rox-one` нет `docs/security/`, нет `SessionIntelligencePanel`,
`identity.connect` по-прежнему принимает `credentialValue`, `CONFIG_DIR`
вычисляется на import time, clone в README всё ещё `lukilabs/craft-agents-oss`.

### Что осталось незакрытым

- Перенос W1–W5 SI в это дерево.
- PSI W6 (prompt inject) и W8 (sync) явно не включать.
- Снять `credentialValue` с RPC `identity.connect`.
- UI импорта Notes (канал `LOCAL_ONLY` есть, UI — нет).
- Довести OwnedRootPolicy: ленивый `getConfigDir()`, дефолт остаётся `~/.craft-agent`.
- Поменять clone URL README (сейчас `lukilabs`, план требовал `agisota`; актуальный
  канон — `rox-one/rox-one`).
- Перенести корпус `docs/security/*`.
- Gate 0: имена datastore и владельца microVM — блок владельца.

### Задачи

| id | title | status |
|---|---|---|
| `RX-TSK-0408` | Перенести session intelligence W1–W5 | `planned` |
| `RX-TSK-0409` | Удержать PSI W6–W8 за гейтом | `planned` |
| `RX-TSK-0410` | Убрать `credentialValue` из `identity.connect` | `planned` |
| `RX-TSK-0411` | UI импорта Notes | `planned` |
| `RX-TSK-0412` | Довести OwnedRootPolicy | `planned` |
| `RX-TSK-0413` | Исправить clone URL в README | `planned` |
| `RX-TSK-0414` | Перенести корпус `docs/security` | `planned` |
| `RX-TSK-0420` | Собрать факты Gate 0 у владельца | `blocked` |

---

## `RX-SES-0009` — security-external-access-20260811

**Репозиторий:** `agisota/session-recovery-20260821-security-external-access-20260811`  
**Тема:** внешний доступ: TLS remote, messaging authority, изоляция исполнения.  
**HEAD чекпоинта:** `e77fdb46`. План стабилизации:
`docs/superpowers/plans/2026-08-19-external-access-stabilization-plan.md`.

Заметка в самом плане («это не проект rox-one») означает «не OmniRoute и не
прод-сервер». Кодовая база — тот же Craft Agents, то есть это монорепо.

### Что сделано в сессии (на том дереве, в `main` не влито)

| Коммит | Суть |
|---|---|
| `9d188fb8` | Origin-scoped remote TLS; убран глобальный обход сертификата; SPKI pin |
| `5d172d25` | Default-deny public inbound: `public-inbox` / `owner-control` / `disabled` |
| `72086646` | Контракт «исполнение в microVM»; поставка образа не утверждена |
| `aad35d0f` / `6fbab258` / `9d3d7329` | Peer trust handshake, persist TLS pins |

### Что осталось незакрытым

В текущем дереве:

- `apps/electron/src/main/handlers/workspace.ts` и
  `apps/electron/src/preload/bootstrap.ts` всё ещё ставят
  `tlsRejectUnauthorized: false`.
- `BindingAccessMode` = `'inherit' | 'allow-list' | 'open'`; свежие биндинги
  дефолтятся в `inherit`, миграция — в `open`. Это прямое противоречие
  Increment B / default-deny.
- Нет подтверждения владельца перед `transform_data` в safe/explore.
- microVM заблокирован: нет образа, подписи, hash, лимитов, договора
  `Virtualization.framework`.
- Не начаты: pairing внешних устройств / passkeys, `SHARE_ORIGIN`, раздельные
  APP/SHARE origin, подписанная поставка релизов.

### Задачи

| id | title | status |
|---|---|---|
| `RX-TSK-0415` | Origin-scoped remote TLS, снять `rejectUnauthorized: false` | `planned` |
| `RX-TSK-0416` | Режимы messaging `public-inbox` / `owner-control` / `disabled` | `planned` |
| `RX-TSK-0417` | Подтверждение владельца перед `transform_data` | `planned` |
| `RX-TSK-0418` | Изоляция исполнения в microVM | `blocked` |
| `RX-TSK-0419` | Pairing устройств, `SHARE_ORIGIN`, подписанные релизы | `planned` |

---

## Вне периметра

Одной строкой на репозиторий — без задач `RX-TSK`.

- `RX-SES-0003` `session-recovery-20260821-repo` — git-format-patch к checkout
  `agent-skills-installer`; шесть правил `react-best-practices` уже лежат в
  `apps/electron/resources/skills/vercel-agent-skills/react-best-practices/rules/`.
- `RX-SES-0004` `session-recovery-20260821-macro` — патч 4.8 МБ к
  `/Users/marklindgreen/Projects/yolo-garden/macro` (иконки, Tauri, brand assets).
- `RX-SES-0006` `session-recovery-20260821-rox-system-diagrams` — пакет HTML/PNG
  диаграмм Rox System (OMP/Terra, compression atlas, domain catalog).
- `RX-SES-0007` `session-recovery-20260821-rox-font-reference-family` — исходники
  и пайплайн сравнения ROX Mono (CJK/Cyrillic/Greek masters).
- `RX-SES-0010` `session-recovery-20260821-home-rox-api-network-diagnosis-20260820`
  — инцидент OmniRoute/`api.rox.one` (Cloudflare 502/1033, зависший origin);
  плюс домашний HMA-бандл. Не код этого монорепо.

---

## Индекс извлечённых задач

| id | origin | status | Кратко |
|---|---|---|---|
| `RX-TSK-0400` | `session-recovery-20260821-craft-agents` | `planned` | Инспектор Connections |
| `RX-TSK-0401` | `session-recovery-20260821-craft-agents` | `planned` | Дефолт-лейбл OMP |
| `RX-TSK-0402` | `session-recovery-20260821-craft-agents-cf2-restored` | `planned` | OMP Command Gateway 0–7 |
| `RX-TSK-0403` | `session-recovery-20260821-craft-agents-cf2-restored` | `planned` | UI миграции CF-2 |
| `RX-TSK-0404` | `session-recovery-20260821-craft-agents-cf2-restored` | `planned` | OpenClaw security dashboard |
| `RX-TSK-0405` | `session-recovery-20260821-marklindgreen` | `planned` | `rox-sidecar` |
| `RX-TSK-0406` | `session-recovery-20260821-marklindgreen` | `planned` | WP-UI |
| `RX-TSK-0407` | `session-recovery-20260821-marklindgreen` | `planned` | `command.approve` / `deny` |
| `RX-TSK-0408` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | SI W1–W5 |
| `RX-TSK-0409` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | PSI W6–W8 за гейтом |
| `RX-TSK-0410` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | Снять `credentialValue` |
| `RX-TSK-0411` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | Notes Imports UI |
| `RX-TSK-0412` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | OwnedRootPolicy |
| `RX-TSK-0413` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | README clone URL |
| `RX-TSK-0414` | `session-recovery-20260821-do-it-all-security-slices` | `planned` | Корпус `docs/security` |
| `RX-TSK-0415` | `session-recovery-20260821-security-external-access-20260811` | `planned` | Remote TLS pin |
| `RX-TSK-0416` | `session-recovery-20260821-security-external-access-20260811` | `planned` | Messaging default-deny |
| `RX-TSK-0417` | `session-recovery-20260821-security-external-access-20260811` | `planned` | Confirm `transform_data` |
| `RX-TSK-0418` | `session-recovery-20260821-security-external-access-20260811` | `blocked` | microVM sandbox |
| `RX-TSK-0419` | `session-recovery-20260821-security-external-access-20260811` | `planned` | Pairing / share / релизы |
| `RX-TSK-0420` | `session-recovery-20260821-do-it-all-security-slices` | `blocked` | Gate 0 owner facts |
