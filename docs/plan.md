# Последовательное исполнение программы — 2026-09-30

Владелец результата и интеграции — root. Этапы проходят по порядку пользовательского поручения. Внутри текущего этапа выполняются независимые задачи с одним владельцем каждого файла. Полный локальный реестр остаётся источником точных критериев; этот план содержит публичные производные контракты, не копию частной переписки.

## Текущий checkpoint

Этап 1 — сверка выполнена. Сохранены 484 исходные строки в 30 группах и отдельно U25. Выполнены 30 независимых source-аудитов и 36 независимых заданий точного сопоставления каждого исходного пункта; фактическая пиковая параллельность второй волны — 36 процессов. Проверены exact-ID coverage, исходные составные критерии, ссылки на код, DAG и отрицательные контроли потери/дублирования/ложной приёмки. Межпроектная отмена Conation sidebar отклонена: корректировка Rox не отменяет Conation. Это ещё не 484 выполненных продуктовых сценария. Этап 2 — executing; последующие этапы в очереди.

Source snapshot: 70 критериев реализованы в проверенном коде, 297 частично, 69 не найдены в проверенном пути, 48 не установлены. Эти состояния не утверждают runtime PASS или доставку. Подготовлено 82 поверхности, 788 отдельных сценариев и 14 межэкранных трассировок; стартовое состояние всех сценариев — NOT_RUN.

## Этапные gates

| ID | Входы и зависимости | Результат и приёмка | Следующее исполнимое действие |
| --- | --- | --- | --- |
| S01 | Экспорт, существующие планы, checkout/installed/issue snapshots | Полный реестр без потерь; отдельная U25; per-criterion current evidence; действующие Mission/Steps сверены; task DAG | Свести exact-ID source reconciliation, проверить отрицательные контроли и ownership |
| S02 | S01 registry, actual Mac Rox | Каждый актуальный screen/control/state; shared-data map; PRD; предложения отдельно | Пройти доступные экраны через native UI, сохранять AX/снимки и store readback |
| S03 | S02 дефекты и последний UI contract | Wide/narrow/keyboard/focus/reduced-motion/restart; original logo; Inter и latest navigation | Назначить непересекающихся UI writers после проверки остаточных дефектов |
| S04 | S03; текущие executor/notification/cloud/storage paths | Budget/background, Focus delivery, automation continuity/webhook, real cloud errors; Windows recovery | Сначала определить авторитетный enforcement path и существующие сохранённые настройки |
| S05 | S04; actual voice config, recorder/store/session paths | Record→ASR→analysis→Tasks→reopen; TTS/stop/fallback; native mini lifecycle | Ответить по ordinary voice route; проверить настоящий recorder и зависимости анализа |
| S06 | S05; existing Projects/Tasks/Notes and event consumers | Materials→persisted spec/tasks/progress; graph positive/negative; real Quest persistence | Выбрать общую сохраняемую модель и единственных владельцев shared consumers |
| S07 | S06; existing Stalwart/JMAP/DNS/auth | Независимые A local и B external acceptance, persistence/restart | Проверить установку и состояние домена перед изменением службы/доступности |
| S08 | S07; existing backend/identities/permissions | Две идентичности, sender→recipient, permission allow/deny, reconnect | Проверить backend и готовые платформы; выбрать по требованиям и реализовать оставшееся |
| S09 | S08; full Conation checklist, actual target, existing CTN workers | Каждая строка отдельно, auth data/E2E/Tauri/deep links/delivery | Сверить target и владение с existing program, не создавать второй source writer |
| S10 | S09; RMA/Golden issue criteria and prerequisites | #385 real E3; #387 dependency gate; grid/spatial/device; full final matrix | Выполнять критерии без ослабления, затем сверить всю доставленную программу |

Внешняя блокировка конкретного сценария не становится искусственной зависимостью всех последующих функций. При завершении доступной части текущего этапа оставшийся критерий сохраняется blocked с точным условием; следующая независимая работа может продолжаться, но этот этап не объявляется завершённым. Реальные product dependencies проверяются отдельно от последовательности отчётов.

## Зависимости конкретных результатов

