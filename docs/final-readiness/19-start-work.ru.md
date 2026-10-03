# [RUN] Практический запуск параллельной доработки ROX

## [RUN-BASELINE] Исходник, объём и состояние запуска

Канонический репозиторий: `rox-one/rox-one`. Проверяемый исходник: `e0740755da02fa31112216b1a32b6d707c3a2cc1`, включающий `main` `7e24a97cc8bef429d95c9f703420805f9153a99b` и desktop0.11.7. Все19 PR исходного набора и поздних поступлений уже имеют состояние MERGED; отдельная независимая интеграция усиливает startup/authority, OMP, Projects/Roadmap и отмену online TTS. Фактическое продвижение этой интеграции фиксирует [receipt](parallel-work/pr-integration-receipt.json).

Рабочий объём: **445 исполняемых задач**, из них237 UI,84 сервисных,14 Windows,12 macOS,18 Web,37 интеграционных,31 QA,4 релизных и8 перепроверок. Дополнительно180 родительских блоков общей приёмки. Подготовленные16 задач ниже входят в445; подразделы этого документа уточняют их работу и не увеличивают счётчик.

Полные исходные Requirements, DoD, Full functional verification, Test method и immutable code references каждой из445 задач сохранены в [launch-plan.json](parallel-work/launch-plan.json). Краткие критерии ниже дополняют конкретную фазу запуска и не заменяют полный DoD.

## [RUN-DISPATCH] Как выдавать работу и поддерживать параллелизм

1. Интегратор фиксирует принятый SHA и передаёт его трём исполнителям. Каждый работает в отдельной ветке/worktree. Исходные пользовательские WIP не сбрасываются.
2. Исполнитель получает leaf ID, разрешённые пути, владельца общих файлов, входы/выходы, original acceptance и каталог доказательств. Статусы: `PREPARING`, `IMPLEMENTING`, `WAITING_FOR_OUTPUT`, `WAITING_FOR_RESOURCE`, `READY_FOR_REVIEW`, `PARTIALLY_VERIFIED`, `FULL_DOD_CLOSED`.
3. Исполнитель, ожидающий подписания/GUI/provider, продолжает следующую готовую leaf-задачу. Ожидание ресурса сохраняется у конкретной операции; оно не удерживает всё рабочее место.
4. Промежуточные совместимые patches интегрируются после проверки. Одновременное редактирование одного checkout запрещено; отдельные worktrees допускают параллельные варианты общего файла, переносит их его владелец.
5. Подготовка контрактных тестов и отрицательных сценариев начинается вместе с реализацией. По готовности producer output запускается соответствующий composed workflow; не ждём завершения всех445 задач.
6. Если добавляются исполнители, первый резервный поток — shared contracts/authority/persistence, второй — UI-поверхности, третий — CI/security/provisioning. Количество исполнителей определяется доступной средой и качеством review; в этой сессии реально доступны интегратор+3 исполнителя.

**Requirements:** Каждый leaf назначен одному ответственному; изменения общего контракта явно согласованы; запуск Windows/macOS/Web одновременный.

**DoD:** Выданные задания имеют точный SHA, границы правок, входы/выходы и четыре исходных поля приёмки; очередь готовых задач существует для каждого рабочего места.

**Full functional verification:** Для выбранной задачи проследить baseline→patch→контракт→реальный результат→persisted readback→parent acceptance; отдельно подтвердить недостающий ресурс.

**Test method:** Проверка уникальных445 IDs генератором плана, git diff/ancestry, source-pinned logs и независимый просмотр результатов интегратором.

## [RUN-WIN] Рабочее место Windows10/Windows11

Ветка: `develop/windows-readiness-2026-10-03`. Начальная подготовка: **WIN-001.1, WIN-001.2, WIN-002.1, WIN-002.2**. [Полный пакет и команды](parallel-work/first-wave-windows.json) закреплён на387; перед patch сверить его выводы с текущим0.11.7.

### [RUN-WIN-BUILD] Единая сборка и обязательные helpers

