# Незавершённые инициативы и остаточный бэклог

**Срез репозитория:** 2026-08-20
**Назначение:** единый перечень работ, которые были спроектированы, начаты или явно отложены, но ещё не доведены до заявленного конечного состояния.

## Как читать этот документ

- Это не перечень всех возможных идей. Включены только направления, для которых в репозитории есть код, план, PRD, ADR, зафиксированный follow-up или открытое решение.
- `Остаток` означает недоделанную работу; `блокер` — внешнее решение или доступ; `отложено` — сознательно вынесено из текущего среза; `проверить` — документация и код расходятся либо нет свежего сквозного доказательства.
- Старые незачёркнутые checkbox'ы сами по себе не считаются доказательством: несколько планов не обновлялись после реализации. Где более свежий статус говорит `landed`/`done`, работа ниже не дублируется.
- Полностью закрытые OMP v2 G1–G4, Collections B0–B6 и уже приземлённые native index/journal/exec срезы в бэклог не включены.

## Краткая карта

| # | Направление | Состояние | Что осталось |
|---:|---|---|---|
| 1 | Unified shell / Workbench | остаток, feature flag OFF | наполнить слоты, оживить inspector, решить выпуск |
| 2 | Knowledge + SiYuan | частично реализовано / блокер | динамические разделы, безопасная запись, publication, managed/remote |
| 3 | White-label Knowledge Engine | план начат | завершить K-срезы, provider gate и E2E |
| 4 | Connection Fabric / secrets | частично реализовано | hardening recovery, delivery/import, сквозные проверки |
| 5 | Self-learning memory | v1/v2 частично | UI кандидатов, diff/update, usage/insights, E2E |
| 6 | Session Map/Outline/Workbench | основной срез есть | enrich, materialize/export, адаптер, QA |
| 7 | Session list command surface | отложено | command/search grammar и bulk command UX |
| 8 | iOS/iPadOS client | начат | завершить MVP, offline/permissions/attachments, iPad QA |
| 9 | Discord adapter | начат | gateway, transport, UI, i18n и live E2E |
| 10 | Cloud Runs | частично | WS, CI enablement, E2B/OMP image, auth evolution, hardening |
| 11 | Native substrate | opt-in | production delivery/cross-platform, stabilization, deferred native services |
| 12 | Runtime/context/marketplace | частично | сверить M1–M5, platform locks и app smoke |
| 13 | Identity migration | частично | irreversible identifiers, OAuth/deep links, artwork, website flip |
| 14 | Viewer/share security | fast-follow | rate limit, R2 lifecycle, conditional writes, headers/encoding |
| 15 | MCP/secrets operational UX | backend готов, UX неполон | provider UI, rotation/audit, legacy cleanup |
| 16 | Branch/repository hygiene | решение принято, не исполнено | remote cleanup после human approval, donor test disposition |
| 17 | Накопленные test/ops defects | известные дефекты | pdfjs, manifest 401, root typecheck, fresh-machine matrix |

## Полный перечень

### 1. Unified shell и Workbench

**Уже есть:** экспериментальный `PanelHost`, registry/slots, knowledge inspector contribution и Workbench-срезы. Флаг unified shell по-прежнему выключен по умолчанию.

**Осталось:**

- добавить реальные core contributions в слоты `activity`, `navigator-primary`, `navigator-secondary`, `bottom`, `status`;
- заменить заглушки секций Inspector (`agent`, `outline`, `backlinks`) на живые реализации; сейчас live только `info`;
- довести restore/persistence вкладок и стабильные surface instance ids, особенно для browser/knowledge;
- закрыть crash isolation/restart UX Extension Host и degraded-state расширений;
- принять продуктовый verdict: оставить экспериментом, включить по умолчанию или снять вторую оболочку;
- выполнить полноценный keyboard/accessibility/manual E2E для restored layout, панелей и расширений.

### 2. Knowledge и интеграция SiYuan

**Уже есть:** read-only knowledge tools, navigator для notebooks/views/recent/favorites, настройки подключения, managed kernel intent и часть knowledge runtime.

**Осталось:**

- дать реальные provider contracts и данные разделам Inbox, Daily, Databases и Tags, которые сейчас dynamic-empty;
- смонтировать/интегрировать `KnowledgeAgentPanel` вместо сохранения неиспользуемой W2-поверхности;
- реализовать write-proposal tools и полный безопасный цикл preview → permission → snapshot → apply → verify → rollback;
- завершить publication pipeline с provenance, конфликтами, идемпотентностью и восстановлением;
- довести collection/view engine для knowledge и runs, включая remote-domain collapse/saved-view semantics;
- определить пороги G1-метрик, которые пока `TBD`, и прогнать их на реальных базах;
- реализовать remote TLS UI и диагностику (тип режима уже предусмотрен);
- принять юридико-коммерческое решение по managed SiYuan (G2). До него shipping binding остаётся `external-local`;
- H3 in-process knowledge kernel остаётся только намерением и не запланирован: для старта нужен отдельный human decision;
- закрыть вопросы лицензирования, атрибуции, API clean-room и условий публичного релиза.

### 3. White-label Knowledge Engine

Это отдельная начатая программа поверх Knowledge/SiYuan, а не синоним пункта 2.

**Осталось:**

- сверить фактическое выполнение всех K-срезов плана с кодом и отметить их статус в самом плане;
- завершить managed spawn и затем remote TLS UX без расхождения error-code contract;
- зафиксировать provider gate: repository/commit/license/EE boundary/notices/trademark/TLS/auth/tenant behavior;
- довести broker/delivery/import/recovery/WorkGraph metadata ledger до заявленной матрицы тестов;
- доказать, что raw secrets не попадают в renderer, agent context, логи и remote/headless transport;
- выполнить E2E GitHub operation, revoke/rotate/repair и feature-off parity.

### 4. Rox Connection Fabric и secret delivery

**Уже есть:** CF-2 recovery, CF-4 leases, CF-5..8 persistence/UI/GitHub/Infisical и базовая secrets-provider вертикаль.

**Осталось:**

- завершить remaining hardening из CF1 review: восстановление после повреждения/частичной миграции, quarantine/backup/rollback и key-unavailable сценарии;
- проверить атомарность импорта, разрешение конфликтов, masked preview и rollback на реальных провайдерах;
- закрыть все delivery modes (header/proxy/helper/FD/temp-file cleanup), оставляя env только явным legacy fallback;
- проверить TTL/audience/workspace/consumer/action/resource матрицу lease broker;
- провести end-to-end revoke/rotate/repair revalidation;
- не начинать дополнительный Infisical adapter/режим до стабилизации provider contract, как требует gate;
- проверить local-only routing и явный отказ remote/headless каналам в выдаче provider authority.

### 5. Самообучение, память и skills lifecycle

**Уже есть:** lesson/memory stores, decay, provenance, audit log, graph, pending queue и часть RPC/test инфраструктуры.

**Осталось:**

- закончить UI pending skills: badge, просмотр `SKILL.md`, risk flags, Approve/Dismiss;
- реализовать/проверить update-кандидаты существующего skill, version snapshots и `skills.pending.DIFF`;
- добавить usage/conflict метрики в Skills panel, сортировку и безопасный prune flow;
- сделать Memory Insights по audit log за период;
- завершить конфликтный UX lessons, promote workspace↔global и историю изменений;
- подтвердить sensitive-path exclusion и opt-in `skills.autoCreateFromSessions` в живом distillation flow;
- прогнать сквозной smoke: correction → lesson → следующий system prompt; candidate → approve → discovery;
- решить, остаётся ли keyword+recency v1 конечным вариантом или начинается отдельный embeddings/vector-memory эпик.

### 6. Session Map, Outline, digest и entity views