1. Discovery actual source/bundle/working checkout → весь UI и runtime audit.
2. Exact criterion reconciliation → writer assignment и критерий приёмки конкретной доработки.
3. Shared SessionManager/executor contract → budget, Focus, automation continuation, meeting analysis и обычный graph context. Один интегратор предотвращает конфликт общих изменений.
4. Meeting persisted transcript + actual agent runtime → automatic analysis → saved decisions/tasks/questions → cross-screen readback.
5. Project common entities → roadmap/AI decomposition → Tasks/Notes linkage → progress/Quest consumers.
6. Local mail provisioning/JMAP/security → Rox Inbox local acceptance. DNS/reachability/external delivery — отдельная ветка. Conation #380 требует своих approve/verified-send критериев.
7. Authenticated persistent collaboration backend → roles/shared memory/recipient Inbox/handoff → real two-identity acceptance. Аккаунты connectors — отдельные coverage lanes.
8. Conation authenticated session and actual target → populated modules; Mail/CRM/Calendar после подтверждённых prerequisites, не после общего health 200.
9. RMA #385 product prerequisites и true E3 → снятие зависимости #387; merge вспомогательного U1 harness эту зависимость не закрывает.
10. Golden Gate #556 grid, #557 spatial/native и #558 device acceptance → соответствующие строки полной #578 matrix. Map toolbar не закрывает эти три сценария.
11. Windows environment → Windows-specific durability proof. Mac/Linux source или forced-platform unit test не заменяют этот leaf gate.

## Контракты владельцев

До начала записи каждый исполнитель получает точные: requirement IDs, исходные критерии, current revision, входы, зависимости, список разрешённых файлов, ожидаемый артефакт, реальные проверки и способ доставки. Указанные ниже роли — будущие назначения, не утверждение о запущенных работниках.

| Роль | Единственная поверхность записи | Результат | Проверка |
| --- | --- | --- | --- |
| root integration | registry, AppShell, SessionManager, transport registry, shared i18n coordination | Объединённый код и согласованные shared interfaces | Затронутые реальные сценарии и соседние consumers |
| native UI evaluator | Только AX/screenshots/case evidence | Expected/observed matrix | Source-version pin, реальные взаимодействия, отрицательный контроль |
| UI leaf owner | Назначенные leaf components/styles/assets | Последняя согласованная поверхность | Wide/narrow, keyboard, visual, reload |
| runtime leaf owner | Назначенные executor/automation/cloud leaf handlers | Runtime effect и persistence | Actual execution, boundary/error/recovery |
| voice/meeting leaf owner | Назначенный adapter/meeting analysis/store | Настоящие ASR/TTS/analysis paths | Запись, stop, offline fallback, task readback |
| data-process leaf owner | Назначенные project/graph/Quest models и consumers | Согласованные сохраняемые данные | Positive/negative controls, restart |
| mail/backend leaf owner | Назначенный server/JMAP/backend код | Реальный обмен и права | Local/external раздельно, две identity где требуется |
| Windows evaluator | Windows runner/evidence, без чужого source writer | OS-specific durability receipt | Fail/write/replace/interruption/recovery |
| existing CTN parent | Его действующие worktree/карточки | Существующая source preparation и parent delivery | Читать actual mission и actual checks, не подменять title |

Чужие worktree/patches не сбрасываются. Prepared WP contracts переиспользуются с актуальной корректировкой и SHA. Live CTN parent продолжает владеть своими assignments; заголовок карточки не доказывает актуальность mission.

## Проверки и доставка

1. Read-only source evidence хранится отдельно от live acceptance. Частный exact-ID реестр проходит проверку сохранности и seeded negative controls.
2. Перед записью воспроизводится актуальное несоответствие; работающий путь сохраняется.
3. Проверки выбираются по изменению: реальные happy/failure/save/reopen и соседние сценарии. Unit/property checks применяются к invariants, а не вместо UI.
4. После изменений evidence повторяется для изменённой версии. Не использовать старый screenshot/PASS для нового bundle.
5. Delivery: owned branch → targeted verification → commit → предусмотренный PR/push → readback. Установка новой сборки и приёмка установленной версии — отдельный gate.
6. В публичную доставку входят только относящиеся код, производная документация и обезличенные доказательства. Частные экспорт/agent missions/credentials сохраняются локально.