- WIN-001.1: направить legacy PowerShell/прочие Windows entrypoints в канонический release pipeline; согласовать main/preload/interceptor и флаги. Устранить устаревший Bun1.3.9 и остановку чужих процессов в legacy scripts.
- WIN-001.2: обязательный manifest для каждого helper: имя, путь, версия, target architecture, SHA256, способ runtime discovery. Добавить отказ сборки при пропавшем, подменённом или неверной архитектуры helper. Учитывать существующий staging Claude/Bun/uv/ripgrep/Pi/Turso вместо повторной реализации.
- Source: [desktop-release.ts](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/scripts/desktop-release.ts), [electron-builder.yml](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/apps/electron/electron-builder.yml).

**Requirements:** Все поддерживаемые Windows entrypoints дают одинаковый target contract; обязательные helpers присутствуют и проверяются до упаковки.

**DoD:** Release pipeline формирует unsigned x64 artifact и manifest; deletion/tamper/wrong-architecture проверки завершаются ожидаемым отказом; полный WIN-001 приёмочный набор остаётся обязательным.

**Full functional verification:** Установить artifact обычным пользователем на чистых Win10 и Win11; выполнить команды, использующие каждый helper, подтвердить его реальный путь, версию и завершение процесса.

**Test method:** Existing packaging/staging suites, canonical Windows CI build, чистые VM и runtime probes из first-wave пакета; сохранить source/artifact hashes и логи.

### [RUN-WIN-NATIVE] Native closure и чистая машина

- WIN-002.1: сформировать полный runtime closure libSQL/image/native/worker dependencies, сохраняя уже реализованные nativeImage/Sharp пути; проверять загрузку внутри shipped Electron, а не только CI Node24.
- WIN-002.2: проверить VC++ prerequisites/recovery, discovery и extraction assumptions на чистой машине; завершить пользовательские понятные состояния и локализацию prerequisite action.
- Installer, feed/update, media, sidecar и UX пакеты WIN-003…007 можно разрабатывать одновременно с этими двумя задачами. Runtime proof начинает потреблять реальные native bytes после их staging.

**Requirements:** Native dependencies/helper architecture совместимы с shipped Electron и поддерживаемыми Win10/11; отсутствие prerequisite диагностируется и имеет рабочий recovery.

**DoD:** App, native modules и workers запускаются после чистой установки; missing/invalid dependency вызывает ожидаемый понятный отказ; полный WIN-002 acceptance выполнен на обоих OS.

**Full functional verification:** Новый пользователь/чистая VM→install→launch→SQLite write/readback→image operation→helper operation→restart; повторить отрицательные prerequisites и восстановление.

**Test method:** Manifest/ABI/hash probes, installed Electron runtime checks и GUI recording/logs отдельно для Win10/Win11.

## [RUN-MAC] Рабочее место macOS

Ветка: `develop/macos-readiness-2026-10-03`. Подготовлены **MAC-001.1/.2, MAC-002.1/.2, MAC-003.1/.2**. [Полный пакет](parallel-work/first-wave-macos.json) содержит исходные24 acceptance поля, конкретные patches и отдельные дополнительные критерии.

### [RUN-MAC-IDENTITY] Bundle, DMG и artwork

- MAC-001.1: свести legacy Darwin/common/DMG/bootstrap scripts к текущей Rox identity и каноническому pipeline. Уже исправленные main productFilename/artifact names сохранять.
- MAC-001.2: пересобрать approved artwork и stamp для Assets.car; отсутствие source SHA stamp исправлять воспроизводимой генерацией. Bootstrap должен выбирать проверенную application identity; проверить quarantine/Gatekeeper путь.
- Source: [desktop-release.ts](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/scripts/desktop-release.ts), [electron-builder.yml](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/apps/electron/electron-builder.yml).

**Requirements:** Сборочные входы, bundle/display/product/artifact identity и artwork согласованы и проверяемы.

**DoD:** Повторная сборка даёт ожидаемые bundle/DMG/ZIP имена и проверенный artwork; legacy entrypoints не выбирают случайный `.app`; полный MAC-001 acceptance сохранён.

