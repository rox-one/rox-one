# [PW-RU] Запуск параллельной доработки ROX

## [PW-RU-COUNT] Что именно считаем

**625 описаний = 445 самостоятельных задач исполнения + 180 родительских блоков приёмки.** Родительские требования сохраняются: их владелец проверяет полноту и сочетание результатов дочерних задач. Их нельзя считать ещё одной независимой реализацией и одновременно считать детей.

В исходном реестре182 записи без `parentId` и443 подзадачи. `QA-012` и `INT-018` не имеют детей и поэтому входят в445 исполнимых задач.

| Область | Все описания | Блоки общей приёмки | Самостоятельные задачи |
| --- | ---: | ---: | ---: |
| UI: экраны, функции, модули |318|81|237|
| Сервисы и runtime |126|42|84|
| Windows10/11 |21|7|14|
| macOS |18|6|12|
| Hosted Web |27|9|18|
| Интеграция |54|17|37|
| QA |43|12|31|
| Релиз |6|2|4|
| Перепроверка |12|4|8|
| **Всего** |**625**|**180**|**445**|

Это объём незакрытой полной приёмки, а не445 функций, которые отсутствуют в коде. Во многих задачах уже есть реализация и частичные доказательства. Исполнитель сначала сверяет текущий код и завершает остаток требований.

Точная раскладка всех445 задач: [launch-plan.json](parallel-work/launch-plan.json). Для каждой сохранены исходные Requirements, DoD, полная функциональная проверка, метод теста и ссылки на код с закреплёнными SHA. Назначение проверено автоматически: пропусков, повторных владельцев и неизвестных ID нет.

## [PW-RU-NOW] Что запускаем сейчас

1. **Один интегратор объединяет17 открытых PR.** Разные конфликтующие файлы разбираются параллельно, но общую ветку и merge-коммиты меняет только интегратор. Сначала читаем обе стороны и реальные контракты. После слияния проверяем frozen lockfile, типы, затронутые сценарии, сборку WebUI и запуск собранного сервера. Затем подтверждаем `main` и состояния PR через GitHub. Локальное включение коммитов не равно удалённому merge.
2. **Windows, macOS и Web стартуют одновременно.** Сборочные скрипты, native staging, installer, браузерные адаптеры, identity, staging и тестовые среды разрабатываются независимо. Завершение одного целевого продукта не является входом для другого.
3. **237 UI-задач и84 сервисные задачи распределяем по модулям.** Отдельные ветки, точные разрешённые пути, один владелец общего файла. Потребитель начинает на текущем контракте и явно описывает необходимые изменения. Синтетический успешный ответ не закрывает реальный DoD.
4. **37 интеграционных и47 QA/release/recheck задач начинаются сразу.** Их подготовка — сценарии, fixtures, наблюдаемость, негативные контроли, CI и provisioning — не ждёт завершения разработки всех модулей. Конкретный сквозной прогон ждёт только потребляемые им результаты.
5. **Среды готовим параллельно.** Windows10/11 GUI, macOS arm64/Intel, signing/notarization, provider sandboxes, HTTPS/WSS, постоянное хранилище, браузеры и update feed. Отсутствие одного ресурса блокирует его проверку, а не весь проект.
6. **Незакоммиченный прогресс переносим через проверенные снимки.** Compound/OMP/sidebar рабочие копии сохраняются. Анализ и сравнение можно делать сразу; финальная интеграция требует конкретного коммита или хеша принятого изменения.

В текущей сессии доступно **4 агентских места: интегратор +3 исполнителя**. Это реальная ёмкость, а не обещание445 одновременных агентов. После объединения PR начальные рабочие места распределяются на Windows, macOS и Web; освобождённое или ожидающее внешнего ресурса место получает следующую готовую задачу. При добавлении исполнителей независимые сервисные и UI-потоки расширяются без изменения графа.

## [PW-RU-WIN] Параллельный поток Windows

| Пакет | Задачи | Работа и результат |
| --- | --- | --- |
| P-WIN-BUILD |WIN-001.1, WIN-001.2|Общие main/preload/interceptor сборки; обязательные helpers; manifest путей, версий, архитектур и хешей|
| P-WIN-NATIVE |WIN-002.1, WIN-002.2|Windows native dependencies, ABI и staging; реальная загрузка в установленном приложении|
| P-WIN-INSTALL |WIN-003.1, WIN-003.2|Installer/launcher; права обычного пользователя, upgrade/uninstall и политика сохранения данных|
| P-WIN-UPDATE |WIN-004.1, WIN-004.2|Подпись, updater/feed; переход N→N+1, прерывание, восстановление|
| P-WIN-MEDIA |WIN-005.1, WIN-005.2|Media/device/browser permission сценарии и отрицательные проверки|
| P-WIN-SIDECAR |WIN-006.1, WIN-006.2|Поддерживаемый sidecar/IPC/process lifecycle; явный fallback и capability contract|
| P-WIN-UX |WIN-007.1, WIN-007.2|DPI, keyboard, accessibility, окна и системная интеграция|