**Уже есть:** Standard/Map/Outline panes, scene graph, digest overlays/shelves, inspector actions и эксклюзивное переключение представлений.

**Осталось:**

- выполнить P4 enrich RPC + Accept/Discard draft UI;
- выполнить P5 materialize pin → knowledge document с provenance;
- добавить второй `MindMapEngine` adapter как contract proof либо явно отказаться от multi-engine цели;
- проверить pin persistence/restart, переход node → Standard anchor, zen mode и большие сессии;
- провести manual smoke для session/note/knowledge/SiYuan graph и accessibility/keyboard;
- отделить актуальные пункты плана от уже закрытых P1–P3 и обновить status table.

### 7. Session list как command surface

Направление явно отложено после compact chrome, native filter/display menus и slices; предпосылки в основном уже появились.

**Осталось:**

- переоценить deferred spec и принять решение о старте;
- реализовать command/search grammar, keyboard-first invocation и preview результата;
- унифицировать single/bulk actions с существующим selection/bulk RPC вместо второго механизма;
- сохранить native menu semantics, accessibility и undo/error feedback;
- не смешивать этот эпик с Entity View Tabs открытой сессии.

### 8. Нативный iOS/iPadOS клиент

**Уже есть:** `apps/ios` и утверждённый дизайн/детальный план.

**Осталось:**

- провести task-by-task audit фактического кода против 19 задач плана и поставить честные статусы;
- завершить streaming chat, tool visualization, permission approval, new session и attachments;
- завершить offline read-only cache, reconnect/resubscribe и disabled controls без сети;
- закончить auth/server connection/error mapping и совместимость protocol versions;
- выполнить iPad Split View, Stage Manager, multi-window, rotation, external keyboard и focus QA;
- прогнать `xcodegen`/`xcodebuild` на поддерживаемом macOS runner и device/simulator acceptance;
- отдельными будущими эпиками остаются APNs/push и Sources/MCP management UI.

### 9. Discord messaging adapter

**Уже есть:** отдельный worker package и approved design/implementation plan.

**Осталось:**

- завершить/сверить worker protocol, gateway adapter lifecycle и Markdown/attachments/buttons;
- закончить registry wiring: test/save/connect/disconnect/forget и все platform iteration sites;
- довести shared protocol, server-core RPC, Electron transport и packaging worker resource;
- добавить Discord settings/connect UI, icons, unions и session menu;
- добавить все i18n keys во все 10 локалей и документацию;
- live-проверить DM, guild mention gating, pairing/access control, restart/drainPending и rate limits;
- threads остаются отдельной следующей фазой.

### 10. Cloud Runs

**Уже есть:** F1–F6, F8–F14, F16, F19/F20/F22; runner v2, scheduler, previews, event log и personas.

**Осталось:**

- F12–F14: добавить WebSocket/live event transport (сейчас есть route/dialog tail, WS отложен);
- F17: включить CI workflow после установки `CLOUD_RUNS_TOKEN`, `MODAL_GATEWAY_URL`, `CLOUDFLARE_GATEWAY_URL`;
- F18: E2B integration после выдачи credentials;
- F21: собрать production amd64 image с заранее встроенными OMP+Bun; runtime npm install в CF контейнере признан непригодным;
- решить/спланировать переход shared bearer → run-scoped JWT; текущий ADR его сознательно не планирует;
- усилить cancel/kill billing semantics, adaptive 503 backoff и crash-resume usage accounting;
- решить будущие BYOK и completion notifications/webhooks как отдельные эпики;
- повторить live provider matrix и disaster/retry/cancel tests перед релизом.

### 11. Native substrate

**Уже есть:** opt-in sidecar, Rust index/journal primary flags, native cloud provider, exec cwd jail, health/status UI и toolchain detect.

**Осталось:**

- стабилизировать shadow/primary режимы на production-sized workspaces и сравнить baseline/регрессии;
- организовать подписанные/проверяемые GitHub artifacts и нормальную доставку вместо ручного seed локального бинаря;
- добавить macOS/Windows CI и определить фактически поддерживаемые платформы (сейчас detect unix-only, Windows не обещан);
- укрепить `craft-exec`: текущий cwd jail не является полным sandbox и не ограничивает сеть/process capabilities;
- доказать crash loops/fallback/data reconciliation для index, journal, runner и exec на долгих прогонах;
- принять по метрикам решения о RPC rewrite, extension broker, Rust CLI и ICN/hwprobe;
- не считать Zig/Kotlin/Android/полный отказ от Electron начатой реализацией: это явно вне текущей программы.

### 12. Runtime, context docs, bundled skills и Marketplace

**Уже есть:** соответствующие packages/resources и значительная часть M1–M5.

**Осталось:**

- выполнить свежий audit плана M1–M5 и заменить процедурные пункты достоверной status table;
- проверить platform/version/sha locks новых toolchain kinds на mac-arm64, mac-x64, Linux и Windows;
- подтвердить upgrade-without-overwrite для `soul.md`/`rules.md` и одинаковый prompt injection в Pi/OMP;
- проверить bundled skills atomic sync, local-modified handling, disable и license/lock provenance;
- проверить Marketplace remote refresh/ETag/offline fallback, verified install, soft remove и stats cache;
- закончить Runtime settings hot-apply/respawn explanations и redirects;
- выполнить packaged-app smoke и удержать прирост vendored resources в принятом бюджете.

### 13. Rox identity migration

**Уже есть:** безопасные пользовательские переименования и runbook для migration-class изменений.

**Осталось:**

- миграция config directory/env aliases без потери существующих установок;
- deep-link protocol и OAuth relay/callback migration;
- npm scope/package identifiers и telemetry/update compatibility;
- `appId`, `productName`, signing и auto-update bridge — даты и решение пока не назначены;
- artwork/icon/component-name cleanup, если продукт принимает полный visual rebrand;
- Connect `clientId` flip заблокирован доступом к private website repo;
- экранировать OAuth callback `errorDetail` (зафиксированный security follow-up);
- после необратимых flips выполнить upgrade/rollback matrix на существующих Craft installations.

### 14. Viewer и share security

**Уже есть:** owner capability для mutations, immutable legacy shares и скрытие owner key от renderer.

**Осталось:**

- настроить Cloudflare rate-limit rule (инфраструктурная/dashboard работа);
- настроить R2 lifecycle для legacy shares;
- использовать conditional PUT/DELETE для устранения TOCTOU/lost-update;
- исправить V3 UTF-16/byte size measurement;
- добавить/проверить `nosniff` и остальные response hardening headers;
- выполнить live abuse/concurrency/expiry test на production-like CF/R2, а не только unit tests.

### 15. MCP и secrets operational UX

**Уже есть:** настоящий SSE transport, stdio normalization, OMP source proxies, env blocklist и Infisical REST provider.

**Осталось:**

- добавить пользовательский UI управления secret providers/references, если эта возможность должна быть не только config/API;
- дать понятные rotation/expiry/health/audit diagnostics без раскрытия secret values;
- удалить оставшиеся dead credential-cache readers и cleanup paths после проверки backward compatibility;
- периодически повторять redirect/credentialed-URL/log-scrubbing adversary suite;
- проверить SSE reconnect/cancellation и MCP-down recovery на реальных servers;
- документировать/свести к одному месту ограничения local-only provider authority.

### 16. Branch и repository hygiene

**Осталось:**

- remote branch deletion из `plans/branch-disposition.md` не выполнен намеренно; нужен явный human approval;
- решить судьбу уникального donor-теста из `feat/shell-ext-activate2`: портировать или документированно отбросить;
- после решения повторно проверить ancestry/tree equivalence и только затем удалять ветки;
- обновить remediation board: Integration всё ещё помечен `ACTIVE`, хотя последующая история репозитория существенно ушла вперёд.