**Full functional verification:** Открыть DMG через Finder, установить и запустить точный Rox bundle; проверить icon/name/path, повторное открытие и обновление установленного приложения.

**Test method:** Identity/artifact manifest checks, artwork regeneration/hash checks, Finder/Gatekeeper screenshots и installed launch logs.

### [RUN-MAC-NATIVE] Архитектуры и минимальная OS

- MAC-002.1/.2: замкнуть external Sharp/ONNX/transformers/native runtime dependencies и helpers по архитектуре. Нельзя подменять актуальную nested Sharp0.35.4 старой root optional версией.
- Текущий pinned Turso0.7.2 не даёт Darwin x64 binary; Intel runtime требует отдельного решения зависимости и настоящего Intel runner. До его принятия Intel support не закрыт.
- Проверить minimum OS всех обязательных бинарников. У проверенного Bun1.3.14 arm64 `minos13.0`; заявленная минимальная macOS должна соответствовать всему runtime closure.

**Requirements:** Каждый заявленный target architecture/minimum OS имеет полный совместимый набор runtime bytes и helpers.

**DoD:** Architecture/native manifest проходит; packaged runtime реально загружает модули на каждой поддерживаемой архитектуре и минимальной OS; неподдерживаемый target явно отражён в release scope.

**Full functional verification:** Чистая arm64 и Intel среда→Finder launch→SQLite/image/model/helper operation→restart; отдельно проверить нижнюю заявленную OS.

**Test method:** Mach-O/vtool/file/ABI probes, clean packaged runtime workflows; current development ARM launch не заменяет Intel и minimum-OS acceptance.

### [RUN-MAC-SIGN] Signing, notarization, permissions

- MAC-003.1/.2: подтвердить настоящую signing identity/team, вложенные подписи, entitlements, minimum OS, notarization, stapling и Gatekeeper. Наличие CSC_LINK или флага `signed` не завершает эту работу.
- MAC-004 updater может готовиться уже сейчас; Main0.11.7 обновил feed/latest metadata, поэтому прежние387 замечания нужно перечитать перед исправлением. Тест upgrade ждёт конкретную пару подписанных N/N+1.
- MAC-005 permissions и MAC-006 Dock/window/sleep/quit разрабатываются отдельно; устройства и signing session выдаются на конкретный тестовый прогон.

**Requirements:** Подписываются точные accepted bytes; credentials доступны только authorised signing runner; permissions и entitlements соответствуют runtime.

**DoD:** Подписи, notarization ticket, staple и Gatekeeper подтверждены; installed lifecycle и upgrade проверены на заявленных targets; полный MAC-003 acceptance выполнен.

**Full functional verification:** Download/DMG→quarantine→Finder launch→permission grant/deny/recovery→quit/relaunch; проверить изменённый/неподписанный artifact как отрицательный контроль.

**Test method:** codesign/spctl/notarytool/stapler receipts с artifact hash и GUI evidence; unit fixtures ограничены своим уровнем доказательств.

## [RUN-WEB] Рабочее место hosted Web

Ветка: `develop/hosted-web-readiness-2026-10-03`. Подготовлены **WEB-001.1/.2, WEB-002.1/.2, WEB-003.1/.2**. [Полный пакет](parallel-work/first-wave-web.json) содержит55 pinned references,9 patches и7 resource gates.

### [RUN-WEB-BUILD] Container и standalone delivery