Разработку всех пакетов можно начать сейчас. Полный runtime DoD требует **отдельных установленных GUI-прогонов Windows10 и Windows11**; cross-build на Mac не заменяет их. Пакет native может подготовить бинарники раньше installer, а загрузку этих бинарников проверяет после сборки installer — это две разные фазы, а не цикл зависимости целых задач.

## [PW-RU-MAC] Параллельный поток macOS

| Пакет | Задачи | Работа и результат |
| --- | --- | --- |
| P-MAC-NAMES |MAC-001.1, MAC-001.2|Единые application identity/naming/bundle contract и сборочные entrypoints|
| P-MAC-NATIVE |MAC-002.1, MAC-002.2|Архитектуры native dependencies/helpers; arm64/Intel runtime closure|
| P-MAC-SIGN |MAC-003.1, MAC-003.2|Подпись вложенных компонентов, notarization, stapling, Gatekeeper/Finder launch|
| P-MAC-UPDATE |MAC-004.1, MAC-004.2|Подписанный feed и реальное обновление N→N+1 с отказами|
| P-MAC-PERMISSIONS |MAC-005.1, MAC-005.2|Keychain, microphone/media/LAN и жизненный цикл permissions|
| P-MAC-LIFECYCLE |MAC-006.1, MAC-006.2|Окна/Dock, sleep/wake, subprocess cleanup и installed lifecycle|

Сборка и тестовый harness не ждут сертификатов. Подпись конкретного артефакта ждёт его байты и рабочую signing identity. Intel runtime и минимальная заявленная версия macOS требуют собственных доказательств; существование development Electron процесса на одном Mac этого не подтверждает.

## [PW-RU-WEB] Параллельный поток hosted Web

| Пакет | Задачи | Работа и результат |
| --- | --- | --- |
| P-WEB-BUILD |WEB-001.1, WEB-001.2|WebUI/server/container build, runtime assets и воспроизводимый deployable artifact|
| P-WEB-IDENTITY |WEB-002.1, WEB-002.2|Доверенная identity, tenant/workspace ownership, session/login/revoke|
| P-WEB-OPS |WEB-003.1, WEB-003.2|HTTPS/WSS ingress, storage, restart/backup/restore и эксплуатация|
| P-WEB-FILES |WEB-004.1, WEB-004.2|Браузерные upload/download/file операции, ограничения и серверная проверка|
| P-WEB-NAV |WEB-005.1, WEB-005.2|Direct links, browser history, refresh, capability-aware routes/actions|
| P-WEB-AUTH-NOTIFY |WEB-006.1, WEB-006.2|OAuth redirect, notification/browser permissions и честные недоступные состояния|
| P-WEB-MEDIA |WEB-007.1, WEB-007.2|Реальный secure-context media/device путь и fallback|
| P-WEB-RECOVERY |WEB-008.1, WEB-008.2|Reconnect, lost ACK, persistence/restart/upgrade и восстановление клиента|
| P-WEB-VIEWER |WEB-009.1, WEB-009.2|Hosted viewer/share API, Cloudflare Functions/R2, create/revoke/readback|

Планировочное допущение — сервис с изоляцией account/workspace. Персональный hosted режим можно поддержать через тот же явный контракт ownership. Режим продукта нужно закрепить до принятия новой identity schema; подготовка сборки, browser adapters и staging может продолжаться независимо.

Приёмка Web означает настоящий authenticated browser→HTTPS/WSS→server→persisted state путь. Vite renderer, fixture login и HTTP200 имеют ограниченный смысл и не принимают hosted приложение целиком.

## [PW-RU-DOMAINS] Как распараллелить экраны и сервисы

- **UI:**81 владельцев поверхностей,237 независимых leaf-пакетов. [surface-plan.json](parallel-work/surface-plan.json) содержит разрешённые пути, ветки, необходимые producer outputs, подготовку fixtures и четыре target lanes.948 target activities — это Windows10/11/macOS/Web прогоны существующих задач, а не новые948 задачи.
- **Сервисы:**42 доменных блока,84 независимые leaf-задачи. [service-plan.json](parallel-work/service-plan.json) содержит16 владельцев общих контрактов,22 реальных output dependencies,9 runtime sequences и10 групп сквозных contract tests.
- **Интеграция:**37 отдельных задач. Протокол, capability matrix, grants, credential custody, sidecars, persistence, media, provider operations и сборочные артефакты проверяются сквозными сценариями по мере готовности входов.
- **QA/release/recheck:**47 отдельных задач. Типы/CI/harness/accessibility/performance/security/recovery/install-upgrade/operations/SBOM/runbooks/source closure/final candidate/signoff готовятся одновременно с кодом. Точные IDs и владельцы каждого пакета доступны в [platform-plan.json](parallel-work/platform-plan.json).

