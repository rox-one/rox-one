# SPEC — реализация ROX Product Learning

> Актуализация main: см. [дополнение по PR #1394](08-LATEST-MAIN-DELTA.md). Подробные исходные ссылки остаются закреплены за SHA аудита.

**База:** `192558583b3f7acc84e0636a4e5fc7ba8d9a7435`.  
**Назначение:** контракт для coding agents, а не описание уже внедрённого механизма. Все пути под `features/product-tour/`, новые types, signals, settings/learning и test scripts ниже **предлагаются к созданию**. Существующие точки интеграции перечислены в [аудите](03-CODEBASE-AUDIT.md).

## Контракт автономного исполнения

Реализация выполняется **end-to-end без дополнительных согласований с пользователем**. После запуска coding agent не останавливается для подтверждения архитектуры, отдельных патчей, тестового плана, создания веток, push, pull request или merge. Некритичную неоднозначность он разрешает самостоятельно в пользу наиболее совместимого, обратимого и проверяемого варианта и фиксирует решение в итоговом отчёте.

После короткого автоматического bootstrap (`OB-00` + `OB-01`) все независимые работы запускаются **одним параллельным fan-out A1–A11 от одного `CONTRACT_SHA`**. A0 остаётся активным integration lane: принимает готовые worker commits по мере их появления, разрешает конфликты общих файлов, прогоняет affected checks и не ждёт завершения остальных workers, чтобы начать интеграцию уже готовых результатов. Исправления после интеграционных проверок возвращаются владельцу сразу и выполняются в той же волне, без новой стадии согласования.

Финал обязателен: A0 собирает полный candidate, выполняет release-blocking проверки, исправляет внесённые регрессии, синхронизируется с актуальным `origin/main`, повторяет затронутые проверки, затем **самостоятельно публикует изменения и доводит их до merge в `main`**. Если политика репозитория требует PR, A0 создаёт PR, отслеживает CI, исправляет ошибки и мержит его без запроса подтверждения пользователя. Если разрешён и принят репозиторием прямой merge/push в `main`, допустим этот путь. Запрещено обходить branch protection, security controls или подделывать статусы проверок; если существует внешний технически непреодолимый gate (например, обязательный review другим аккаунтом), агент завершает всё остальное, оставляет merge-ready PR и указывает точный внешний blocker вместо запроса на дополнительное решение.

Это разрешение относится к **разработке и доставке кода**. Оно не меняет продуктовый инвариант walkthrough: сам Product Tour не должен автоматически отправлять пользовательские запросы, выдавать permissions, включать микрофон, импортировать credentials, запускать automation или публиковать пользовательские Pages от лица конечного пользователя.

## 1. Выбранный подход

Небольшой собственный runtime обучения поверх уже установленных React, Jotai и Radix Popover. Pure reducer отвечает за состояния; typed ports — за навигацию, наблюдения, targets и сохранение. Radix отвечает за размещение и поведение popover; отдельная декоративная маска — за spotlight.

Причина выбора: сложность Rox находится не в рисовании затемнения, а в нескольких панелях, существующих диалогах, готовности источников и подтверждении настоящих операций. Внешний tour runner не устраняет необходимость этих адаптеров. Новый SaaS SDK, библиотека state machine, LLM-генерация сценариев и удалённая доставка исполняемого кода не нужны.

Нативные инструкции по Radix допускают non-modal popover и настройку реакции на focus/outside interactions: [Radix Popover](https://www.radix-ui.com/primitives/docs/components/popover). В репозитории установлен пакет `@radix-ui/react-popover`; не заменять его на umbrella-пакет из примеров документации без необходимости.

## 2. Состав подсистемы

| Новый путь, относительно renderer | Ответственность | Владелец |
|---|---|---|
| `features/product-tour/contracts/` | Типы, public ports, идентификаторы, схема каталога | A0 |
| `features/product-tour/core/` | Reducer, eligibility, evidence rules, version reconciliation | A1 |
| `features/product-tour/ui/` | Registry целей, геометрия, popover, spotlight, focus и handoff | A2 |
| `features/product-tour/persistence/` | IndexedDB, атомарное обновление прогресса, аренда активного окна, fallback | A3 |
| `features/product-tour/analytics/` | Белый список событий, локальная диагностика, агрегаты | A3 |
| `features/product-tour/adapters/chat/` | Сессии, отправка, ответы, разрешения, исполнение | A4 |
| `features/product-tour/adapters/work/` | Подкаталоги tasks-projects, inbox-feed, meetings-automations | A5 / A10 / A11 |
| `features/product-tour/adapters/knowledge/` | Notes, Memory, Pages, Search | A6 |
| `features/product-tour/adapters/connections/` | Sources, Skills, model settings, Connection Fabric | A7 |
| `features/product-tour/catalogue/` | Проверенный декларативный каталог и его импорт | A8 |
| `features/product-tour/runtime/` | Единственный provider/host, ports composition, launch policy | A0 |
| `pages/settings/LearningSettingsPage.tsx` | Центр обучения | A0 |
| `tests/e2e/product-tour/` | Проверка приложения и native-ветвей | A9 |

Направление зависимостей: contracts не импортирует продуктовые компоненты; core зависит только от contracts; adapters читают существующие доменные API/состояния и преобразуют их в TourSignal; runtime соединяет core, adapters, ui и persistence. Продуктовые компоненты используют узкие optional hooks из runtime. UI не импортирует SessionManager или credentials. Engine не вызывает `electronAPI` напрямую.

Не добавлять product-tour условия внутрь `processEvent`, OMP или серверной авторизации. Не создавать копии действующих route, settings, actions, source readiness и permission registries.

## 3. Контракты

Предлагаемые TypeScript-интерфейсы находятся в [contracts/product-tour-contracts.ts](contracts/product-tour-contracts.ts). Они не являются реализацией и не заменяют существующие типы Rox.

Ключевые сущности:

- **TourDefinition** — цель, trigger, requirements, ordered steps и версия сценария.
- **TourStep** — одна цель интерфейса, routeKey, текст, completion policy и handoff.
- **TourBinding** — runtime-привязка к workspace, panel и при необходимости session/entity. Это не полномочия доступа.
- **TourSignal** — обезличенное по содержимому наблюдение из адаптера; scope и operation correlation существуют в памяти.
- **TourProgress** — подтверждённые стадии освоения, пропуски и версия отдельных шагов.
- **TourAttempt** — конкретный запуск/повтор с own runToken, текущим шагом и причинами паузы.
- **TourCapability** — готовность действия: ready, pending, unavailable или denied с безопасным reason code.
- **TourTargetRegistration** — текущий DOM ref, семантический target id и область принадлежности.

Идентификаторы из JSON — новый внутренний namespace `OBT-*`, не выдуманные записи действующего RX registry. При регистрации инженерных документов A0 сначала читает фактический `registry/RX-LEGEND.md` и резервирует свободные коды.

### Каталог и исполнение

`tour-catalog.json` — декларативные данные. `entryTriggers` — машинные enum-значения для предложения, не автоматического старта; поле trigger содержит пояснение для автора. Названия/цели/обоснования центра обучения выводятся через titleKey/goalKey/whyKey, а не из русскоязычных метаданных напрямую. В нём запрещены JS-функции, shell-команды, произвольные HTTP endpoints и исполнение строк через eval. `routeKey` разрешается типизированным allowlist resolver в существующий `ViewRoute`. Динамический sessionId/pageSlug/sourceSlug берётся из уже разрешённого текущего состояния, не из недоверенного JSON или текста модели.

Каждая строка RU/EN хранится через `t()` после импорта в `packages/shared/src/i18n/locales/*.json`. JSON copy keys нельзя напрямую показывать пользователю при ошибке перевода. Другие обнаруженные локали получают соответствующие переводы; проверяются ключи, placeholders, сортировка и RTL, где он применим.

## 4. Состояния и переходы

Runtime-фазы: `idle`, `preparing`, `locating`, `presenting`, `waiting-action`, `handed-off`, `paused`, `blocked`, `finished`.

| Событие | Условие | Переход/эффект |
|---|---|---|
| Start | Пользователь согласился; shell ready; capability доступна; lease получен | preparing; создать runToken и binding |
| Route ready | Текущий navigationRevision и binding ещё актуальны | locating |
| Target ready | Ровно один допустимый видимый target | presenting; записать shown, показать маску |
| Ack | Policy=ack либо evidence уже получено и policy требует отдельного acknowledgement | Записать acknowledged и подготовить следующий шаг |
| UI observation | Совпали имя сигнала, scope, correlation и требуемый уровень | Записать observed, завершить только policy соответствующего уровня |
| Domain success | Совпали те же условия; подтверждение надёжно | Записать verified; отдельная продуктовая метрика |
| Native dialog opened | Это ожидаемое действие текущего шага | handed-off; скрыть маску/popover, оставить подписку на ограниченную correlation |
| Unexpected modal/navigation | Пользователь занялся другим или появился приоритетный слой | paused; не возвращать его насильно |
| Pending capability / target timeout | Нет безопасной цели | blocked; retry/pause/skip, никаких фиктивных completion |
| Esc / Close | Дочерний слой не потребил Esc | paused; cleanup; сохранить попытку |
| Skip step | Явное действие пользователя | Пометить skipped, перейти дальше; не увеличивать verified |
| Dismiss tour | Явное действие пользователя | Завершить попытку как dismissed и отключить её приглашение |
| Все обязательные policies удовлетворены | Нет обязательных пропусков | finished/completed-learning |
| Маршрут закончен с обязательными пропусками | Есть skipped или unsatisfied | finished/partial |

Back меняет только положение в учебном маршруте. Он не удаляет созданный note, не отменяет запрос, не возвращает старые permissions и не вызывает browser history back вслепую.

Optional шаг с `onUnavailable=not-applicable` и отсутствующей capability получает отдельную причину неприменимости: это не user skip и не completion. Required шаг так пропустить нельзя. При появлении возможности дополнительный шаг доступен повторно. Optional шаг можно пропустить без блокирования учебного маршрута, но его пропуск остаётся видимым и не считается освоением соответствующей операции. Завершённый учебный маршрут не является доказательством качества бизнес-результата.

## 5. Что считается доказательством

Три независимых уровня: **acknowledged**, **action-observed**, **outcome-verified**. У шага указан минимально необходимый уровень. Значения не выводятся из цвета кнопки, текста toast или количества посещённых экранов.

### Сопоставление с существующими событиями

| Существующее в коде | Новое наблюдение обучения | Чего недостаточно |
|---|---|---|
| Успешное принятие отправки обычным обработчиком, новое user message в сессии | `user-turn.accepted` | Click Send; непустой input; заранее созданный welcome |
| `text_complete`, `complete` | `user-turn.final-delivered` | Любой assistant message или один text_delta |
| `tool_start` + `tool_result` с подходящим toolUseId | `source.tool-succeeded` | Выбранный источник; tool_start без результата |
| `sources_changed` после применения session state | `session.sources-committed` | Источник с галочкой в оптимистическом меню |
| `session_status_changed` | `session.status-committed` | DOM-текст нового статуса до подтверждения |
| `labels_changed` | `session.labels-committed` | Открытие меню меток |
| `project_id_changed` | `session.project-committed` | Щелчок по пункту списка |
| Реальный permission request и завершённый пользовательский ответ | `permission.resolved-by-user` | Timeout, disappearance, кнопка Done в Inbox |
| Сохранение PersonalTask в действующий persist store и подтверждение sync | `personal-task.persisted` | Только localStorage/optimistic row |
| Реальное сохранение Note/Memory и актуальное read-back или native commit notification | `note.persisted` / `memory.persisted` | Открытие редактора; закрытие Memory onboarding |
| Поиск завершился и пользователь открыл актуальный hit | `search.result-opened` | Набор строки, старый hit от предыдущего запроса |
| Page lease получен и host отобразил конкретный content digest | `page.rendered` | Само существование PagesHome |

Названия слева проверены только там, где указаны настоящие события; остальные строки описывают существующую операцию, которую адаптер должен трассировать до её реального acknowledgement. **Нельзя выдумывать native event name, которого нет в checkout.** Все имена справа — новые внутренние TourSignal, не новые backend RPC.

### Корреляция первого ответа

Перед отправкой зафиксировать binding, текущие message IDs/порядок и новый attempt operation token. После нормальной отправки связать token с новым user message. Наблюдать только события и состояние этой сессии.

`CompleteEvent` в прочитанном коде не имеет `turnId`; нельзя просто дописать его в payload и считать контракт существующим. Использовать имеющиеся turn/message IDs на текстовых событиях и изменения канонического транскрипта. Когда однозначно сопоставить завершение нельзя, статус остаётся observed/blocked, не verified.

При наличии полей требуется `reason === 'complete'` и `didReceiveNewFinalMessage === true`. Для старого runtime без этих полей допустим только отдельный проверенный адаптер: новый финальный non-intermediate assistant message после связанного user message, завершённое processing state, отсутствие cancel/error/timeout для этой операции. Не превращать отсутствие признака ошибки в универсальное доказательство успеха.

Welcome, повторно загруженная история, retry/discarded text и intermediate results исключаются. Финальный ответ с восстановившейся ошибкой инструмента может быть доставленным ответом, но не доказательством успеха конкретного tool call. Отдельный tool-success требует результата без `isError`.

### Место подключения

`useEventProcessor.processAgentEvent()` возвращает `session/effects`. A0 вызывает экспортированный A4 observer **после фактического применения** нового session state в App. Чистый processor не получает DOM, IndexedDB или tour side effects. Обработчики вне общего processor инструментируются на их действующей точке commit, не вторым конкурирующим listener на все transport messages.

## 6. Targets и несколько панелей

Существующий `NavigationContext` управляет focused panel; `MainContentPanel` уже принимает `panelId` и `navStateOverride`. A0 добавляет `TourPanelScope` на границе этого host. Global workspace controls регистрируются как shell targets; остальные — внутри panel scope.

Предлагаемый optional hook:

```tsx
// НОВЫЙ API. Типы финализирует A0; существующий ref нельзя заменить.
const tourRef = useTourTarget('composer.input', { sessionId })
// Связать tourRef с тем же реальным DOM-элементом через composeRefs.
// data-tour-id нужен тестам; он не заменяет регистрацию scope.
```

Registry хранит workspaceId, panelId, sessionId/entityId, variant и DOM ref. Регистрация DOM не зависит от runToken: элементы существуют и до запуска тура. TourBinding дополняет этот scope токеном конкретной попытки; resolver проверяет их совместимость. Разрешение target требует совпадения binding. Порядок: точный выбранный variant в bound panel; затем объявленный alternative того же scope; shell fallback допускается только если descriptor прямо объявлен shell. Два одинаково подходящих элемента — ошибка `ambiguous-target`, не случайный выбор первого.

Перед показом проверяются `isConnected`, ненулевая геометрия, visibility, clipping, принадлежность текущему контексту и отсутствие блокирующего слоя. При cleanup старая регистрация не должна удалять новую регистрацию того же id — нужен registration token.

React StrictMode, unmount/remount, свёрнутая панель и смена variant входят в тесты. Нельзя опираться на `.nth-child`, локализованный текст кнопки или Tailwind class.

## 7. Навигация и ожидание

Подготовка шага использует только resolver `routeKey → ViewRoute` из каталога. Для `agents` существует `buildExtraScreenRoute('agents')`; не добавлять псевдомаршрут в основной rail. Settings → `learning` — новая registry entry.

Один await не означает готовность DOM. После навигации ожидаются актуальный `navigationRevision`, нужный panel route, окончание требуемого Suspense и target registration. Каждая asynchronous continuation проверяет runToken + workspace + panel + operation token, аналогично `openFirstSessionWelcome`. Даже ACK/Next от старого popup содержит runToken и stepId: двойной клик не может случайно завершить следующий шаг. STORE effect содержит собственные scopeKey и tour, а не читает изменившийся глобальный workspace во время записи.

Предлагаемый UI-timeout — **8 секунд активного ожидания** target/route, после него blocked с Retry/Pause/Skip. Это проектное значение, не измеренная норма. Время в скрытом окне или handed-off не тратит этот бюджет. Длительность настоящей задачи, загрузки модели или установки MCP не ограничивается этим timeout и не превращается в ошибку выполнения.

Подписка на действие устанавливается до разрешения пользовательского interaction, чтобы быстрый результат не потерялся. `same-attempt` позволяет принять завершение, пришедшее во время предыдущего шага той же операции. Старые события предыдущей попытки или другого workspace не принимаются.

Автоматический переход не должен перехватывать ввод или прокрутку. Скролл к цели допустим при явном Start/Next/Resume; после асинхронного результата вне viewport предложить «Показать результат», а не вырывать пользователя из чтения.

## 8. Spotlight, focus и слои

### Внешний вид

Начальные проектные параметры: popover width 320 CSS px, максимум viewport width минус 32 px; безопасные поля 16 px; отверстие spotlight с padding 8 px; переход 120 ms; при reduced-motion — без перемещения/анимации. Использовать существующие font/color/radius/shadow tokens. Значения подлежат проверке в compact UI, не считаются универсальным стандартом.

Маска — декоративный SVG/CSS слой с `aria-hidden=true` и `pointer-events:none`. Элемент не клонируется, не reparent-ится и не получает другой z-index ради подсветки. Popup интерактивен. Клик вне разрешённой области ставит обучение на паузу, но не поглощает обычный клик пользователя.

Rect измеряется в CSS pixels через реальный DOM ref. Нельзя умножать его на devicePixelRatio. Проверить zoom 90% (текущий default), 100%, 125%, обе темы, resize и вложенную прокрутку. Перерасчёт максимум один раз за requestAnimationFrame при изменении геометрии. Observer-ы существуют только у активного тура.

Использовать существующие popover styles/layer conventions; не ставить глобальный `z-index: 999999`. Mask и popup находятся в одном tour portal. При native/modal handoff они убираются. Для PageFrame и native browser contents подсвечивается только host chrome, не внутреннее содержимое.

### Исправление предыдущего требования к accessibility

Интерактивный spotlight — **non-modal**. У него не должно быть `aria-modal=true` и отдельного focus trap, оставляющего нужную кнопку приложения снаружи. W3C определяет modal dialog через недоступность фона; это не соответствует выбранному live-target walkthrough: [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Target остаётся доступным клавиатуре. У popover есть accessible title/description, понятные кнопки управления и «Перейти к элементу». Focus не переставляется при каждом `text_delta`. После закрытия возвращается прежнему связанному элементу, если тот ещё существует; иначе кнопке запуска обучения.

Radix `onInteractOutside` не должен закрывать весь маршрут при нормальном взаимодействии с объявленным target. При открытии его dropdown/drawer происходит handoff: tooltip и затемнение скрываются, нативное управление focus остаётся владельцем взаимодействия. После закрытия и перепроверки binding обучение возобновляется.

### Интеграция с существующими registry

`ModalContext` и `DismissibleLayerContext` сейчас не публикуют reactive subscribe. A2 добавляет совместимые `subscribe/getSnapshot` с кешированным snapshot, сохраняя текущие методы. Не читать `hasOpenModals()` один раз и не считать это слежением за состоянием.

Tour регистрируется как `custom` с низким приоритетом `-1000`; собственная регистрация исключается из blockers. Любой другой активный modal приоритетнее. Для Cmd+W использовать существующий modal-close path; это не означает выставление ARIA modal. A2 тестирует согласованность обоих registry.

Не добавлять второй global `keydown Escape`. Существующий bubble-handler даёт внутреннему редактору/диалогу обработать Esc первым. Tour не задаёт `canBack` на Esc: закрытие/пауза отдельно от кнопки Back. Enter на кнопке обучения не должен отправлять draft.

## 9. Capability gates

Capability — не один feature flag. Это сочетание: доступный route/модуль, поддерживаемая среда, доступный метод API, право на операцию, корректно загруженное состояние и при необходимости существующий объект.

| Ситуация | Поведение |
|---|---|
| MCP выбран, но устанавливается | Sources overview доступен; Source-use ожидает ready; первый разговор не блокируется |
| Для Source нужен ключ | Показать status/reason и обычный путь настройки; не запускать OAuth автоматически |
| WebUI без локального доступа | Не показывать выбор локальной папки как рабочий; нет обращения к host inventory |
| Notes API возвращает unavailable | Объяснение в центре обучения; не выдавать пустой fixture note за созданный |
| Нет Page/meeting/automation | Intro/list допустим; шаг конкретного объекта контекстно ждёт его появления, не создаёт объект сам |
| Источник поиска недоступен | Остальные источники могут отвечать; показать ограничения отдельно |
| Budget неизвестен | Unknown/«—», не zero и не обещание enforced limit |
| Permission request истёк | Приостановить/перепривязать; не считать пользовательским решением |
| Пользователь сменил панель/workspace | Пауза; старые callback-ы становятся no-op |

Requirements и понятные причины показываются в LearningSettingsPage. Обновление capability не запускает тур само по себе; оно только меняет доступность приглашения/Resume.

## 10. Сохранение прогресса

### Выбор

Создать маленькую клиентскую IndexedDB `rox-product-tour`. Это не новая серверная БД и не облачная синхронизация. Она даёт атомарные изменения нескольких записей одного origin/partition без зависимости от `localStorage.set`, который сейчас проглатывает ошибки. Общие правила транзакций: [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).

Object stores:

| Store | Ключ | Содержание |
|---|---|---|
| `meta` | literal key | schemaVersion, случайный clientProfileId, preferences |
| `progress` | scopeKey + tourId | версии шагов, shown/ack/observed/verified, skipped, dismissal |
| `attempts` | scopeKey + attemptId | ограниченная история попыток, времена, phase/reason, без текста и entity IDs |
| `leases` | clientProfileId | ownerWindowId, fence, expiresAt |
| `diagnostics` | auto sequence | опциональный обезличенный журнал |

`scopeKey = clientProfileId + workspaceId`; это **профиль клиента**, не аутентифицированный userId. Текущий authenticated web bootstrap не даёт principalId. Нельзя объявлять это персональной серверной синхронизацией, переносить данные между origin/partition или использовать scopeKey для авторизации.

Функциональные сведения о прогрессе сохраняются локально. Никакие имена workspace, тексты, session IDs, paths и source URLs в diagnostics не записываются. В runtime binding IDs допустимы в памяти для правильной адресации. При общей browser profile у нескольких людей прогресс также общий; до появления подтверждённого identity-port не обещать per-account progress. Web-приглашения автоматически не стартуют по отсутствию прогресса.

### Конкурентные окна

Один активный tour в одной storage partition. Аренда `leases` получается/обновляется атомарной readwrite-транзакцией. Новое владение увеличивает fence. Предлагаемые heartbeat 5 s / TTL 15 s; на blur/pause lease освобождается. Потеря lease немедленно делает runtime paused, а перед новым UI-effect проверяется fence. BroadcastChannel только уведомляет, но не является источником истины.

Гарантия ограничена одинаковым origin и partition. Для изолированных partitions/профилей нельзя обещать общий lock. Прогресс обновляется по версии и набору достигнутых стадий, а не перезаписывается целым старым snapshot.

### Ошибки и версии

В transaction completion возвращать `saved`, `memory-only` или `failed`. Storage error не может быть обработан как saved. При недоступном IndexedDB обучение работает в памяти, показывает предупреждение и не навязывает повторные автоматические приглашения при каждом открытии.

Copy-only изменение не сбрасывает достижения. Семантическое изменение конкретного шага повышает stepVersion; новое подтверждение требуется только там, где поменялось действие. Replay создаёт новую попытку, не стирая исторические verified milestones. Неизвестная будущая schema version обрабатывается fail-safe без удаления данных.

Reset удаляет только записи этого namespace/scope и только после отдельного подтверждения. Запрещены `localStorage.clear()`, удаление профиля Rox или Memory markers. Старые markers setup/welcome/memory не мигрируются в «все туры завершены».

## 11. Существующие onboarding и Quests

### First run и welcome

Сохранить `useOnboarding` и `ensureFirstSessionWelcome` без изменения их семантики. В серверном helper ненулевой результат создаётся только при отсутствии marker и существующих сессий; это подходящий сигнал, чтобы **предложить** первый маршрут. A0 использует уже возвращённую session, не вызывает ENSURE_FIRST_SESSION повторно ради тура.

Установка built-in MCP не становится условием готовности первого маршрута. Новый provider/Connect/OAuth запускается только обычной явной командой пользователя.

### Memory dialog

A0 добавляет отдельное управление допуском показа (например, новый `presentationAllowed` prop) в `components/app-shell/OnboardingDialog.tsx`. При выключенном feature flag сохраняется старое поведение. При включённом dialog предлагается только в контексте Memory и при отсутствии активного product tour/setup/permission flow.

Постановка в очередь или suppress показа **не вызывает finish/markMemoryOnboarded**. Явный Skip/Close настоящего Memory dialog сохраняет существующую семантику. Product-tour не считает её подтверждением `memory.persisted`; для этого нужна реальная запись/проверка.

### Quests

Добавить «Показать как» для совместимых Quest: `first_note → OBT-17`, `first_task → OBT-15`, `first_workflow → OBT-23`. При отсутствии нужного объекта открыть карточку сценария с объяснением prerequisites, а не пытаться запустить невозможный шаг.

Остальные Quest остаются со своим поведением; не приравнивать first_browser к Pages и не придумывать покрытие first_link. Существующая ручная Done не становится verified evidence. Тур не выдаёт rewards и не вызывает `applyGamificationQuest({action:'complete'})` вместо пользователя.

## 12. Центр обучения и маршруты

Добавить `learning` в `apps/electron/src/shared/settings-registry.ts`, компонент в `pages/settings/settings-pages.ts`, иконку в `components/icons/SettingsIcons.tsx`. Следовать существующему registry, не создавать обходной URL parser. A0 владеет всеми этими изменениями.

На странице: сценарии, почему полезны, доступность, текущая стадия, Resume/Replay, управление приглашениями, локальная диагностика по opt-in и scoped reset. Результаты «просмотрено» и «действие выполнено» показываются раздельно; нельзя рисовать одинаковую зелёную галочку для acknowledgement и verified operation.

Для доступа с клавиатуры использовать действующий action registry. Не назначать уже занятую комбинацию; сначала проверить реестр. До отдельного решения достаточно доступности через settings/поиск команд без нового обязательного hotkey.

## 13. Аналитика и производительность

В поставке нет новых сетевых отправок событий. Опциональный локальный журнал: максимум 500 событий и 7 дней, по выключению очищается только этот журнал. Сохранение функционального progress не зависит от включения диагностики.

Разрешённые поля журнала: eventName из enum, tourId/stepId/version, phase, evidence level, safe reason code, platform, locale, shell variant, duration bucket. Запрещены message text, toolInput/result, credential, path, URL, document name, user email, raw entity/session/workspace IDs. Не отправлять их и в console/Sentry extra из адаптера обучения.

Дедупликация runtime events по operation + native event identity — в памяти. Persistent milestones записываются атомарно один раз на semantic stepVersion, поэтому replay и два окна не удваивают счётчик. Журнал не является источником истины для продуктовых achievements.

Предлагаемые технические цели при приёмке: выключенный feature flag не оставляет DOM observers/таймеров; активный шаг делает не более одного geometry update за animation frame; смещение spotlight после стабилизации не больше 2 CSS px на fixture; изменение target не требует перерисовки на каждый token delta. Конкретный прирост bundle и время подготовки измерить сравнением production builds baseline/candidate, не заявлять заранее достигнутые цифры.

## 14. Тестовая стратегия

Подробности — [06-ACCEPTANCE-TESTS.md](06-ACCEPTANCE-TESTS.md). Обязательны pure tests core, storage transaction tests, production component harness и application E2E. UI harness сам по себе не подтверждает правильность монтирования в App, routing или backend acknowledgement.

Детерминированной заменой может быть LLM/внешний сервис, но не реальный UI Rox или доказательство сохранения. Для Notes/Tasks/Memory использовать изолированное настоящее хранилище там, где проверяется persisted outcome. Все fixtures явно test-only и не попадают в production bundle.

Обязательные native прогоны: macOS и Windows, минимум запуск/пауза/возобновление, меню/Drawer, файловый диалог, отсутствие автоматического microphone capture. Недоступный runner обозначается NOT_RUN, а не PASSED.

## 15. Флаг, откат и rollout

Предлагаемый новый ключ `feature-product-tour-v1` добавляется через централизованный KEYS; во время разработки default off. Внутренняя приёмка — ручное включение, затем включение добровольных приглашений новым установкам. Существующих пользователей нельзя массово отправлять в тур при релизе.

При отключении: unmount host, release lease, cleanup listeners, сохранить безопасный progress, не прерывать настоящий agent run и не менять setup markers. Schema и пользовательские документы при откате не удаляются.

Полная готовность означает интеграцию всех 25 сценариев и 56 policies с корректными unavailable/empty branches, а не только красивую подсветку первой кнопки.

### Уточнение запуска runtime

Host сначала асинхронно читает progress и получает lease, перепроверяет контекст и только затем передаёт START с startMode=new/resume/replay. Resume создаёт свежий runToken. Восстановленный progress не восстанавливает полномочия и не возобновляет пользовательские операции. Signal capture привязывается к операции при её начале; позднему старому событию нельзя назначить текущий runToken только потому, что оно пришло сейчас.

### Подсказка не исчезает до прочтения результата

`requireAcknowledgementAfterEvidence` отделяет получение результата от закрытия его пояснения. Для первого final и информационных шагов с allow-current-state сначала показывается подсказка, затем пользователь подтверждает ознакомление. Подтверждённый результат не становится оценкой его качества. В handed-off сигнал только сохраняется: переход к следующему экрану возможен после закрытия дочернего диалога.

Исторический progress и `attemptEvidence` разделены. При replay старый acknowledgedAt не закрывает новую подсказку, а старый verifiedAt не доказывает выполнение нового запроса. `sources.ask` — самостоятельная отправка вопроса между выбором Source и ожиданием tool result. Без него тур мог бы ждать отсутствующий результат, ещё не дав пользователю выполнить запрос.

### Недостающий контекст объекта

При ручном запуске из центра обучения может не быть выбранной session/page/automation. Host предлагает открыть соответствующий существующий список и ждёт явного выбора пользователя. Он не берёт произвольный первый объект и не создаёт его сам. Это prerequisite preparation, а не фиктивно завершённый учебный шаг. Sidebars, принадлежащие focused panel, регистрируют её id явно; контент соседней панели не переименовывается вслед за глобальным focus.