### 17. Известные test, build и operational defects

**Осталось:**

- исправить 3 renderer/pdfjs `?url` test failures вместо вечной маркировки «pre-existing»;
- убрать cosmetic `/manifest*` 401 после web login;
- починить или удалить root `tsc --noEmit`, у которого root tsconfig не имеет inputs;
- поддерживать runbook для token length ≥16 и single-instance config lock, включая безопасный scripted restart;
- повторить fresh-machine desktop onboarding/UI E2E (предыдущая проверка была server-side/headless);
- создать регулярный release gate с реальными OMP credentials/model availability, MCP, SiYuan, restart/restore и ask-mode Allow/Deny.

## Детальные карточки завершения

Ниже общий перечень преобразован в исполнимые карточки. Критерий считается
выполненным только при наличии ссылки на код/тест/лог или принятого ADR. Сам факт
наличия компонента, feature flag либо unit-теста не равен завершению инициативы.

### Карточка 1 — Unified shell и Workbench

**Ожидаемый результат.** Пользователь получает одну устойчивую оболочку, в
которой сессии, знания, браузер и расширения открываются, восстанавливаются и
управляются одинаково. Если продуктовый verdict остаётся отрицательным, результатом
считается контролируемое удаление experimental-пути без регрессии classic shell.

**Функциональные требования:**

1. Каждый публичный slot имеет хотя бы одну полезную core contribution либо явно
   объявлен extension-only и корректно показывает empty state.
2. `agent`, `outline`, `backlinks` в Inspector показывают реальные данные активной
   surface; недоступность данных выражена typed empty/error state, а не заглушкой.
3. Идентификатор сохранённой вкладки отделён от ephemeral process/view id. После
   рестарта вкладка восстанавливает логическую сущность или показывает понятный
   recoverable error.
4. Падение Extension Host не завершает main process, сессии, browser и другие
   workspaces. Затронутые contributions получают `degraded`, после restart — live.
5. Classic shell при выключенном флаге сохраняет маршруты, hotkeys, layout и
   производительность текущего релиза.

**Критерии приёмки:**

- automated registry test подтверждает уникальность ids, стабильный порядок и
  корректную фильтрацию `when` для всех core contributions;
- integration test сохраняет layout с session/browser/knowledge, перезапускает
  приложение и восстанавливает тот же набор логических вкладок;
- fault-injection test принудительно завершает Extension Host и подтверждает
  доступность чата и последующее восстановление contributions;
- keyboard-only smoke проходит open/switch/close panel, focus return и escape;
- решение `SHIP_DEFAULT`, `KEEP_EXPERIMENTAL` или `REMOVE` записано в ADR с
  владельцем, датой и migration/rollback планом.

**Зависимости и границы:** продуктовый verdict; стабильные surface contracts.
Нельзя включать flag по умолчанию только ради получения пользовательской статистики.

### Карточка 2 — Knowledge и SiYuan

**Ожидаемый результат.** Knowledge — полноценная поверхность чтения и безопасного
изменения знаний, а не набор пустых навигационных пунктов. Внешний SiYuan остаётся
заменяемым provider, Craft владеет workflow metadata, а запись никогда не происходит
без проверяемого proposal/permission/rollback цикла.

**Функциональные требования:**

1. Provider contract возвращает типизированные Inbox, Daily, Databases и Tags либо
   capability сообщает, что раздел не поддерживается; UI не имитирует пустую базу.
2. Read tools одинаково работают в Pi, OMP и session-tools registry и соблюдают
   response-size caps, workspace isolation и provenance.
3. Write operation создаёт proposal с target, diff, preconditions и риском; затем
   проходит permission, snapshot, apply, verify. Ошибка verify запускает rollback.
4. Повтор запроса с тем же idempotency key не дублирует документ/блок.
5. Publication связывает документ с source session/messages и сохраняет immutable
   provenance, доступный из UI.
6. Remote connection требует TLS, не переносит локальные credentials в renderer и
   сообщает typed ошибки auth/version/capability.

**Критерии приёмки:**

- contract tests на provider с поддерживаемой и неподдерживаемой capability;
- mutation tests: allow, deny, stale precondition, partial failure, rollback,
  retry/idempotency и concurrent edit;
- E2E: найти знание → открыть источник → предложить изменение → просмотреть diff →
  разрешить → перезапустить → убедиться в данных и provenance;
- performance gate на согласованном corpus фиксирует p50/p95, размер базы и пороги
  G1 вместо `TBD`;
- legal ADR отдельно подтверждает допустимый shipping mode. Без него managed mode
  не включается и не пакуется.

**Зависимости и границы:** G2 legal/commercial, provider capability contract,
Connection Fabric для remote auth. H3 не является скрытым условием завершения.

### Карточка 3 — White-label Knowledge Engine

**Ожидаемый результат.** Knowledge engine можно включить под другой branding и с
другим provider без форка business logic, утечки секретов либо зависимости UI от
конкретных SiYuan-типов.

**Функциональные требования:**

1. Branding, provider selection и capabilities поступают из конфигурации/registry,
   а не из scattered literals.
2. Provider gate хранит точные origin, commit/version, license/notice, EE boundary,
   trademark и deployment assumptions.
3. Broker выдаёт ограниченный lease по workspace, consumer, action, resource,
   audience и TTL; raw secret не сохраняется в WorkGraph.
4. Import выполняется в stage, показывает masked preview/conflicts и коммитится
   атомарно; recovery умеет quarantine, backup и restore.
5. Feature-off путь не создаёт фоновые процессы, файлы, маршруты или authority.

**Критерии приёмки:**

- test matrix codec/provider/broker/delivery/import/recovery/WorkGraph/transport/UI
  имеет отдельный автоматизированный набор и traceable requirement ids;
- скан transcript/log/config/renderer payload после E2E не находит тестовый secret;
- GitHub E2E выполняет операцию по reference, затем revoke, rotate и repair с
  ожидаемой переавторизацией;
- packaged build содержит обязательные notices и не содержит запрещённые EE assets;
- K-plan содержит для каждого slice `done/partial/blocked/not-started`, evidence и
  владельца следующего действия.

**Зависимости и границы:** стабильный provider contract и legal review. Desktop
PostgreSQL/Redis stack не вводится.

### Карточка 4 — Rox Connection Fabric и secret delivery

**Ожидаемый результат.** Подключения импортируются, хранятся, выдаются и отзываются
через один auditable fabric; потребитель получает минимальную временную capability,
а не долговечный секрет.

**Функциональные требования:**

1. Persisted records имеют versioned codec, fingerprint и миграцию с backup;
   неподдерживаемые/corrupt записи карантинируются без падения всего приложения.
2. Import отделяет discovery/preview от commit, маскирует значения и разрешает
   конфликт `skip/replace/rename` атомарно.
3. Lease проверяет workspace, consumer, action, resource, audience, TTL и revocation
   при каждом sensitive use, а не только при создании.
4. Delivery по header/proxy/helper/FD/temp file очищает артефакты после success,
   error, cancel и process crash. Env delivery доступен только explicit legacy mode.
5. Rotation инвалидирует старую версию и не ломает unrelated connections.

**Критерии приёмки:**

- table-driven deny/allow matrix для broker плюс fake-clock expiry tests;
- crash tests на backup/quarantine/restore и key unavailable;
- temp artifact test проверяет cleanup и permissions на диске;
- E2E импортирует GitHub и Infisical references, выполняет операцию, отзывает lease,
  меняет secret и успешно повторяет только после revalidation;
- remote/headless попытка получить local provider authority завершается typed deny.

