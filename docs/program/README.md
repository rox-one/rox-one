# Единая программа передачи, исполнения и приёмки Rox / Conation / RMA / Golden Gate

**Issue:** [#1157 PROGRAM-01](https://github.com/rox-one/rox-one/issues/1157) · **состояние issue:** OPEN · **наблюдение:** 2026-10-08T22:27:59Z
**База чтения:** `origin/main` @ `8c5abc7a32a3773645b695b79a81c327b8e6758d`; ветка `docs/sept-program-1157-master-program` @ `99b9a2ffa591`;
родительская ветка `docs/sept-program-1158-recon` @ `99b9a2ffa591` (результат RECON-01 / PR #1629).

Этот каталог — **master-программа**: единый index передачи, исполнения и приёмки. Он не создаёт вторую
программу и не дублирует существующие документы: PRD, spec, plan, issue index и JSON-реестры остаются
там, где опубликованы, и подключаются ссылками (см. §7).

## 1. Статус пакета (не выдавать за приёмку)

| Поле | Значение |
|---|---|
| Пакет документов | **PREPARED** |
| Программа продукта | **PROGRAM NOT STARTED** |
| UI-приёмка | **NOT CLAIMED** |
| `task-registry.json` productStatus | IN_PROGRESS (заявленный статус реестра, не доказательство) |
| `task-registry.json` packetStatus | PUBLISHED_VERIFIED (подтверждает публикацию 109 карточек, не их исполнение) |

> Публикация и статусы реестра не являются приёмкой продукта; эта ветка — документы, не исполнение.

Правило разделения сохраняется: **requested** ≠ **verification-gap** ≠ **proposal-audit** ≠ **decision-reconciliation**.
Предложения не авторизуют имплементацию. Merge или публикация не считаются feature acceptance.

## 2. Что входит и что не входит

- **Входит:** PRD, spec, plan, issue map/DoD, functional acceptance scenarios, источники, owners, границы файлов, интерфейсы, зависимости, риски, сводная матрица.
- **Не входит:** Исполнение app features, cloud provisioning, изменение чужих файлов, закрытие issues, U25-переключение поведения.

Границы файлов этой задачи: только `docs/program/**`. Прикладной код, приватные входы и чужие
документы не изменяются; существующие issues не закрываются.

## 3. Цепочка этапов: recon → аудит → интерфейсы → потоки → интеграция → приёмка

| Этап | Задача | Issue | Владелец | dependsOn | Статус реестра | Состояние issue |
|---|---|---|---|---|---|---|
| 1 | PROGRAM-01 | [#1157](https://github.com/rox-one/rox-one/issues/1157) | ProgramLead | — | IN_PROGRESS | open |
| 2 | RECON-01 | [#1158](https://github.com/rox-one/rox-one/issues/1158) | ReconciliationOwner | PROGRAM-01 | IN_PROGRESS | open |
| 3 | AUDIT-01 | [#1159](https://github.com/rox-one/rox-one/issues/1159) | ActualSurfaceAuditor | RECON-01 | NOT_RUN | open |
| 4 | DATA-01 | [#1212](https://github.com/rox-one/rox-one/issues/1212) | SharedIntegrator | RECON-01, AUDIT-01 | IN_PROGRESS | open |
| 5 | SHARED-01 | [#1160](https://github.com/rox-one/rox-one/issues/1160) | SharedIntegrator | DATA-01 | IN_PROGRESS | open |
| 6 | INTEGRATE-01 | [#1161](https://github.com/rox-one/rox-one/issues/1161) | ProgramLead | SHARED-01, CHAT-01, CHAT-02 … (+100) | IN_PROGRESS | open |
| 7 | RELEASE-01 | [#1162](https://github.com/rox-one/rox-one/issues/1162) | IndependentReleaseVerifier | RECON-01, AUDIT-01, SHARED-01, INTEGRATE-01 | NOT_RUN | open |

- **PROGRAM-01** (#1157): Root metadata/orchestration; не зависит от RELEASE-01, цикла не образует.
- **RECON-01** (#1158): Владельцы источников, dedup, активная работа; результат — ветка docs/sept-program-1158-recon (PR #1629).
- **AUDIT-01** (#1159): Фактический аудит экранов на живой сборке; требует recon и сборки.
- **DATA-01** (#1212): Швы: producer/store/consumer, стабильная идентичность, ACL, версии.
- **SHARED-01** (#1160): Заморозка общих корней и единственный писатель; зависит от DATA-01.
- **INTEGRATE-01** (#1161): Последовательная интеграция атомарных потоков без потери overlay.
- **RELEASE-01** (#1162): Финальная матрица на реальных платформах без сужения DoD.

### 3.1 Проверка графа issues (DoD: без дубликатов и циклов)

| Проверка | Результат |
|---|---|
| Задач / уникальных ID | 109 / 109 |
| Дубликаты ID | нет |
| Рёбра зависимостей | 464 |
| Циклы | **0** |
| Неизвестные цели зависимостей | нет |
| `PROGRAM-01` dependsOn | `[]` (пустые — требование DoD) |
| Задач зависят от `RELEASE-01` | 0 (цикл с корнем невозможен) |
| У каждой задачи есть issue | да |
| Дубликаты номеров issue | нет |

Проверка выполнена программно по `docs/september-program/task-registry.json` (обход в глубину по 464 рёбрам).

Заблокированных задач: `SHARED-01` → **103**, `DATA-01` → **77**, `AUDIT-01` → **24**, `RECON-01` → **59**.

## 4. Источники: source-backed register

Единый реестр источников и владельцев поставлен RECON-01 (#1158) и используется здесь как входной контракт.

| Артефакт | Что даёт |
|---|---|
| [`docs/september-program/recon-1158/current-state.md`](../september-program/recon-1158/current-state.md) | живые чек-ауты, PR, деревья issues, реестр U01–U31 |
| [`docs/september-program/recon-1158/source-ownership.md`](../september-program/recon-1158/source-ownership.md) | владельцы, дубликаты, закрытое/удержанное, дети #541, локали, Macro |
| [`docs/september-program/recon-1158/dependency-graph.md`](../september-program/recon-1158/dependency-graph.md) | граф зависимостей на момент recon |
| [`docs/september-program/recon-1158/unconfirmed.md`](../september-program/recon-1158/unconfirmed.md) | явный список неподтверждённого |
| [`docs/september-program/recon-1158/recon-1158.json`](../september-program/recon-1158/recon-1158.json) | машиночитаемый реестр |

Правила происхождения, которые программа сохраняет:

1. Приватные координаты `seqNNN` и приватные аудиты публично не воспроизводятся — только тезисы и U-группы.
2. Ссылки на приватные файлы в публичном пакете заменены безопасными ссылками; приватные входы не изменяются.
3. Пользовательские поздние поправки приоритетнее старого текста; существующие issues сильнее исторических групп.
4. Runtime-статус не выводится из транскрипта: где наблюдения нет — стоит `[не подтверждено]`.

### 4.1 Живые PR на момент этого документа

| PR | Ветка | База | mergeable | draft |
|---|---|---|---|---|
| [#1615](https://github.com/rox-one/rox-one/pull/1615) | `feat/w1-06-workitem-v3-schemas` | `main` | MERGEABLE | false |
| [#1618](https://github.com/rox-one/rox-one/pull/1618) | `perf/p2-query-cache` | `main` | MERGEABLE | false |
| [#1620](https://github.com/rox-one/rox-one/pull/1620) | `perf/p2-keepalive-prefetch` | `perf/p2-query-cache` | MERGEABLE | false |
| [#1621](https://github.com/rox-one/rox-one/pull/1621) | `feat/w1-09-activity-notifications-inbox` | `main` | MERGEABLE | false |
| [#1622](https://github.com/rox-one/rox-one/pull/1622) | `feat/w1-12-domain-rule-engine` | `main` | MERGEABLE | false |
| [#1623](https://github.com/rox-one/rox-one/pull/1623) | `feat/w1-11-identity-agent-governance` | `main` | CONFLICTING | false |
| [#1624](https://github.com/rox-one/rox-one/pull/1624) | `feat/e01-voice-wave` | `main` | MERGEABLE | false |
| [#1625](https://github.com/rox-one/rox-one/pull/1625) | `feat/w1-15-chrome-agent-panel-xfn` | `main` | CONFLICTING | false |
| [#1626](https://github.com/rox-one/rox-one/pull/1626) | `feat/w1-14-collab-xsc-drive-contracts` | `main` | MERGEABLE | false |
| [#1627](https://github.com/rox-one/rox-one/pull/1627) | `fix/product-tour-native-green` | `main` | CONFLICTING | false |
| [#1628](https://github.com/rox-one/rox-one/pull/1628) | `feat/rox-batch2-20261008` | `main` | MERGEABLE | false |
| [#1629](https://github.com/rox-one/rox-one/pull/1629) | `docs/sept-program-1158-recon` | `main` | MERGEABLE | false |

Наши актуальные PR: #1615 (W1-06), #1618 (P2 query cache), #1620 (P2 keep-alive), #1621 (W1-09), #1622 (W1-12),
#1623 (W1-11), #1624 (e01 voice wave), #1625 (W1-15), #1626 (W1-14) и **#1629 — результат RECON-01 (#1158)**, на котором стоит эта ветка.
PR #1627 (product tour) и #1628 (batch2) также открыты и не входят в сентябрьскую программу.

### 4.2 Чек-ауты, наблюдавшиеся в этом прогоне

| # | Тип | ref | HEAD | dirty | Примечание |
|---|---|---|---|---|---|
| A | bare mirror | `fix/residual-ci-reds-20261008` | `0b8a4dda1fe3` | 0 | 280 локальных ветвей, 833 remote refs |
| B | linked worktree | `feat/w1-09-activity-notifications-inbox` | `945182eb8813` | 0 | PR #1621 head |
| C | linked worktree | `feat/w1-14-collab-xsc-drive-contracts` | `f842f3402e59` | 0 | PR #1626 head |
| D | linked worktree | `feat/w1-15-chrome-agent-panel-xfn` | `93e5a86ccae6` | 0 | PR #1625 head |
| E | linked worktree | `perf/p2-keepalive-prefetch` | `1922d50c3a70` | 0 | PR #1620 head |
| F | linked worktree | `HEAD` | `3f1a978e9188` | 0 | detached; e01-decisions tip |
| G | linked worktree | `feat/e01-voice-wave` | `b63efe011ae3` | 0 | merge завершён владельцем в ходе сессии |
| H | separate clone | `main` | `e6c899357e3a` | 15540 | 15 540 staged-удалений; не трогать |
| I | linked worktree | `docs/sept-program-1157-master-program` | `99b9a2ffa591` | 0 | эта ветка (документы) |

Ни одна чужая рабочая копия не очищалась и не переключалась; изменения зафиксированы только в этой ветке.

## 5. Владельцы и границы общих файлов

| Слой | Владелец | Границы |
|---|---|---|
| Root / интеграция / релиз | `ProgramLead` (PROGRAM-01 #1157, INTEGRATE-01 #1161) | только координация и документы реестра |
| Реконсиляция источников | `ReconciliationOwner` (RECON-01 #1158) | read-only отчёты |
| Аудит поверхности | `ActualSurfaceAuditor` (AUDIT-01 #1159) | read-only наблюдения + отчёт |
| Контракт сущности и синхронизации | `SharedIntegrator` (DATA-01 #1212) | единственный писатель общих корней |
| Заморозка интерфейсов | `SharedIntegrator` (SHARED-01 #1160) | registry/route IDs, RPC/schema, локали, lockfile, общие UI-примитивы |
| Независимая приёмка | `IndependentReleaseVerifier` (RELEASE-01 #1162) | финальная матрица; не участвует в реализации |
| Домен | 68 именованных владельцев задач | только свой домен; общие корни не редактируют |

Правило: **один владелец на общий корень**. Доменные потоки не меняют сигнатуру общего интерфейса самостоятельно.
Границы и запреты зафиксированы в `recon-evidence.json#/immutableLeases` и не расширяются этим документом.

## 6. Интерфейсы: что считается границей между потоками

| Интерфейс | Владелец | Требование |
|---|---|---|
| Реестр сущностей и стабильная идентичность | DATA-01 #1212 | одна версия EntityRef/revision; одинаковая сущность в двух workspace изолирована |
| Мутационная оболочка | DATA-01 #1212 | идемпотентный повтор применяет мутацию один раз; конфликт сохраняет обе версии |
| Реестр маршрутов и общие UI-примитивы | SHARED-01 #1160 | замораживаются после обнаружения фактических корней |
| Локали | SHARED-01 #1160 / L10N-01 #1142 | каталог — один владелец; знаменатель решается владельцем |
| Транскрипт/сессия встречи | MEETINGS-01 #1187, TRANSCRIPTIONS-01 #1188 | Whisper встречи ≠ STT обычной сессии |
| Почта | MAIL-01 #1181 / MAIL-02 #1182 | локальный Stalwart ≠ внешняя доставка домена |
| Медиа-комнаты | RMA-03 #1152 (proposal-audit) | второй media writer не создаётся |

## 7. Существующие документы (подключены, не дублируются)

| Документ | Роль |
|---|---|
| [PRD](https://github.com/rox-one/rox-one/blob/main/docs/september-program/PRD.md) | требования и границы программы |
| [execution contract](https://github.com/rox-one/rox-one/blob/main/docs/september-program/execution-contract.md) | десять исходных промптов как входы, не полномочия |
| [task-registry.json](https://github.com/rox-one/rox-one/blob/main/docs/september-program/task-registry.json) | 109 задач и DAG |
| [issue-index.md](https://github.com/rox-one/rox-one/blob/main/docs/september-program/issue-index.md) | индекс задач, владельцев и строк |
| [handoff.md](https://github.com/rox-one/rox-one/blob/main/docs/september-program/handoff.md) | передача состояния репозиториев |
| [source-backlog.md](https://github.com/rox-one/rox-one/blob/main/docs/september-program/source-backlog.md) | U01–U31 и 16 Conation-пунктов |
| [docs/spec.md](https://github.com/rox-one/rox-one/blob/main/docs/spec.md) | спецификации текущей архитектуры |
| [docs/plan.md](https://github.com/rox-one/rox-one/blob/main/docs/plan.md) | канонический план |
| [484 исторические requirement rows](../september-program/requirements-full.json) | U-реестр |
| [Conation-владельцы](../september-program/requirements-conation-owners.json) | 343 строки с первичным владельцем |

## 8. Сводная матрица и приёмка

- [Сводная матрица «требование → владелец → статус → доказательство»](requirement-matrix.md) — U01–U31, U25, 16 Conation-строк, кросс-программные связи.
- [Сценарии приёмки](acceptance-scenarios.md) — functional acceptance scenarios и их наблюдаемые ожидания.
- [Риски и блокировки](risks-and-blockers.md) — владелец, зависимость и следующий шаг по каждому.
- [Граф зависимостей](dependency-graph.md) — Mermaid-графы (проверены парсером mermaid@11).
- [program-1157.json](program-1157.json) — машиночитаемый issue map/register.

## 9. Clarification: U25

U25 не является feature request. В реестре требований у неё **0 строк**: это `decision-reconciliation`, [DECISION-01 · #1156](https://github.com/rox-one/rox-one/issues/1156) (состояние issue: open).

decision-reconciliation only; FALSE/shortcut-only сохраняется, изменения не авторизованы.

Конфликт записей (skipped-виджет с одновременным `respondedValue`, поздний ack и пропуск) независимым
человеческим подтверждением не закрыт. До появления независимого достоверного основания переключение
поведения, удаление shortcut-only режима или правка shell/Map-кода не авторизованы.

## 10. Macro: реиспользование без прав на код

- Пакет Macro присутствует как отдельный, продолжающий обновляться проект: **52 work packages, 61 экран, 219 контролов**.
- Статус — **PREPARED_NOT_LAUNCHED**: это планирование, а не запущенная программа и не второй поток.
- Требования связываются (scope/ссылки). Копирование кода — только после проверки прав и provenance:
  корень Macro — AGPLv3, `apps/web` — all rights reserved.
- На каждый экран допускаются **2–3 улучшения**, но они фиксируются как **proposals** и отделяются
  от подтверждённых дефектов; предложение не авторизует имплементацию.

## 11. Definition of Done этой задачи

| # | Критерий | Состояние |
|---|---|---|
| 1 | PRD, spec, plan, issue index, functional tests и JSON issues согласованы | Выполнено: подключены ссылками (§7), приёмка — `acceptance-scenarios.md` |
| 2 | Охвачены все U01–U31 и все 16 seq703 rows; предложения помечены proposal | Выполнено: `requirement-matrix.md` §1–§3 |
| 3 | Issue graph без дубликатов ID и циклов; PROGRAM-01 с пустыми deps | Выполнено и проверено программно (§3.1) |
| 4 | Ссылки на приватные файлы удалены или заменены безопасным артефактом | Выполнено: §4; приватные входы не изменялись |
| 5 | Macro 52WP/61 screens/219 controls реиспользуется, лицензия учтена | Выполнено: §10 |
| 6 | Явно указано: PREPARED / PROGRAM NOT STARTED, UI acceptance NOT CLAIMED | Выполнено: §1 |
| 7 | Lead reviewer и upload owner подтвердили публичную ссылку и issue index | **Остаётся за людьми**: этот пакет публикует автор, приёмку публикации выполняет lead (§12) |

## 12. Handoff: что остаётся сделать людям

1. **Lead reviewer**: подтвердить финальную публичную ссылку и актуальность issue index после merge этой ветки.
2. **Upload owner**: подтвердить, что в публичном пакете нет приватных путей/сырых промптов (проверка §4 выполнена автором).
3. **ProgramLead**: перевести `task-registry.json` в согласованный статус после RECON-01 и не выдавать публикацию за исполнение.
4. Решения, которые нельзя принять документом: знаменатель локалей (10 против 12), U25, назначение слота iOS.

## 13. Что не подтверждено

- `[не подтверждено]` Приватные первичные источники (координаты seqNNN, полный транскрипт, приватные аудиты early/middle/late/tail) публично недоступны: проверяемы только тезисы и U-группы.
- `[не подтверждено]` Полнота очистки приватных ссылок в ранее опубликованных документах не проверялась; проверены только артефакты этой ветки.
- `[не подтверждено]` Знаменатель локалей (10 против 12) не решён владельцем L10N-01 #1142; сохранены обе цифры.
- `[не подтверждено]` U25: независимого достоверного основания нет; поведение FALSE/shortcut-only остаётся, изменение не авторизовано.
- `[не подтверждено]` E3 для #385 не предъявлен; merge PR #991 приёмкой не является.
- `[не подтверждено]` #387 остаётся HELD: ни одна поставка packaged app / upgrade / web / локали / доступность не предъявлена.
- `[не подтверждено]` #389 (P2): зафиксирован только scope, реализации media rooms/screenshare/reconnect/signed bots нет.
- `[не подтверждено]` Полная приёмка Golden Gate #541/#578 не выполнена; закрытие #567 не перепроверялось по существу.
- `[не подтверждено]` Conation: все 16 строк seq703 — NOT_RUN; доступность донорского рантайма, сид-данных и runner не подтверждена.
- `[не подтверждено]` Платформы: Windows native, macOS native и iOS-слот не наблюдались в этом прогоне; POSIX-доказательства их не заменяют.
- `[не подтверждено]` Runner/cloud inventory и состояние внешних машин недоступны: не подтверждено, а не выведено по догадке.
- `[не подтверждено]` Авторство dirty-overlay не устанавливается из git-статуса; владелец конкретного изменения не выводится.
- `[не подтверждено]` Кросс-программные пересечения (Rox Unified, ROX Suite, Macro) — тематические гипотезы по заголовкам и меткам, не подтверждённое дублирование реализации.
- `[не подтверждено]` Статусы `task-registry.json` (31 IN_PROGRESS / 78 NOT_RUN) — заявленные значения реестра, не подтверждённые наблюдаемым поведением продукта.
- `[не подтверждено]` `executionProgress.deliveryRevision = null`: доставленной ревизии продукта нет.
- `[не подтверждено]` Macro: правовая проверка реиспользования донорского кода не проводилась; граница AGPLv3 / all rights reserved зафиксирована, но не подтверждена юридически.
- `[не подтверждено]` DoD п.7 (подтверждение публичной ссылки и issue index lead reviewer и upload owner) не выполнен: это действие людей вне репозитория.
- `[не подтверждено]` Актуальность внешних задач и runner-слотов Rox Unified не проверялась.
- `[не подтверждено]` Visual/native-проверки Golden Gate не выполнялись; UI-приёмка не заявляется.
- `[не подтверждено]` Привязка владельцев к 16 строкам Conation получена сопоставлением разделов `requirements-conation-owners.json`; построчная авторитетность остаётся за владельцем CONATION-E2E-01 #1154.