- WEB-001.1: исправить COPY отсутствующего docs-site manifest; замкнуть workspace manifests с cloud-runner/cloud-gateway/workspace-service; использовать актуальный Bun ESM Pi build; объединить source Docker и generated distribution delivery contract.
- WEB-001.2: закрепить runtime/architecture/native/helper dependencies, непривилегированного пользователя и точный WebUI artifact; проверить `.dockerignore` и исключение `.env` из build context.
- Source: [Dockerfile.server](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/Dockerfile.server), [server entry](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/packages/server/src/index.ts), [WebUI config](https://github.com/rox-one/rox-one/blob/e0740755da02fa31112216b1a32b6d707c3a2cc1/apps/webui/vite.config.ts).

**Requirements:** Container и standalone содержат реальные совместимые assets/helpers/runtime; build воспроизводим без пользовательских secrets и undeclared workspaces.

**DoD:** Чистый build и запуск artifact успешны; assets/helpers обнаруживаются из artifact; build context и непривилегированный UID проверены; полный WEB-001 acceptance сохранён.

**Full functional verification:** Новый host/container→boot→реальный WebUI→authenticated RPC→helper operation→restart→readback; проверить missing asset/helper и wrong architecture.

**Test method:** Frozen install, clean container build, packaged smoke/manifest checks и реальные browser/server flows.

### [RUN-WEB-IDENTITY] Session и workspace isolation

- WEB-002.1: завершить cookie expiry, logout/revoke и действующие WebSocket sessions; согласовать ROX/CRAFT environment glue между server и WebUI.
- WEB-002.2: закрепить product mode до новой identity schema: isolated account/workspace либо явно персональный instance. Существующие trusted actor/native grants/ACK/authority protections сохранять.
- Login UI, отрицательные cross-workspace fixtures и browser adapters можно делать одновременно; защищённая запись потребляет реальный actor/grant до исполнения.

**Requirements:** Cookie/session/WS lifecycle един; каждое workspace чтение/запись/subscription авторизуется текущим principal и ownership.

**DoD:** Login/logout/expiry/revoke и cross-account/cross-workspace отрицательные проверки проходят; перезапуск не восстанавливает revoked authority; полный WEB-002 acceptance закрыт.

**Full functional verification:** Два настоящих аккаунта/instances→login→own workspace read/write→чужой workspace отказ→logout/revoke→закрытие доступа текущего WS→relogin и persisted readback.

**Test method:** Authority/cookie/RPC contract tests плюс независимый HTTPS browser E2E с двумя principals; fixture identity не завершает hosted acceptance.

### [RUN-WEB-OPS] TLS/WSS и durable deployment

- WEB-003.1: trusted forwarded host/proto, direct peer evidence в Node adapter, public WSS URL, CSP/security headers; insecure bind должен отклоняться до readiness.
- WEB-003.2: явные durable roots/volumes для data/custody/native/browser/profile/cache/jobs; согласовать UID и restore policy. Legacy config root fallback сначала проверить, не предполагать потерю данных без доказательств.
- WEB-004 files,005 navigation,006 OAuth/notifications,007 media,008 recovery и009 viewer/share APIs стартуют отдельными patches на текущих контрактах; staging инфраструктура готовится параллельно.

**Requirements:** Secure origin/transport корректны; container replacement сохраняет требуемое состояние и authority; backup не нарушает custody.

**DoD:** HTTPS/WSS, headers/origin негативные проверки, restart/reconnect и clean backup/restore дают ожидаемый readback; полный WEB-003 acceptance выполнен.

**Full functional verification:** Authenticated browser→upload/write→lost connection/ACK→container replacement→reconnect/readback→backup→clean restore→revoke; проверить hostile forwarding/origin.

**Test method:** Proxy/security contract tests, реальные Chrome/Firefox/Safari workflows в staging, server/artifact/storage hashes и независимый restore receipt.

## [RUN-SHARED] Одновременная общая работа

| Поток | Объём | Начало прямо сейчас | Доказательство завершения |
| --- | ---: | --- | --- |
| UI-поверхности |237 leaves/81 parent owners|Сверка уже реализованного, точные component patches, race/negative/target fixtures|Полный journey на требуемых target runtimes и parent combination|
| Сервисные домены |84 leaves/42 envelopes|RPC/authority/custody/jobs/OMP/media/providers по отдельным модулям|Реальный contract/persistence/readback/restart и provider operation при наличии grant|
| Интеграция |37 leaves|Контракты, capabilities, harness и composed сценарии|Cross-runtime positive/negative/race/replay receipt на точной ревизии|
| QA |31 leaves|CI/types/security/performance/accessibility/recovery/provisioning|Нужный test/installed/browser evidence и устранённые реальные дефекты|
| Релиз/перепроверка |12 leaves|SBOM/runbooks/provenance tooling и повторные проверки|Точный source/lock/artifact, signed installed/deployed signoff|

При фактических3 worker slots сначала закрываются независимые target patches, затем освобождённые места получают ready UI/service/QA leaves. Доменным владельцам уже назначены все445 ID в машинном плане; это не утверждение, что сейчас работает445 процессов. Дополнительные агенты разумно размещать на отдельных runners: текущая host нагрузка790+ сделала повторный большой compiler matrix непригодным для оперативного продвижения.

**Requirements:** Общие RPC/auth/SQLite/credentials/build/locale файлы имеют одного владельца продвижения; каждый module patch сохраняет совместимость и предыдущую функциональность.

**DoD:** Scoped changes reviewed/integrated; leaf acceptance имеет актуальный источник/команды/результаты/ограничения; parent owner проверил полный сочетанный сценарий.

**Full functional verification:** От UI action до authorisation/service/commit/ACK/independent readback; повторить negative/race/restart и требуемые targets.

**Test method:** Existing focused suites, добавленные тесты реального дефекта, contract E2E, isolated installed/browser workflows и final replay на exact candidate.

## [RUN-ORDER] Обязательный порядок только внутри потребляющей операции

Независимая проверка машинного плана даёт следующую классификацию **по явно записанным доменным/интеграционным входам полной приёмки**:

| Область | Leaf с явными зависимостями приёмки | Leaf без таких записанных входов |
| --- | ---: | ---: |
| UI |221|16|
| Сервисы |30|54|
| Windows |14|0|
| macOS |12|0|
| Web |18|0|
| Интеграция |18|19|
| QA |26|5|
| Релиз |4|0|
| Перепроверка |8|0|
| **Всего** |**351**|**94**|

Если дополнительно учитывать одинаковые для всех UI входы финальной приёмки — immutable accepted source и реальный target artifact — получается **367 с входами /78 без записанных входов**. Ни94, ни78 не означают, что соответствующие среды уже готовы или что финальная приёмка независима от источника. Эти две точные метрики используют разные определения; они не являются оценкой числа сейчас работающих исполнителей.

В плане350 сохранённых групп зависимостей:22 service,247 UI,81 platform. Группа может иметь несколько потребителей/фаз; это не350 новых задач и не350 уникальных последовательных цепочек. В отчёте проверки есть раскрытие конкретных consumers и проверка package/contract references.

Точная таблица10 классов зависимостей — в [17](17-parallel-launch-plan.ru.md#pw-ru-sequence-где-последовательность-действительно-неизбежна). Практические цепочки:

- Native bytes/helpers→assembly→signature/notarization→installed acceptance.
- Подписанные N и N+1 +feed→upgrade→interruption/recovery readback.
- Actor/grant→protected operation→durable commit/ACK→readback/restart/replay.
- Принятая schema/ownership migration→первая запись в конкретный store.
- Server +TLS/WSS +durable storage→authenticated hosted browser E2E.
- Provider grant/account→real external effect→independent readback/revoke.
- Точный merged source/lock/artifact→финальные SBOM/provenance/replay/signoff.

Одна leaf-задача может содержать независимую реализацию и более позднюю зависимую проверку. Поэтому нельзя корректно сложить «445 параллельных» и ещё отдельное число «последовательных» как непересекающиеся задачи. Подготовку всех445 можно начать; фактическую readiness конкретной операции определяет полученный output и ресурс. Глобальных очередей Windows→Mac→Web или backend→UI здесь нет.

**Requirements:** Ребро задаёт реальный producer output и конкретную consumer phase; существующий подтверждённый output принимается без ожидания полного parent DoD.

**DoD:** Для каждого заблокированного действия записаны отсутствующий output/resource, producer/владелец и параллельно доступная следующая работа.

**Full functional verification:** Удалить/изменить вход — dependent операция должна корректно отказать; вернуть квалифицированный вход — workflow завершается и даёт независимый readback.

**Test method:** Проверка output registry, compatibility/negative fixtures, source-pinned E2E и resource lease receipts.