**Зависимости и границы:** provider-specific adapters стартуют после заморозки
контракта; UI никогда не получает raw decrypted value.

### Карточка 5 — Самообучение, память и skills lifecycle

**Ожидаемый результат.** Из коррекций возникают проверяемые уроки и кандидаты
skills; пользователь понимает источник и риск, может принять, отклонить, изменить
или откатить результат. Ничто не активируется автоматически по умолчанию.

**Функциональные требования:**

1. Distillation сохраняет provenance до session/message/tool, scope и audit entry.
2. Pending candidate исключён из discovery до Approve. Dismiss создаёт устойчивый
   anti-repeat marker с TTL/нормализацией.
3. Совпадение slug создаёт update candidate, UI показывает line diff, Approve
   сохраняет предыдущую версию и выполняет атомарный upsert.
4. Risk flags покрывают network, privileged command, выход из cwd, secrets и
   destructive filesystem patterns; это advisory, но видимо до Approve.
5. Usage log отличает prompt inclusion, успешное применение и correction/conflict.
6. Insights строятся только из audit/usage facts и позволяют перейти к источнику.

**Критерии приёмки:**

- E2E correction → workspace lesson → новый prompt содержит урок с provenance;
- candidate отсутствует в discovery, затем появляется после Approve и исчезает
  после rollback/version restore;
- update/diff/dismiss/duplicate/concurrent approve покрыты тестами;
- sensitive session не создаёт candidate, пока explicit config выключен;
- UI keyboard/screen-reader smoke покрывает risk, diff, Approve и Dismiss;
- retention/rotation tests удерживают лимиты lessons, audit и usage logs.

**Зависимости и границы:** решение об embeddings оформляется отдельным ADR; оно не
блокирует корректное завершение keyword+recency варианта.

### Карточка 6 — Session Map, Outline, digest и entity views

**Ожидаемый результат.** Standard, Map и Outline — согласованные представления одной
сессии: выбор узла ведёт к исходному сообщению, draft enrichment не портит источник,
а pin переживает рестарт и может быть опубликован в Knowledge.

**Функциональные требования:**

1. Graph type определён в core и не дублируется renderer-типом.
2. Все nodes имеют стабильный source anchor; отсутствующий/deleted anchor даёт
   recoverable state.
3. Enrich создаёт draft отдельно от persisted pin. Accept атомарно сохраняет,
   Discard полностью восстанавливает предыдущую graph state.
4. Materialize создаёт knowledge outline с provenance и идемпотентностью.
5. Limits на turns/nodes/labels предотвращают зависание renderer.

**Критерии приёмки:**

- fixture tests для session, note и knowledge adapters;
- round-trip test graph codec/pin/restart;
- E2E click node → точный Standard anchor; Accept/Discard; export → Knowledge;
- performance smoke на 200 turns и oversized labels без frame starvation;
- manual check подтверждает, что SiYuan Graph остаётся доступен и не подменён Map;
- accessibility проверяет focusable nodes, имя, zoom/pan alternatives и reduced motion.

**Зависимости и границы:** P5 export зависит от Knowledge publication contract;
полная KMind parity и writeback в source не входят в эту карточку.

### Карточка 7 — Session list как command surface

**Ожидаемый результат.** Пользователь выполняет действия над выбранными сессиями из
единой keyboard-first command surface, не изучая отдельные меню и не создавая
расхождений с существующим bulk RPC.

**Функциональные требования:**

1. Grammar разделяет поиск, фильтр и mutating command; потенциально destructive
   команда всегда показывает scope/preview и подтверждение.
2. Команды используют canonical selection и bulk APIs с существующими limits.
3. Partial failure возвращает per-item результат и оставляет повторяемый набор.
4. Native filter/display menus и command surface читают одну persisted model.
5. Undo доступен там, где операция обратима; иначе показывается audit/result summary.

**Критерии приёмки:**

- parser tests на неоднозначные строки, escaping и locale-independent tokens;
- keyboard E2E: открыть, найти, preview, выполнить, отменить, вернуть focus;
- parity tests подтверждают одинаковый результат menu и command путей;
- bulk limit/partial error/stale selection тесты не теряют выбор пользователя;
- до начала реализации deferred spec получает одобрение и явные non-goals.

### Карточка 8 — Нативный iOS/iPadOS клиент

**Ожидаемый результат.** iPhone/iPad клиент поддерживает основной session loop:
подключиться, найти/создать сессию, читать stream, отправлять текст/вложения,
просматривать tools, отвечать на permission и безопасно работать offline.

**Функциональные требования:**

1. Versioned transport корректно обрабатывает reconnect, missed events, duplicate
   events и server protocol mismatch.
2. Token/credentials хранятся в Keychain и не попадают в logs/cache previews.
3. Offline cache атомарен, ограничен по размеру и read-only; send/new/approve явно
   отключены до reconnect.
4. Streaming UI объединяет deltas без дублей, сохраняет scroll/draft при rotation.
5. Attachments имеют type/size validation, progress, cancel и retry.
6. Permission card показывает действие/риск и не отправляет повторный response.

**Критерии приёмки:**

- unit tests transport reducer/cache/error mapping;
- integration test disconnect во время stream и permission, затем resume без дублей;
- force-quit + Airplane Mode сохраняет список/историю и запрещает mutations;
- `xcodegen` и `xcodebuild` зелёные на macOS CI;
- device/simulator matrix: iPhone portrait/landscape, iPad Split View 1/3–2/3,
  Stage Manager resize, multi-window и external keyboard;
- privacy review подтверждает Keychain и отсутствие secrets в diagnostics.

**Зависимости и границы:** доступный server endpoint и protocol compatibility.
APNs и Sources/MCP UI остаются отдельными эпиками.

### Карточка 9 — Discord messaging adapter

**Ожидаемый результат.** Пользователь подключает Discord bot и безопасно ведёт Craft
sessions из DM и разрешённых guild channels; worker crash/restart не теряет контроль
над pending sends и не смешивает workspaces.

**Функциональные требования:**

1. Bot token проходит test до save, хранится через credentials layer и редактируется
   только replacement flow.
2. DM пересылаются согласно binding; guild сообщения — только по mention/разрешённому
   trigger и access-control.
3. Adapter реализует timeout, pending map, drain on exit, reconnect/backoff и
   idempotent message/button handling.
4. Discord limits соблюдаются для длины, embeds/buttons/files и rate-limit retry.
5. Registry, RPC, Electron transport, packaged worker path и UI используют один
   platform discriminator.

**Критерии приёмки:**

- worker protocol/parser tests на malformed/duplicate/out-of-order события;
- gateway lifecycle test завершает worker с pending request и получает typed error;
- package smoke находит worker в dev и packaged builds;
- live sandbox E2E: test/save, DM, guild mention, unauthorized guild ignore, buttons,
  file, reconnect, restart и forget credentials;
- i18n parity/sorted/coverage для всех 10 локалей;
- token и user content отсутствуют в обычных logs.

**Зависимости и границы:** Discord application/intents и sandbox guild. Threads не
включаются незаметно — для них нужен отдельный phase contract.

### Карточка 10 — Cloud Runs

**Ожидаемый результат.** Run запускается, наблюдается, отменяется и продолжается после
сбоя с предсказуемой стоимостью; UI получает живые события, а production runner не
устанавливает сотни мегабайт dependencies во время запроса.

**Функциональные требования:**

1. WS/live transport поддерживает resume cursor, dedup, heartbeat и fallback на
   events route/tail.
2. Checkpoint имеет version/subtask/input fingerprint. Resume выполняет только
   незавершённое и не удваивает usage completed subtasks.
3. Cancel переводит state в terminal один раз, останавливает alarm chain и по
   возможности process/container; поздний marker игнорируется.