Общие файлы `protocol`, authority, credentials, config, SQLite, OMP transport, build manifests/lock, UI shell/routes и locales имеют одного владельца продвижения изменений. Другие исполнители делают ограниченные patches и тесты в собственных ветках. Совпадение пути требует согласовать перенос, а не ждать окончания всего чужого модуля.

## [PW-RU-SEQUENCE] Где последовательность действительно неизбежна

| Результат-предшественник | Операция-потребитель | Почему нельзя переставить | Что продолжается параллельно |
| --- | --- | --- | --- |
|Версионированный реальный RPC/capability contract|Полная сериализация и permission proof между runtime|Обе стороны должны одинаково интерпретировать сообщение|Adapters, компоненты и fixtures на текущем контракте|
|Доверенный actor и актуальный workspace grant|Защищённое чтение/запись/subscription|Авторизация предшествует конкретной операции|UI/state/negative tests и другие домены|
|Принятая schema/ownership migration|Первая запись в мигрированный store|Нельзя писать раньше подготовки схемы и владельца|Migration fixtures, UI и другие stores|
|Durable commit и подтверждённый ACK|Readback/replay/restart proof|Проверяется уже совершённая запись|Другие операции и реализация других задач|
|Native binaries/helpers нужной архитектуры|Сборка installer/app|Артефакт должен включать реальные байты|Build scripts, installer UX, другие targets|
|Готовый artifact +signing identity|Sign/notarize/staple/installed proof|Подписываются конкретные байты|Unsigned smoke, другие targets и provisioning|
|Подписанные N и N+1 +feed|Реальный upgrade/interruption/rollback|Это входы операции обновления|Updater tests, feed code, остальная разработка|
|Qualified server +TLS/WSS +durable storage|Полный hosted login/file/reconnect/restart путь|Browser требует реально работающий сервер|Web components, local contract tests, адаптеры|
|Provider grant +разрешённый аккаунт|Реальный send/write/readback/revoke|Внешний эффект требует конкретного доступа|Synthetic negative tests и другие providers|
|Точный merged source/lock/artifact|Финальные SBOM/provenance/replay/signoff|Доказательства должны описывать выпускаемую ревизию|Непрерывные предварительные domain tests|

Эти рёбра привязаны к **конкретному результату и фазе**, а не к завершению всего parent/producer DoD. Если нужный producer output уже реализован и подтверждён, искусственно ждать переделки целого сервиса не требуется.

Не являются обязательными последовательностями: «сначала весь backend, потом весь UI»; «сначала Mac, потом Windows/Web»; «сначала все типы, потом любые fixtures»; «ждать полного feature freeze перед подготовкой тестов». Ресурс signing/GUI или общий файл может использоваться по очереди, но это локальное ограничение ресурса.

## [PW-RU-HANDOFF] Формат назначения и результата

Каждому исполнителю выдаются: leaf IDs, immutable source SHA, branch/worktree, разрешённые пути, владелец общих контрактов, реальные входы и outputs, artifact directory, команды и исходные четыре поля приёмки.

Исполнитель возвращает: patch/commit, изменённые контракты и migration/compatibility notes, lock/toolchain/artifact hashes, exact commands/exit codes, positive/negative/race/restart evidence, независимый persisted readback, target coverage и конкретные недоступные ресурсы. Родительский владелец отдельно проверяет полный breadth/combination workflow.

### [PW-RU-DOD] Критерий готовности плана

**Requirements:**Все445 leaf-задач распределены без пропусков и дублей; Windows10/11, macOS и hosted Web запускаются одновременно; parent требования сохраняются; зависимости отражают необходимые outputs и фазы.

**DoD:**Машинная проверка подтверждает445 unique assignments,180 rollups,625 исходных описаний. Состояния локального объединения, удалённого merge, runtime checks и финальной платформенной приёмки разделены в [PR receipt](parallel-work/pr-integration-receipt.json).

**Полная функциональная проверка:**Проследить каждый leaf ID от исходного Requirements до владельца, source reference, output dependencies, target proof и parent closure. Проверить все17 исходных PR по exact head/main ancestry и фактическому GitHub state.

**Метод теста:**`bun scripts/final-readiness-parallel-plan.ts`; `bun scripts/final-readiness-audit.ts --validate`; повторный GitHub readback после merge; отдельный postmerge source/runtime check на закреплённом итоговом SHA. Исторические результаты не переименовываются в текущие.
