# Риски и блокировки

**Issue:** [#1157](https://github.com/rox-one/rox-one/issues/1157) · **наблюдение:** 2026-10-08T22:27:59Z

Каждая строка имеет владельца, точную зависимость и следующий шаг. Блокировка без владельца и без
следующего шага считается дефектом реестра.

## 1. Реестр рисков

| ID | Риск / блокировка | Владелец | Issue | Вид | Следующий шаг |
|---|---|---|---|---|---|
| R-01 | SHARED-01 не заморожен — блокирует 103 задачи | SharedIntegrator | [#1160](https://github.com/rox-one/rox-one/issues/1160) | **блокер** | DATA-01 (#1212) принимает контракт сущности/ревизии; далее SHARED-01 фиксирует корни с единственным писателем. |
| R-02 | DATA-01 без принятой версии контракта — блокирует 77 задач | SharedIntegrator | [#1212](https://github.com/rox-one/rox-one/issues/1212) | **блокер** | Принять одну версионированную EntityRef/revision-оболочку и доказать producer + двух независимых потребителей. |
| R-03 | Security: shared identity, provider credentials и cross-surface authorization | OwnerBackend | [#1225](https://github.com/rox-one/rox-one/issues/1225) | безопасность | BACKEND-02: доказать отказ неавторизованному чтению/записи без утечки; связано с BACKEND-01 #1224. |
| R-04 | Security: consent и изоляция сторонних account/cookie подключений | OwnerIntegrations | [#1135](https://github.com/rox-one/rox-one/issues/1135) | безопасность | INTEGRATIONS-03: согласие адресата и изоляция чтения; зависит от DATA-01/SHARED-01/AUDIT-01. |
| R-05 | RMA E3 не подтверждён: #385 → #387 → карточки #1150/#1151 | OwnerRma | [#385](https://github.com/rox-one/rox-one/issues/385) | **блокер** | Реальное E3-доказательство (#385); merge PR #991 приёмкой не является. #387 остаётся HELD до прохождения #385. |
| R-06 | Golden Gate: финальная приёмка #578 не закрыта → RELEASE-01 #1162 | OwnerGoldenGate | [#578](https://github.com/rox-one/rox-one/issues/578) | **блокер** | Визуальная/функциональная/performance и Electron/macOS матрица; из 25 детей #541 закрыт только #567. |
| R-07 | U25 — неразрешённое решение, не feature | OwnerDecisionReconciliation | [#1156](https://github.com/rox-one/rox-one/issues/1156) | решение | Независимое достоверное основание; до него поведение FALSE/shortcut-only не меняется. |
| R-08 | Платформы Windows/macOS/iOS не наблюдались | IndependentReleaseVerifier | [#1162](https://github.com/rox-one/rox-one/issues/1162) | не подтверждено | Отдельные слоты наблюдений; iOS-слот остаётся BLOCKED с точным prerequisite, Mac/browser его не заменяют. |
| R-09 | Публичная публикация: приватные пути и ссылки | ProgramLead | [#1157](https://github.com/rox-one/rox-one/issues/1157) | governance | Перед публикацией сверить пакет на raw prompt/приватные пути/секреты; приватные входы не менять. |
| R-10 | Macro: права на донорский код | ProgramLead | [#1157](https://github.com/rox-one/rox-one/issues/1157) | права | Корень Macro AGPLv3, apps/web — all rights reserved. Реиспользование требований допустимо, копирование кода — только после проверки прав. |

## 2. Цепочки блокировок (порядок снятия)

1. **Контрактный контур.** RECON-01 → AUDIT-01 → DATA-01 → SHARED-01 → 103 доменные задачи.
   Пока `SHARED-01` не заморожен, доменные потоки не начинают писать в общие корни.
2. **RMA.** `#385` (реальное E3) → `#387` (поставка, HELD) → карточки `#1150`/`#1151` → `RELEASE-01 #1162`.
   Merge PR #991 приёмкой не является: harness смержен, E3 не предъявлен.
3. **Golden Gate.** `#541`/`#578` (полная приёмка, из 25 детей закрыт только `#567`) → `GG-03 #1149` → `RELEASE-01 #1162`.
4. **Безопасность.** `BACKEND-02 #1225` (shared identity/credentials) и `INTEGRATIONS-03 #1135`
   (consent и изоляция чужих аккаунтов) зависят от `DATA-01`/`SHARED-01` и входят в релизный гейт.
5. **Conation.** `CONATION-DELIVERY-01 #1155` → `CONATION-AUTH-01 #1153` → `CONATION-E2E-01 #1154` → `CONATION-SHARE-01 #1229`.
6. **Платформенный контур.** Windows/macOS/iOS-слоты не наблюдались; iOS-слот BLOCKED до подтверждения
   target/device/runner, при этом он не блокирует остальные слоты.

## 3. Правила, предотвращающие ложные доказательства

1. Merge ≠ feature acceptance. Публикация ≠ исполнение. Документ ≠ PASS.
2. Отсутствие среды/учётных данных помечается BLOCKED/UNVERIFIED, а не заменяется симуляцией PASS.
3. Отсутствующие проверки не выдаются за пройденные; DoD не сужается под доступную среду.
4. Локальная почта ≠ внешняя доставка домена; Whisper встречи ≠ STT обычной сессии;
   microphone-only ≠ согласие на system audio.
5. Ни один issue не закрывается по догадке; закрытие требует наблюдённого доказательства.

## 4. Что снимает риски прямо сейчас

| Действие | Владелец | Влияние |
|---|---|---|
| Принять контракт сущности/ревизии (DATA-01) | `SharedIntegrator` | открывает 77 задач (103 — прямые зависимые SHARED-01) |
| Провести фактический аудит экранов (AUDIT-01) | `ActualSurfaceAuditor` | открывает UI-слой (24 задачи) |
| Предъявить реальное E3 (#385) | `OwnerRma` | открывает `#387`, `#1151`, `GG-03`, релизный гейт |
| Закрыть полную приёмку Golden Gate (#578) | `OwnerGoldenGate` | открывает `RELEASE-01` по GG |
| Подтвердить iOS target/device/runner | `OwnerConation` | снимает BLOCKED с `#1229` |
| Решить знаменатель локалей | `OwnerLocalization` (L10N-01 #1142) | снимает расхождение 10/12 |