4. 503/timeout retry ограничен budget/deadline, использует jitter и adaptive
   concurrency, не создавая retry storm.
5. Production image содержит pinned OMP+Bun с SBOM/version evidence.
6. Auth model документирует scope, expiry, rotation и tenant isolation.

**Критерии приёмки:**

- fault suite: kill runner/container/network, duplicate alarm, stale marker,
  cancel race, gateway 503 и artifact traversal;
- usage assertion после resume равен completed + реально повторённой работе;
- WS disconnect/reconnect восстанавливает события без gap/duplicate в UI;
- CI workflow запускается только с валидными secrets и публикует redacted evidence;
- image cold-start/size и run latency измерены на реальном amd64, не QEMU;
- E2B/CF/provider live matrix имеет дату, версии, run ids и cleanup evidence.

**Зависимости и границы:** credentials для F17/F18, auth product decision. BYOK и
push/webhook не входят без отдельных утверждённых эпиков.

### Карточка 11 — Native substrate

**Ожидаемый результат.** Native sidecar устанавливается и обновляется как проверяемый
opt-in компонент, ускоряет выбранные операции и всегда безопасно откатывается на TS
без потери данных.

**Функциональные требования:**

1. Artifact имеет version, checksum/signature, platform/arch и совместимый protocol
   major; несовместимость не запускает primary path.
2. Supervisor ограничивает restart loop, сообщает health/capabilities и очищает
   child process tree.
3. Index shadow сравнивает детерминированные results; primary caps и fallback явно
   видимы в status.
4. Journal primary гарантирует append ordering, fsync/atomicity contract и recovery
   оборванной последней строки без double-write divergence.
5. Exec canonicalizes workspace root/cwd; ограничения sandbox честно отображены.

**Критерии приёмки:**

- Linux/macOS/Windows artifact CI либо documented unsupported status для каждой
  комбинации, без silent detect failure;
- soak tests на 20k files и длинной session journal фиксируют latency/RSS/diffs;
- kill -9 sidecar во время index/journal/exec/run приводит к bounded fallback;
- upgrade/downgrade/protocol-major mismatch покрыты integration tests;
- packaged app устанавливает toolchain artifact без ручного seed;
- security review явно отличает cwd jail от полного process/network sandbox.

**Зависимости и границы:** публикация artifacts и signing infra. RPC rewrite, ICN,
Android и полный отказ от Electron принимаются только отдельными ADR.

### Карточка 12 — Runtime, context docs, bundled skills и Marketplace

**Ожидаемый результат.** Пользователь видит фактический runtime, управляет opt-in
инструментами/контекстом/skills и устанавливает только проверенные marketplace
артефакты, не теряя локальные изменения при обновлении.

**Функциональные требования:**

1. Tool manifest для каждой platform содержит kind/tier/version/source/hash либо
   честный unsupported status; disabled никогда не устанавливается `ensureAll`.
2. Context seed версионирован; upgrade не перезаписывает пользовательский файл,
   oversized content ограничивается и XML-defang применяется одинаково Pi/OMP.
3. Bundled skill сохраняет origin/commit/license/hash; local modification вызывает
   conflict state, а не overwrite.
4. Marketplace refresh использует ETag/TTL/atomic cache/fallback; install проверяет
   pinned ref/hash и не запускает postinstall scripts.
5. Remove является soft/recoverable для пользовательских данных.
6. Runtime settings помечает hot apply против requires respawn/restart.

**Критерии приёмки:**

- clean-config test ставит только core/default-on, disable исключает tool, opt-in не
  появляется сам;
- context edit переживает upgrade и виден в следующем Pi/OMP prompt;
- marketplace tampered hash/ref/network-offline tests fail closed/fallback;
- bundled skill local edit и disable переживают обновление приложения;
- packaged smoke проходит Runtime/Marketplace/Context navigation и install/remove;
- resource size budget и i18n parity/sorted/coverage зафиксированы в CI.

### Карточка 13 — Rox identity migration

**Ожидаемый результат.** Пользователь и внешние интеграции видят Rox, при этом
существующая установка обновляется без потери config, auth, deep links и update
channel; rollback остаётся возможным в объявленном окне.

**Функциональные требования:**

1. Каждый persistent identifier классифицирован `rename now`, `alias+migrate`,
   `keep compatibility` либо `irreversible cutover`.
2. Config migration использует copy/verify/marker, не удаляет old dir до успешного
   старта и обнаруживает конфликт двух директорий.
3. Env aliases имеют precedence/deprecation policy без печати secret values.
4. Deep link/OAuth принимают legacy callback в migration window и направляют в один
   validated handler; `errorDetail` экранируется.
5. appId/productName/signing/update change согласованы с bridge release и rollback.
6. Client id меняется синхронно с website configuration, а не односторонне.

**Критерии приёмки:**

- upgrade matrix: clean install, existing config, conflicting dirs, rollback,
  legacy/new env, legacy/new deep link;
- OAuth tests на XSS/open redirect/state mismatch и redacted errors;
- signed bridge build обновляется со старой версии и сохраняет sessions/credentials;
- static scan пользовательских Craft strings имеет reviewed allowlist;
- website + desktop staged cutover имеет owner, окно и rollback command;
- support/runbook описывает восстановление неудачной миграции.

**Зависимости и границы:** private website access, signing/update infra и human date.
До этого compatibility identifiers не переименовываются ради косметической чистоты.

### Карточка 14 — Viewer и share security

**Ожидаемый результат.** Share можно читать/изменять только в пределах выданной
capability, concurrent mutations не теряют данные, abuse ограничен на edge/storage,
а legacy shares завершают жизненный цикл предсказуемо.

**Функциональные требования:**

1. Owner capability проверяется server-side для каждой mutation и никогда не
   отправляется renderer/analytics/logs.
2. PUT/DELETE используют precondition/version/ETag; conflict возвращает 409/412,
   не silently overwrites.
3. Limits считаются в UTF-8 bytes после canonical serialization.
4. Ответы имеют подходящие content type, `nosniff`, cache/CORS policy.
5. Edge rate limit различает read/mutation и не превращается в workspace oracle.
6. R2 lifecycle удаляет legacy/expired data по утверждённому retention policy.

**Критерии приёмки:**

- auth matrix: no key/wrong key/owner/legacy/expired/replayed;
- concurrency test двух writers получает один success и один conflict;
- Unicode boundary tests на surrogate pairs/emoji/combining sequences;
- deployed CF test подтверждает rate limit, headers и отсутствие key в logs;
- lifecycle dry run даёт count/bytes, затем deletion evidence и recovery window;
- threat model обновлён после инфраструктурных изменений.

**Зависимости и границы:** CF dashboard и R2 policy access.

### Карточка 15 — MCP и secrets operational UX

**Ожидаемый результат.** Администратор подключает и диагностирует MCP/secrets без
ручного редактирования небезопасных файлов; reconnect/rotation не требуют рестарта
всего приложения, а диагностика не раскрывает credentials.

**Функциональные требования:**

1. UI работает с references/metadata, показывает provider health/version/expiry и
   никогда не имеет RPC чтения raw secret.
2. Rotation атомарно переключает generation; in-flight use завершается по явной
   policy, новый use не получает старую generation.
3. SSE reconnect имеет backoff/cancel/resume semantics и bounded resource use.
4. URL validation запрещает credentialed URL и cross-origin credential redirects.
5. Log/error scrubber применяется к spawn, discovery, connect, tool call и teardown.
6. Legacy credential-cache readers удаляются после migration characterization.

**Критерии приёмки:**

- UI/RPC contract test доказывает отсутствие secret-returning route;
- fake provider rotation race test проверяет generation switching;
- real SSE server test: disconnect, redirect, cancel, malformed event, reconnect;
- adversary scan использует canary secrets во всех error paths и не находит их;
- startup с legacy cache либо безопасно мигрирует, либо выдаёт actionable warning;
- MCP down/up восстанавливает pool/tools в idle point без пересоздания workspace.

### Карточка 16 — Branch и repository hygiene

**Ожидаемый результат.** Remote branches классифицированы доказуемо, уникальная
полезная работа сохранена, а удаление выполняется только после явного одобрения и
оставляет воспроизводимый audit trail.

**Функциональные требования:**

1. Для каждой branch перед удалением повторно вычисляются ancestry, patch-id и tree
   diff относительно актуального main.
2. Unique commits имеют решение `port`, `archive` или `discard` с обоснованием.
3. Donor test из `feat/shell-ext-activate2` сначала запускается на актуальном main;
   полезная регрессия переносится отдельным reviewed commit.
4. Delete list и actual deletion output сохраняются как evidence без credentials.
5. Remediation board отражает фактический закрытый/активный статус.

**Критерии приёмки:**

- human approval ссылается на точный immutable список refs/SHAs;
- dry-run повторён непосредственно перед deletion и не показывает новый unique work;
- protected/current/open-PR branches исключены;
- после cleanup fetch --prune и повторный inventory дают ожидаемый остаток;
- документация не называет integration `ACTIVE`, если она реально закрыта.

### Карточка 17 — Test, build и operational defects

**Ожидаемый результат.** Основные quality gates зелёные без категории «вечный
pre-existing fail», а fresh-machine release проверяется воспроизводимо на desktop и
headless с положительными и отрицательными runtime сценариями.

**Функциональные требования:**

1. Pdfjs assets корректно резолвятся в test runner без production-only mock, либо
   тестовая граница документированно заменяется contract test.
2. Auth/public manifest routing не создаёт лишние 401 в обычном login flow.
3. Root typecheck запускает workspace checks или удалён в пользу единственной
   документированной команды; «no inputs» не считается успешной проверкой.
4. Restart script проверяет token entropy, останавливает старый instance и ждёт
   освобождения lock с bounded timeout.
5. Release gate создаёт pristine config/home, проходит onboarding, runtime turn,
   host/MCP/knowledge tools, permissions, restart/restore и web access.
6. Negative cases всегда заканчиваются typed terminal event и idle session.

**Критерии приёмки:**

- renderer suite: 0 unexpected failures, включая три pdfjs cases;
- browser network smoke: 0 неожиданных 401/404 для manifest/static resources;
- одна root-команда typecheck возвращает non-zero при намеренно внесённой ошибке;
- scripted double-start/restart tests подтверждают lock cleanup и actionable error;
- release evidence содержит commit, OS/arch, versions, commands, redacted logs и ids;
- matrix покрывает no/invalid credentials, OMP missing/crash/malformed, MCP/SiYuan
  down, auth invalid, permission allow/deny и persisted restart.

## Общие требования ко всем инициативам

Эти требования применяются к каждой карточке, если профильный ADR явно не задаёт
более строгий вариант.

### Архитектура и совместимость

- Один канонический domain contract; renderer не создаёт параллельную модель данных.
- Persisted schema и публичный protocol версионируются, имеют migration и downgrade/
  rollback поведение.
- Feature flag OFF не меняет существующий путь и не создаёт скрытых side effects.
- Partial capability выражается типизированно, а не пустым массивом, вечным spinner
  или generic `Error`.

### Безопасность и приватность

- Least privilege, workspace isolation, deny-by-default для неизвестной capability.
- Secrets отсутствуют в renderer payloads, transcript, telemetry, diagnostics и Git.
- Любой redirect, path, URL, archive и импорт проходит canonicalization/validation.
- Destructive или долговечная mutation имеет preview/permission/audit/rollback там,
  где rollback технически возможен.

### Надёжность

- Async operation имеет timeout/cancel и единственное terminal состояние.
- Retry bounded, idempotent и использует backoff; crash/restart не дублирует side
  effects.
- Ошибка dependency деградирует локальную capability, а не весь workspace/app.
- Cleanup выполняется после success, error, cancel и crash recovery.

### UX и локализация

- Все user-facing строки идут через `t()` и существуют во всех 10 локалях;
  parity, ASCII sorting и coverage обязательны.
- Loading, empty, unsupported, permission denied, offline и retryable error — разные
  состояния с понятным следующим действием.
- Основной поток доступен с клавиатуры, имеет корректные accessible names/focus и
  не полагается только на цвет/hover.

### Доказательства завершения

- Unit tests проверяют чистую логику; integration — реальные границы процесса/RPC/
  filesystem; E2E — пользовательский критический путь.
- Негативные сценарии обязательны наравне с happy path.
- Для platform/infrastructure утверждений нужен live или packaged evidence; mock не
  доказывает доступность внешнего сервиса либо корректность bundle.
- Status документа обновляется в том же PR: result, commit, команды, ограничения и
  явно оставшийся follow-up.

## Открытые решения и внешние блокеры

| Решение/доступ | Текущее обязательное поведение | Что разблокирует |
|---|---|---|
| Legal/commercial по managed SiYuan | остаёмся `external-local` | managed distribution/spawn и G2 |
| Доступ к private website repo | не менять Connect `clientId` | website/client cutover |
| Cloud Runs credentials/secrets | не заявлять соответствующий live gate | F17 CI и F18 E2B |
| Cloud Runs auth decision | shared bearer | run-scoped JWT roadmap |
| appId/update bridge date | Craft-compatible identifiers | необратимый identity cutover |
| Remote branch deletion approval | ничего не удалять | hygiene cleanup |
| Unified shell product verdict | flag default OFF | выпуск или демонтаж experimental shell |
| H3 scheduling decision | intent only | in-process knowledge kernel |

## Рекомендуемый порядок добивания

1. **Security/operations:** Viewer fast-follows, OAuth escaping, credential-cache cleanup, release gate.
2. **Закрытие начатого UX:** Knowledge empty sections/write proposals, memory pending UI, Inspector contributions.
3. **Актуализация планов:** status tables для iOS, Discord, Marketplace, Map и White-label, чтобы checkbox'ы снова отражали реальность.
4. **Внешние решения:** legal SiYuan, website access, appId/update, Cloud Runs auth/credentials.
5. **Productionization:** native artifacts/cross-platform, Cloud Runs image/WS, iOS device QA, Discord live E2E.
6. **Экспериментальные ветви:** финальный verdict по Unified shell и H3; затем удалить или официально запланировать остатки.

## Исполнимый реестр работ

Этот раздел задаёт минимальные независимые результаты, которые можно переносить в
issues/PR. Он не назначает конкретных людей без их согласия. `P0` означает риск
безопасности, потери данных или невозможность доверять release gate; `P1` — разрыв
основного начатого пользовательского потока; `P2` — productionization; `P3` —
эксперимент или решение о будущем направлении.

### Инициатива I01 — Unified shell / Workbench

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I01-01 | P1 | Реальные `agent`, `outline`, `backlinks` Inspector sections | stable surface context | component + integration tests |
| I01-02 | P1 | Core contributions или честные empty states для пяти пустых slots | registry contract | registry snapshot + keyboard smoke |
| I01-03 | P1 | Stable persisted tab identity и migration старых snapshots | surface resolvers | restart/restore E2E |
| I01-04 | P0 | Extension Host crash isolation, degraded/restart lifecycle | host supervisor | fault-injection E2E |
| I01-05 | P3 | ADR `SHIP_DEFAULT`, `KEEP_EXPERIMENTAL` или `REMOVE` | I01-01..04 evidence | signed product decision |

**Первый следующий PR:** I01-04, потому что process isolation — prerequisite для
безопасного расширения числа contributions и не зависит от продуктового verdict.

### Инициатива I02 — Knowledge / SiYuan

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I02-01 | P1 | Capability contract для Inbox/Daily/Databases/Tags | provider schema | provider/UI contract tests |
| I02-02 | P1 | `KnowledgeAgentPanel` смонтирован либо удалён как dead surface | shell route decision | renderer test + manual smoke |
| I02-03 | P0 | Write proposal pipeline до snapshot/apply/verify/rollback | permission + provider mutation API | adversarial mutation suite |
| I02-04 | P1 | Publication с immutable provenance и idempotency | I02-03 | restart/retry E2E |
| I02-05 | P2 | Remote TLS settings и typed diagnostics | Connection Fabric | real remote-provider E2E |
| I02-06 | P2 | G1 thresholds и performance baseline | representative corpora | versioned benchmark artifact |
| I02-07 | P3 | Managed-mode legal/product ADR | legal/commercial review | accepted decision record |

**Первый следующий PR:** I02-01 — он устраняет ложные пустые состояния без включения
опасной записи и создаёт контракт для последующих UI-срезов.

### Инициатива I03 — White-label Knowledge Engine

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I03-01 | P1 | K-plan status matrix с owner/evidence на каждый slice | repository audit | reviewed plan update |
| I03-02 | P0 | Provider/license gate как fail-closed validation | legal metadata | invalid-provider tests |
| I03-03 | P0 | Broker matrix и zero-secret renderer/WorkGraph contract | Connection Fabric | canary-secret suite |
| I03-04 | P1 | Atomic masked import + quarantine/restore | provider codec | crash/recovery tests |
| I03-05 | P2 | GitHub revoke/rotate/repair E2E | provider credentials | redacted live evidence |

**Первый следующий PR:** I03-01; до аудита нельзя честно оценить объём, а сам audit
не меняет shipping behavior.

### Инициатива I04 — Connection Fabric

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I04-01 | P0 | Corrupt/partial migration quarantine и restore | versioned codec | injected-crash matrix |
| I04-02 | P0 | Lease revalidation по generation/TTL/audience | broker clock/generation | table-driven tests |
| I04-03 | P0 | Delivery cleanup после success/error/cancel/crash | delivery adapters | filesystem/process tests |
| I04-04 | P1 | Atomic import conflicts `skip/replace/rename` | I04-01 | import rollback tests |
| I04-05 | P1 | Provider revoke/rotate/repair flow | I04-02..04 | live integration trace |

**Первый следующий PR:** I04-01, затем I04-02; durability и authority должны быть
доказаны раньше нового provider UX.

### Инициатива I05 — Self-learning memory

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I05-01 | P1 | Pending list/detail/risk/Approve/Dismiss UI | existing pending RPC | renderer + a11y tests |
| I05-02 | P1 | Update candidate, DIFF и version restore | queue versioning | diff/rollback tests |
| I05-03 | P2 | Usage/conflict counters и Skills sorting | provenance logs | aggregation tests |
| I05-04 | P2 | Memory Insights с source navigation | audit log | time-window tests |
| I05-05 | P1 | Correction→lesson/candidate→prompt/discovery E2E | I05-01..02 | packaged smoke evidence |

**Первый следующий PR:** I05-01, но Approve остаётся выключен, пока atomic update и
rollback текущего create flow не подтверждены тестами.

### Инициатива I06 — Session Map / Outline

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I06-01 | P1 | Stable anchors и missing-anchor recovery | message identity | adapter/navigation tests |
| I06-02 | P1 | Enrich draft Accept/Discard | graph draft codec | state round-trip tests |
| I06-03 | P2 | Pin persistence и restart migration | persisted graph schema | restart E2E |
| I06-04 | P2 | Pin→Knowledge materialization с provenance | I02-04 | idempotency E2E |
| I06-05 | P2 | 200-turn performance и accessibility gate | I06-01..03 | profile + manual report |

**Первый следующий PR:** I06-01 — navigation correctness важнее нового enrich UX.

### Инициатива I07 — Session command surface

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I07-01 | P3 | Обновлённый approved spec/non-goals | product review | decision record |
| I07-02 | P2 | Pure command grammar/parser без mutations | I07-01 | exhaustive parser tests |
| I07-03 | P2 | Preview + canonical single/bulk execution | I07-02 | parity/stale-selection tests |
| I07-04 | P2 | Keyboard/focus/undo/error UX | I07-03 | accessibility E2E |

**Первый следующий PR:** только I07-01. Deferred implementation нельзя начинать по
старой спецификации без повторного одобрения после появления native menus.

### Инициатива I08 — iOS/iPadOS

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I08-01 | P1 | Audit 19 tasks против фактического Swift-кода | macOS build access | status matrix |
| I08-02 | P1 | Transport reconnect/dedup/version mismatch | server protocol | reducer/integration tests |
| I08-03 | P0 | Keychain и privacy/logging hardening | auth flow | security test/report |
| I08-04 | P1 | Offline cache + disabled mutation controls | I08-02 | force-quit/Airplane E2E |
| I08-05 | P1 | Attachments и permission cards | stable transport | cancel/retry/race tests |
| I08-06 | P2 | iPad multitasking/device acceptance | macOS CI + simulators | signed QA matrix |

**Первый следующий PR:** I08-01; текущие unchecked plan steps недостаточны для
вывода о реальном состоянии приложения.

### Инициатива I09 — Discord

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I09-01 | P1 | Worker/gateway lifecycle audit и закрытие gaps | worker package | protocol/lifecycle tests |
| I09-02 | P0 | Token storage + guild access-control contract | credentials layer | unauthorized/canary tests |
| I09-03 | P1 | Registry/RPC/Electron/package wiring | I09-01 | packaged worker smoke |
| I09-04 | P1 | Settings/connect/session UI + 10 locales | I09-03 | i18n + renderer tests |
| I09-05 | P2 | Discord sandbox live matrix | bot/guild credentials | redacted E2E evidence |

**Первый следующий PR:** совместный audit I09-01/I09-02 без UI; подключение token к
непроверенному guild routing недопустимо.

### Инициатива I10 — Cloud Runs

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I10-01 | P0 | Cancel/late-marker/usage accounting race suite | current runner | deterministic fault tests |
| I10-02 | P1 | WS cursor/dedup/heartbeat + HTTP fallback | events protocol | disconnect/reconnect E2E |
| I10-03 | P1 | Pinned amd64 OMP+Bun image + SBOM | image build host | cold-start/size artifact |
| I10-04 | P1 | F17 CI activation | repository secrets | CI run URL/evidence |
| I10-05 | P2 | F18 E2B provider validation | E2B credentials | provider live matrix |
| I10-06 | P3 | Auth evolution ADR | product/security | accepted scope/rotation plan |

**Первый следующий PR:** I10-01 — он не требует внешних credentials и закрывает
риск денег/дублированной работы до добавления нового транспорта.

### Инициатива I11 — Native substrate

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I11-01 | P1 | Artifact publication/checksum/protocol manifest | release infra | clean install smoke |
| I11-02 | P1 | Sidecar kill/upgrade/mismatch fallback suite | I11-01 | integration matrix |
| I11-03 | P2 | Index/journal production-size soak | benchmark corpus | latency/RSS/diff logs |
| I11-04 | P2 | Platform support matrix в CI/docs | platform runners | per-platform results |
| I11-05 | P0 | Exec threat model и честные sandbox boundaries | current exec | security review/tests |
| I11-06 | P3 | ADR по RPC/extension broker/CLI/ICN | I11-03 metrics | accepted/rejected records |

**Первый следующий PR:** I11-01; ручной seed не является production delivery.

### Инициатива I12 — Runtime / Context / Marketplace

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I12-01 | P1 | M1–M5 status/evidence audit | repository scan | updated plan matrix |
| I12-02 | P0 | Marketplace hash/ref tamper fail-closed | installer contract | supply-chain tests |
| I12-03 | P1 | Context/bundled-skill no-overwrite upgrades | version merge | upgrade conflict tests |
| I12-04 | P2 | Cross-platform tool locks/support statuses | release assets | resolver matrix |
| I12-05 | P1 | Packaged Runtime/Marketplace smoke | I12-02..04 | app QA evidence |

**Первый следующий PR:** I12-01 и точечный I12-02 review; catalog install — наиболее
чувствительная граница программы.

### Инициатива I13 — Identity migration

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I13-01 | P0 | OAuth `errorDetail` escaping + redirect/state tests | callback handler | adversarial auth tests |
| I13-02 | P1 | Config/env/deep-link compatibility migrations | identifier inventory | upgrade/rollback tests |
| I13-03 | P3 | appId/update bridge decision and runbook | signing/product date | accepted ADR |
| I13-04 | P3 | Website/clientId coordinated cutover | private repo access | staged E2E |
| I13-05 | P2 | Visual/artwork and residual string cleanup | brand approval | reviewed allowlist |

**Первый следующий PR:** I13-01 — независимый security follow-up. Необратимые
identifier changes остаются заблокированы решениями I13-03/I13-04.

### Инициатива I14 — Viewer / Share

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I14-01 | P0 | Conditional writes/deletes и conflict response | R2 version/ETag | concurrent writer tests |
| I14-02 | P0 | UTF-8 byte limits + `nosniff`/cache/CORS headers | response layer | Unicode/header tests |
| I14-03 | P0 | CF mutation/read rate limits | dashboard access | deployed abuse test |
| I14-04 | P1 | Legacy/expired R2 lifecycle policy | product retention | dry-run + deletion evidence |
| I14-05 | P1 | Обновлённый threat model/live matrix | I14-01..04 | review record |

**Первый следующий PR:** I14-01 и I14-02; это code-level fixes без ожидания dashboard.

### Инициатива I15 — MCP / Secrets UX

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I15-01 | P1 | Metadata/reference-only provider UI contract | secrets RPC | no-secret payload tests |
| I15-02 | P0 | Rotation generation race semantics | provider lifecycle | fake-clock/concurrency tests |
| I15-03 | P1 | Real SSE reconnect/cancel/redirect suite | test SSE server | integration tests |
| I15-04 | P1 | Legacy credential-cache readers removal/migration | characterization | startup migration tests |
| I15-05 | P0 | Canary redaction across all lifecycle errors | I15-02..04 | adversary scan |

**Первый следующий PR:** I15-02/I15-05; UI следует после доказанного lifecycle.

### Инициатива I16 — Branch hygiene

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I16-01 | P2 | Повторный immutable branch inventory | remote visibility | refs/SHAs report |
| I16-02 | P1 | Donor test port/discard decision | test execution | commit или rationale |
| I16-03 | P3 | Human-approved remote deletion | I16-01..02 | approval + command log |
| I16-04 | P2 | Remediation/status docs приведены к HEAD | repository history | reviewed docs diff |

**Первый следующий PR:** I16-02/I16-04. Удаление refs не производится без I16-03.

### Инициатива I17 — Quality / release gate

| ID | Приоритет | Результат одного среза | Зависит от | Доказательство |
|---|---|---|---|---|
| I17-01 | P1 | Исправлены три pdfjs test failures | test asset resolver | renderer suite green |
| I17-02 | P2 | Manifest auth/routing без cosmetic 401 | web auth routing | browser network smoke |
| I17-03 | P1 | Канонический root typecheck, чувствительный к ошибке | workspace scripts | mutation proof |
| I17-04 | P1 | Safe single-instance restart runbook/script | lock/token contracts | double-start tests |
| I17-05 | P0 | Pristine desktop/headless positive/negative release gate | credentials + packaged app | versioned evidence bundle |

**Первый следующий PR:** I17-01/I17-03; параллельно подготовить окружение для
I17-05, не подменяя desktop E2E headless-проверкой.

## Волны исполнения и условия перехода

### Волна A — инвентаризация и быстрые P0

Вход: текущий `main`, воспроизводимая установка dependencies.
Работы: I03-01, I08-01, I12-01, I13-01, I14-01, I14-02, I15-05,
I17-01, I17-03.
Выход: планы отражают HEAD; известные code-level security/test defects закрыты;
новых внешних credentials не требуется.

### Волна B — authority, durability и recovery

Вход: Wave A зелёная, contracts заморожены.
Работы: I02-03, I03-02..04, I04-01..04, I10-01, I14-03..04, I15-02..04.
Выход: mutation/secret/import/cancel paths имеют crash, race, expiry и rollback
evidence. Ни один последующий UI-срез не обходит эти contracts.

### Волна C — завершение пользовательских потоков

Вход: Wave B; UI может полагаться на typed contracts.
Работы: I01-01..04, I02-01..04, I05-01..05, I06-01..03, I09-03..04,
I12-03..05.
Выход: начатые desktop flows не заканчиваются заглушкой/пустой секцией; проходят
keyboard, i18n и restart smoke.

### Волна D — productionization и live validation

Вход: доступ к platform runners, provider credentials и release infrastructure.
Работы: I02-05..06, I03-05, I08-02..06, I09-05, I10-02..05,
I11-01..05, I17-04..05.
Выход: packaged/live evidence на заявленных платформах; runbooks и rollback проверены.

### Волна E — продуктовые решения

Вход: метрики и evidence предыдущих волн.
Работы: I01-05, I02-07, I07-01, I10-06, I11-06, I13-03..04, I16-03.
Выход: каждый пункт имеет accepted/rejected/deferred-until ADR, владельца и дату
следующего review. Отсутствие решения не маскируется реализацией за feature flag.

## Шаблон issue/PR для задач из реестра

Каждая задача `Ixx-yy` при переносе в tracker должна содержать:

1. **Problem/evidence:** ссылка на точное текущее поведение, лог, тест или строку
   профильного документа.
2. **Scope:** один наблюдаемый результат и список затрагиваемых contracts.
3. **Non-goals:** что сознательно не исправляется этим срезом.
4. **Security/data review:** secrets, auth, workspace boundary, persisted migration,
   destructive effects и rollback.
5. **Acceptance:** команды automated checks и конкретный manual/live сценарий.
6. **Compatibility:** feature-off, existing persisted state, remote/headless и
   supported platforms.
7. **Evidence on close:** commit/PR, test output, screenshots для заметного UI,
   redacted live ids/logs и оставшиеся ограничения.

Задача не получает статус `done`, если выполнен только happy path, документация
обещает неподтверждённую platform/provider поддержку либо follow-up не имеет нового
ID и владельца решения.

## Источники истины для следующей ревизии

- `plans/remediation-board.md`
- `plans/next-program/decisions/README.md`
- `docs/unified-shell-verdict.md`
- `docs/repo-known-issues.md`
- `docs/specs/2026-08-07-siyuan-integration/11-roadmap.md`
- `docs/specs/2026-08-11-rox-connection-fabric/10-pr-dag-and-acceptance.md`
- `docs/specs/2026-08-12-native-substrate/04-roadmap.md`
- `docs/cloud-runs-features-spec.md`
- `docs/runtime-context-marketplace-plan.md`
- `docs/superpowers/plans/` и `docs/superpowers/specs/`

Этот файл следует обновлять при закрытии инициативы: удалять закрытый остаток, переносить подтверждённый результат в профильный status/ADR и оставлять здесь только реально незавершённую часть.
