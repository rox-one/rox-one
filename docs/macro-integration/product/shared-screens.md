# Общие и contextual screens

Target spec; source citations pinned. Все proposed subviews требуют typed router integration; существующий destination не доказывает proposed route. Общие layout/states/a11y в UI-UX-CONTRACT.md.

## SH-01 — Навигация и панели

Placement: Native app shell → all destinations.

Current: Existing registry and browser history remain authoritative. Target: Target typed entity route + tab/filter/panel state; narrow drilldown.

Evidence: [APP_NAV_DESTINATIONS](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/app-shell/nav-destinations.ts#L87-L116). Packages: WP-40, WP-46.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| destination: Раздел | registered destination + workspace | typed route and restored selection | row tint + exact destination label; Открывает существующий раздел текущего workspace и восстанавливает его сохранённое представление. | Видимая focus ring; та же справка: Открывает существующий раздел текущего workspace и восстанавливает его сохранённое представление.; focus не выполняет mutation | navigate once; leaving pending draft prompts save/copy only when required | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| panel: Открыть рядом | canonical EntityRef | second representation of same ref | button tint, explain same-object view; Показывает тот же объект в соседней панели; изменения относятся к одной сущности. | Видимая focus ring; та же справка: Показывает тот же объект в соседней панели; изменения относятся к одной сущности.; focus не выполняет mutation | create panel, do not duplicate data store | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| back: Назад | history cursor | previous tab/filter/scroll | tooltip previous destination only if authorized; Возвращает предыдущий маршрут, вкладку, фильтр и позицию прокрутки. | Видимая focus ring; та же справка: Возвращает предыдущий маршрут, вкладку, фильтр и позицию прокрутки.; focus не выполняет mutation | restore persisted view state | Alt+Left outside editor; button always available | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- destination: Открывает существующий раздел текущего workspace и восстанавливает его сохранённое представление. Пример: «Задачи» возвращает выбранный список и фильтр. Источник: navigation.setView; returned revision/watermark or receipt readback
- panel: Показывает тот же объект в соседней панели; изменения относятся к одной сущности. Пример: Company Acme открыта рядом с письмом без создания копии Company. Источник: navigation.setView; returned revision/watermark or receipt readback
- back: Возвращает предыдущий маршрут, вкладку, фильтр и позицию прокрутки. Пример: Из Task вернуться в Project → Tasks с прежним поиском. Источник: navigation.setView; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-02 — Единый поиск

Placement: Shell → Omnibox.

Current: Existing Omnibox retained. Target: Target unified ACL-scoped index and entity open.

Evidence: [Omnibox](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/platform/Omnibox.tsx#L57-L95). Packages: WP-06, WP-40.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| query: Поиск по workspace | text≤2048 + workspace + type filters + cursor | authorized hit refs/snippets/watermark | field hover border; help search scope; Ищет только разрешённые данные в выбранной рабочей области; пустой результат отличается от ошибки индекса. | Видимая focus ring; та же справка: Ищет только разрешённые данные в выбранной рабочей области; пустой результат отличается от ошибки индекса.; focus не выполняет mutation | debounced250ms cancel prior query; open hit | Cmd/Ctrl+K; arrows results; Enter open; Esc close | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| scope: Область и типы | ProjectRef? + kinds[] | filtered authorised results | chip tint; no hidden facet counts; Ограничивает поиск Project и выбранными типами сущностей. | Видимая focus ring; та же справка: Ограничивает поиск Project и выбранными типами сущностей.; focus не выполняет mutation | apply query scope; persist route filter | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| hit: Результат поиска | permitted ref + snippet source | native detail/context | highlight, cached peek permitted only; Открывает исходную сущность; snippet и его источник доступны только при текущем read grant. | Видимая focus ring; та же справка: Открывает исходную сущность; snippet и его источник доступны только при текущем read grant.; focus не выполняет mutation | open canonical route; forbidden result purged | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- query: Ищет только разрешённые данные в выбранной рабочей области; пустой результат отличается от ошибки индекса. Пример: Запрос «Acme» возвращает разрешённые Company, письмо и задачу. Источник: search.entities; returned revision/watermark or receipt readback
- scope: Ограничивает поиск Project и выбранными типами сущностей. Пример: Project «Запуск» + Tasks исключает письма из результатов. Источник: search.entities; returned revision/watermark or receipt readback
- hit: Открывает исходную сущность; snippet и его источник доступны только при текущем read grant. Пример: Письмо открывается во Входящих с тем же MailThreadRef. Источник: entity.resolve; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-03 — Предпросмотр, связи и избранное

Placement: Entity chip → peek; detail → linked objects.

Current: Canonical Rox2 kinds/refs/relations retained. Target: Target authorized inbound/outbound graph views.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-02, WP-09, WP-40.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| peek: Предпросмотр | EntityRef + policy epoch | safe title/type/summary | 400ms cached peek; disabled inaccessible; Показывает краткую разрешённую проекцию объекта без изменения его read/unread или sharing. | Видимая focus ring; та же справка: Показывает краткую разрешённую проекцию объекта без изменения его read/unread или sharing.; focus не выполняет mutation | explicit open retrieves authorized detail | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| link: Связать объект | sourceRef + targetRef + relation | receipt + relation revision | explain mentions/derived-from/attached-to semantics; Создаёт типизированную связь между двумя существующими сущностями; доступ автоматически не выдаётся. | Видимая focus ring; та же справка: Создаёт типизированную связь между двумя существующими сущностями; доступ автоматически не выдаётся.; focus не выполняет mutation | picker→preview relation→confirm; cycles checked | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| star: В избранное | EntityRef + boolean | private preference receipt | add/remove tooltip; Сохраняет личную ссылку на объект; это не копия и не public share. | Видимая focus ring; та же справка: Сохраняет личную ссылку на объект; это не копия и не public share.; focus не выполняет mutation | optimistic star, rollback error; revoke hides cached label | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- peek: Показывает краткую разрешённую проекцию объекта без изменения его read/unread или sharing. Пример: Навести на Company chip и увидеть имя/тип; denied ref не показывает название. Источник: entity.resolve; returned revision/watermark or receipt readback
- link: Создаёт типизированную связь между двумя существующими сущностями; доступ автоматически не выдаётся. Пример: Task derived-from Message сохраняет два исходных ID. Источник: entity.link; returned revision/watermark or receipt readback
- star: Сохраняет личную ссылку на объект; это не копия и не public share. Пример: После revoke избранная Company не сохраняет старое приватное название. Источник: favorite.set through preferences.setFavorite adapter; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-04 — Доступ и отзыв разрешений

Placement: Entity header → Share.

Current: Existing Page share entry retained. Target: Target reusable grants dialog, not page-only policy.

Evidence: [SharePageDialog](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/pages/SharePageDialog.tsx#L85-L114). Packages: WP-03, WP-51.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| grant: Пригласить и выбрать роль | principalRef + read/write/share scope + expiry | effective grant and receipt | role help lists permitted operations; Выдаёт выбранному principal конкретные действия и срок доступа после review аудитории. | Видимая focus ring; та же справка: Выдаёт выбранному principal конкретные действия и срок доступа после review аудитории.; focus не выполняет mutation | review audience diff→confirm; no implicit grant from mention | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| revoke: Убрать доступ | grantId + expectedRevision | pending then fenced applied revoke | red tint; explain open clients affected; Отзывает grant; завершение показывается после server delivery fence, а не по одному UI клику. | Видимая focus ring; та же справка: Отзывает grant; завершение показывается после server delivery fence, а не по одному UI клику.; focus не выполняет mutation | confirmation names principal/entity; await delivery fence | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| public: Доступ по ссылке | explicit audience + expiry + allowed action | revocable capability if policy permits | privacy help always visible; Создаёт ограниченную отзывную capability только если policy разрешает эту аудиторию. | Видимая focus ring; та же справка: Создаёт ограниченную отзывную capability только если policy разрешает эту аудиторию.; focus не выполняет mutation | separate explicit confirmation; default private | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- grant: Выдаёт выбранному principal конкретные действия и срок доступа после review аудитории. Пример: B получает write к Page до выбранной даты; owner CRM остаётся отдельным полем. Источник: permission.grant; returned revision/watermark or receipt readback
- revoke: Отзывает grant; завершение показывается после server delivery fence, а не по одному UI клику. Пример: У B открыта Page: новые reads/edits блокируются после revoke receipt. Источник: permission.revoke; returned revision/watermark or receipt readback
- public: Создаёт ограниченную отзывную capability только если policy разрешает эту аудиторию. Пример: Ссылка на запись истекает в указанное время; наличие ссылки не добавляет workspace membership. Источник: share.createCapability; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-05 — Уведомления и внимание

Placement: Inbox → attention representations; shell indicator opens same view.

Current: Existing Inbox merges All/Decisions/Messages/Snoozed/Done, agent permission/credential requests and JMAP Mail; preserve those flows. Target: Target unified notification projections inside existing attention Inbox; mark-read never resolves approval decision.

Evidence: [InboxPage](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/InboxPage.tsx#L91-L150). Packages: WP-07, WP-08, WP-09.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| notification: Открыть уведомление | notificationId + targetRef | native target and explicit read command | row tint; no mark-on-hover; Открывает разрешённый target; просмотр не одобряет запрос агента и не выполняет бизнес-команду. | Видимая focus ring; та же справка: Открывает разрешённый target; просмотр не одобряет запрос агента и не выполняет бизнес-команду.; focus не выполняет mutation | open target; mark only actual permitted viewing; receipt | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| read: Отметить прочитанными | notificationIds[] + stateRevision | dedup durable state | tooltip number from authorised selection; Меняет только read state выбранных уведомлений; failed items остаются в прежнем состоянии. | Видимая focus ring; та же справка: Меняет только read state выбранных уведомлений; failed items остаются в прежнем состоянии.; focus не выполняет mutation | batch command, rollback failed rows | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| unread: Непрочитанные | attention state/types | paged items and watermark | filter chip tint; Фильтрует durable attention state; unread не равен undone или dismissed. | Видимая focus ring; та же справка: Фильтрует durable attention state; unread не равен undone или dismissed.; focus не выполняет mutation | server query; unseen≠dismissed | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- notification: Открывает разрешённый target; просмотр не одобряет запрос агента и не выполняет бизнес-команду. Пример: Assignment notification открывает Task; permission request остаётся pending. Источник: notification.setRead; returned revision/watermark or receipt readback
- read: Меняет только read state выбранных уведомлений; failed items остаются в прежнем состоянии. Пример: Два устройства повторяют mark-read, итоговая state revision одна. Источник: notification.setRead; returned revision/watermark or receipt readback
- unread: Фильтрует durable attention state; unread не равен undone или dismissed. Пример: Прочитанный, но не одобренный agent request остаётся в Решениях. Источник: notification.list; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-06 — Активность и происхождение событий

Placement: Project/entity detail → Activity; Feed contextual.

Current: Existing Feed retained as configured sources. Target: Target canonical entity events, separate from lossy awareness.

Evidence: [FeedPage](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/FeedPage.tsx#L121-L155). Packages: WP-04, WP-07, WP-37.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| event: Событие активности | eventId + targetRef + causationId | redacted event detail | source/freshness tooltip; Показывает actor, действие, время и причинную связь без приватного тела источника. | Видимая focus ring; та же справка: Показывает actor, действие, время и причинную связь без приватного тела источника.; focus не выполняет mutation | open allowed target or evidence receipt | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| filter: Фильтры активности | actor/type/time/project filters + cursor | authorised timeline | chip tint; units ISO interval explained; Ограничивает timeline по actor, типу, Project и интервалу времени. | Видимая focus ring; та же справка: Ограничивает timeline по actor, типу, Project и интервалу времени.; focus не выполняет mutation | query without reading private bodies | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| receipt: Результат команды | commandId | revision/provider/event/projection state | status explanation, no private payload; Показывает revision, lifecycle, verification и состояние внешнего provider. | Видимая focus ring; та же справка: Показывает revision, lifecycle, verification и состояние внешнего provider.; focus не выполняет mutation | open receipt panel; copy redacted correlation ID | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- event: Показывает actor, действие, время и причинную связь без приватного тела источника. Пример: task.assigned связан с Message→Task commandId. Источник: activity.list; returned revision/watermark or receipt readback
- filter: Ограничивает timeline по actor, типу, Project и интервалу времени. Пример: Только изменения Tasks за текущую неделю выбранного Project. Источник: activity.list; returned revision/watermark or receipt readback
- receipt: Показывает revision, lifecycle, verification и состояние внешнего provider. Пример: Mail send succeeded не равно readback_verified; unknown требует reconcile. Источник: command.getReceipt; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-07 — Контекст агента и проверка команды

Placement: Sessions → composer/context rail.

Current: Agent Sessions preserved separate from human Message. Target: Target same domain gateway tools and context provenance.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-36, WP-50.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| context: Добавить контекст | EntityRef[] + allowed fields | authorized context manifest, not full stored transcript | chip preview title only if granted; Прикрепляет refs и разрешённые поля; агент не получает весь сохранённый transcript автоматически. | Видимая focus ring; та же справка: Прикрепляет refs и разрешённые поля; агент не получает весь сохранённый transcript автоматически.; focus не выполняет mutation | picker→sources preview→attach; denied refs omitted with neutral reason | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| preview: Проверить изменение | typed command draft + expectedRevision + scope | validated diff and execution grant requirement | shows affected entity/action; Показывает текущий typed diff и требует новую проверку после изменения source revision. | Видимая focus ring; та же справка: Показывает текущий typed diff и требует новую проверку после изменения source revision.; focus не выполняет mutation | confirm current diff; changed revision requires new preview | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| toolreceipt: Результат инструмента | receipt/ref/source spans | verified result/context citations | source/freshness hint; Открывает подтверждение domain command и читаемые source citations. | Видимая focus ring; та же справка: Открывает подтверждение domain command и читаемые source citations.; focus не выполняет mutation | open source through gateway; no direct legacy write | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- context: Прикрепляет refs и разрешённые поля; агент не получает весь сохранённый transcript автоматически. Пример: Добавить Company и Task; private Mail teammate не раскрывается. Источник: agent.resolveContext; returned revision/watermark or receipt readback
- preview: Показывает текущий typed diff и требует новую проверку после изменения source revision. Пример: Агент предлагает назначить Task пользователю B; confirm связан с этим diff. Источник: agent.previewCommand; returned revision/watermark or receipt readback
- toolreceipt: Открывает подтверждение domain command и читаемые source citations. Пример: TaskRef/revision совпадают с последующим task.get. Источник: agent.invokeDomain through agent.executeCommand adapter; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-08 — Доступ к сессии и экспорт

Placement: Session detail → share/export/viewer.

Current: Existing session upload/share needs audience-safe guard. Target: Target derived artifact export with provenance/redaction.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-50.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| audience: Кому доступна сессия | recipient/policy + selected messages | redacted artifact preview/hash | help mixed-source limits; Выбирает аудиторию export projection и показывает redactions источников. | Видимая focus ring; та же справка: Выбирает аудиторию export projection и показывает redactions источников.; focus не выполняет mutation | compute safe projection; cannot grant private tool output implicitly | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| publish: Поделиться сессией | approved projection hash + expiry | revocable share receipt | button explains audience; Публикует только проверенный digest projection с expiry и current source grants. | Видимая focus ring; та же справка: Публикует только проверенный digest projection с expiry и current source grants.; focus не выполняет mutation | publish only current hash; stale source permission invalidates | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- audience: Выбирает аудиторию export projection и показывает redactions источников. Пример: Public Page остаётся; private Mail tool output исключён из export. Источник: session.previewExport; returned revision/watermark or receipt readback
- publish: Публикует только проверенный digest projection с expiry и current source grants. Пример: Source revoke между preview и publish отклоняет старый digest. Источник: session.shareAuthorized through session.publishExport adapter; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-09 — Источники и исправление памяти

Placement: Memory → item detail.

Current: Existing memory surface retained. Target: Target fact/source references and permission-aware retrieval.

Evidence: [MemoryScreen](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/memory/MemoryScreen.tsx#L162-L194). Packages: WP-06, WP-36.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| source: Источники памяти | factRef + sourceRefs + timestamps | authorized source/evidence | freshness and source tooltip; Показывает provenance, source refs и время получения данных факта. | Видимая focus ring; та же справка: Показывает provenance, source refs и время получения данных факта.; focus не выполняет mutation | open source; denied source text purged | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| correction: Исправить или отозвать | factRef + expectedRevision + reason | retraction/correction receipt | explain agent effect; Меняет факт через revisioned command и обновляет retrieval watermark. | Видимая focus ring; та же справка: Меняет факт через revisioned command и обновляет retrieval watermark.; focus не выполняет mutation | preview→confirm; subsequent retrieval excludes retracted source | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- source: Показывает provenance, source refs и время получения данных факта. Пример: Факт «Acme ждёт КП» ссылается на разрешённое письмо. Источник: memory.getProvenance; returned revision/watermark or receipt readback
- correction: Меняет факт через revisioned command и обновляет retrieval watermark. Пример: Отозванный факт больше не появляется в новом ответе агента. Источник: memory.correctFact; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-10 — Правило автоматизации и результаты

Placement: Automations → rule detail/runs.

Current: Existing automation list/runtime retained. Target: Target durable event consumer; external actions policy/budget gated.

Evidence: [AutomationsListPanel](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx#L115-L149). Packages: WP-37.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| trigger: Событие запуска | canonical event kind + workspace filter | validated trigger subscription | event semantics help; Выбирает зарегистрированный event schema и проверяемый фильтр рабочей области. | Видимая focus ring; та же справка: Выбирает зарегистрированный event schema и проверяемый фильтр рабочей области.; focus не выполняет mutation | select event schema; no ambiguous string trigger | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| action: Действие и лимиты | typed domain command + execution policy + limits | preview/test receipt | cost/source/unit tooltip; Показывает typed command, разрешения и budget; fixture dry-run не вызывает providers. | Видимая focus ring; та же справка: Показывает typed command, разрешения и budget; fixture dry-run не вызывает providers.; focus не выполняет mutation | dry-run fixture labelled; enable only permitted live action | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| run: Прогон автоматизации | runId + eventId + dedupKey | attempts/redacted receipt/recovery | status explanation; Показывает eventId, dedupKey, попытки и receipts; retry сначала проверяет прошлый результат. | Видимая focus ring; та же справка: Показывает eventId, dedupKey, попытки и receipts; retry сначала проверяет прошлый результат.; focus не выполняет mutation | inspect; retry reconciles side effects, never blind resend | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- trigger: Выбирает зарегистрированный event schema и проверяемый фильтр рабочей области. Пример: task.assigned запускает правило только для Project «Запуск». Источник: automation.registerTrigger; returned revision/watermark or receipt readback
- action: Показывает typed command, разрешения и budget; fixture dry-run не вызывает providers. Пример: Два одинаковых event дают одну side effect; dry-run externalWrites=0. Источник: automation.dryRun; returned revision/watermark or receipt readback
- run: Показывает eventId, dedupKey, попытки и receipts; retry сначала проверяет прошлый результат. Пример: Неизвестный результат email send переходит в reconcile без повторной отправки. Источник: automation.getRun; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-11 — Соединения и возможности workspace

Placement: Connections → provider detail.

Current: Existing Connections retained. Target: Target authenticated workspace/provider probes and capability statuses.

Evidence: [ConnectionsPage](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/pages/ConnectionsPage.tsx#L67-L99). Packages: WP-01, WP-20, WP-27, WP-31, WP-52.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| connect: Подключить провайдер | provider kind + test tenant + scopes | OAuth/server connection ref | scope and outbound data explanation; Показывает запрашиваемые scopes и назначение перед OAuth; секрет хранится сервером. | Видимая focus ring; та же справка: Показывает запрашиваемые scopes и назначение перед OAuth; секрет хранится сервером.; focus не выполняет mutation | browser OAuth→server secret→probe; no client token snapshot | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| probe: Проверить соединение | connectionRef | capabilities/last read-back/error | source/time tooltip; Выполняет probe фактического adapter и показывает время последнего readback. | Видимая focus ring; та же справка: Выполняет probe фактического adapter и показывает время последнего readback.; focus не выполняет mutation | probe actual installed adapter; unavailable remains unavailable | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| mode: Режим workspace | standalone/shared workspace binding | writer mode receipt | explains local vs shared authority; Переключает standalone/shared authority после проверки сервиса и fencing старого writer. | Видимая focus ring; та же справка: Переключает standalone/shared authority после проверки сервиса и fencing старого writer.; focus не выполняет mutation | verify service before switch; fence old writer; no dual write | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- connect: Показывает запрашиваемые scopes и назначение перед OAuth; секрет хранится сервером. Пример: Google Calendar read-only не включает право менять событие. Источник: connection.startAuth; returned revision/watermark or receipt readback
- probe: Выполняет probe фактического adapter и показывает время последнего readback. Пример: Token есть, adapter unavailable: запись событий остаётся disabled. Источник: connection.probe; returned revision/watermark or receipt readback
- mode: Переключает standalone/shared authority после проверки сервиса и fencing старого writer. Пример: Личный Task не отправляется в shared workspace автоматически. Источник: workspace.switchMode; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-12 — Файлы и безопасный просмотр

Placement: Project Assets / attachments → viewer.

Current: Existing asset/viewer representations retained. Target: Target shared File refs/ACL/upload receipts.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-39, WP-44.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| upload: Загрузить файл | file bytes + checksum + parentRef + limits | upload ref/progress/scanning/ready receipt | size/type/storage explanation; Загружает части с checksum и показывает отдельные uploading/scanning/ready состояния. | Видимая focus ring; та же справка: Загружает части с checksum и показывает отдельные uploading/scanning/ready состояния.; focus не выполняет mutation | upload chunks/retry idempotently; no executable preview before quarantine passes | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| download: Скачать | FileRef + policy epoch | proxy/short-lived capability≤60s | size/source help; Проверяет read grant и выдаёт proxy или короткую capability с expiry. | Видимая focus ring; та же справка: Проверяет read grant и выдаёт proxy или короткую capability с expiry.; focus не выполняет mutation | recheck ACL; revoked download rejected | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| anchor: Ссылка на фрагмент | FileRef + representation anchor | typed source link | preview authorized anchor; Сохраняет typed anchor страницы, времени или строки без копирования файла. | Видимая focus ring; та же справка: Сохраняет typed anchor страницы, времени или строки без копирования файла.; focus не выполняет mutation | open safe PDF/image/video/code renderer | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- upload: Загружает части с checksum и показывает отдельные uploading/scanning/ready состояния. Пример: Restart после part2 продолжает тот же uploadId; MIME mismatch не становится ready. Источник: file.beginUpload; returned revision/watermark or receipt readback
- download: Проверяет read grant и выдаёт proxy или короткую capability с expiry. Пример: После revoke старый signed URL может действовать не дольше заявленного residual TTL. Источник: file.download; returned revision/watermark or receipt readback
- anchor: Сохраняет typed anchor страницы, времени или строки без копирования файла. Пример: Recording 02:15 открывается по тому же FileRef и time anchor. Источник: file.resolveAnchor; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-13 — Таблица внутри Page

Placement: Pages → representation spreadsheet.

Current: New behavior, no claim current collaborative spreadsheet. Target: Target headless sheet with React renderer.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-42.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| cell: Ячейка и формула | sheetRef + cellAddress + typed value/formula + revision | revisioned value/computed result/error | formula/source/units tooltip; Изменяет одну ячейку; formula вычисляется ограниченным движком, не JavaScript. | Видимая focus ring; та же справка: Изменяет одну ячейку; formula вычисляется ограниченным движком, не JavaScript.; focus не выполняет mutation | edit→validate→receipt; no arbitrary JS formula execution | arrows navigation; Enter edit/commit; Escape cancel | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| range: Импорт и экспорт диапазона | range + validated CSV input | bounded import diff/export artifact | row/column count units; Показывает bounded diff CSV до записи и число строк/колонок. | Видимая focus ring; та же справка: Показывает bounded diff CSV до записи и число строк/колонок.; focus не выполняет mutation | preview import+confirm; formula/csv injection sanitized | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- cell: Изменяет одну ячейку; formula вычисляется ограниченным движком, не JavaScript. Пример: A1=2,A2=3,A3=SUM(A1:A2) даёт 5 после reload. Источник: spreadsheet.editCell through sheet.setCell adapter; returned revision/watermark or receipt readback
- range: Показывает bounded diff CSV до записи и число строк/колонок. Пример: Импорт 20×3 не меняет sheet до подтверждения текущего preview digest. Источник: sheet.previewImport; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-14 — Холст внутри Page

Placement: Pages → representation canvas.

Current: New behavior behind capability flag. Target: Target revisioned whole-file edits, not unproven CRDT canvas.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-43.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| node: Узел холста | nodeId + geometry + safe payload + baseRevision | canonical whole-file revision or conflict | handles on hover/focus; Перемещает/меняет размер узла через whole-file CAS; stale revision сохраняет конфликтный draft. | Видимая focus ring; та же справка: Перемещает/меняет размер узла через whole-file CAS; stale revision сохраняет конфликтный draft.; focus не выполняет mutation | preview move/resize→CAS; simultaneous conflict compare | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| entitynode: Связанный объект | EntityRef + geometry | safe reference node | authorized peek; Добавляет ссылочный узел; thumbnail и peek требуют read target grant. | Видимая focus ring; та же справка: Добавляет ссылочный узел; thumbnail и peek требуют read target grant.; focus не выполняет mutation | link picker; no hidden entity thumbnail | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- node: Перемещает/меняет размер узла через whole-file CAS; stale revision сохраняет конфликтный draft. Пример: A и B двигают узел с base17: один commit, у второго conflict. Источник: canvas.save through canvas.patchRevision adapter; returned revision/watermark or receipt readback
- entitynode: Добавляет ссылочный узел; thumbnail и peek требуют read target grant. Пример: Company node сохраняет EntityRef, а не вторую CRM запись. Источник: canvas.linkEntity; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-15 — Навыки, источники и review кода

Placement: Skills/Sources and Session artifact review.

Current: Existing skills/source configuration preserved. Target: Target code-origin/license gate and real patch review.

Evidence: [SkillsListPanel](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx#L48-L79). Packages: WP-45, WP-48.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| skill: Установить или обновить навык | origin/version/digest/capabilities | reviewed install receipt | origin/license/version help; Показывает origin/version/digest/license и изменения tool capabilities до установки. | Видимая focus ring; та же справка: Показывает origin/version/digest/license и изменения tool capabilities до установки.; focus не выполняет mutation | review diff+tool permissions; no silent trust upgrade | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| patch: Проверить изменения кода | baseSha + diff + tests + source manifest | reviewed branch/draft PR evidence | changed-file origin/test receipt; Показывает реальный diff, baseSha, ownership и test receipts. | Видимая focus ring; та же справка: Показывает реальный diff, baseSha, ownership и test receipts.; focus не выполняет mutation | read real diff; do not mark absent diff viewer implemented | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| apply: Применить patch | reviewed digest + clean base + ownership | commit/branch/read-back receipt | scope and target branch; Проверяет clean base, digest и allowedPaths; создаёт изолированную ветку/commit. | Видимая focus ring; та же справка: Проверяет clean base, digest и allowedPaths; создаёт изолированную ветку/commit.; focus не выполняет mutation | recheck base/paths; no automatic merge/deploy | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- skill: Показывает origin/version/digest/license и изменения tool capabilities до установки. Пример: Обновление навыка с новым filesystem scope требует отдельного review. Источник: skill.previewInstall; returned revision/watermark or receipt readback
- patch: Показывает реальный diff, baseSha, ownership и test receipts. Пример: Отсутствующий diff не превращается в «проверено» из-за done cloud run. Источник: coding.reviewPatch; returned revision/watermark or receipt readback
- apply: Проверяет clean base, digest и allowedPaths; создаёт изолированную ветку/commit. Пример: Patch по старому baseSha отклоняется до изменения файлов. Источник: coding.applyPatch; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-16 — Синхронизация и возможности устройства

Placement: Entity header sync detail; narrow view.

Current: Existing status triad retained. Target: Target explicit offline/provider/device capabilities.

Evidence: [Rox2Status / ROX2_VERIFICATIONS](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L68-L111). Packages: WP-05, WP-46, WP-51.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| sync: Состояние синхронизации | ref + pending commands + policy lease | local durable/queued/ack/rejected status | lastverified timestamp; Показывает local durable frontier, pending commands, ACK и policy lease отдельно. | Видимая focus ring; та же справка: Показывает local durable frontier, pending commands, ACK и policy lease отдельно.; focus не выполняет mutation | retry only valid policy; export draft if permitted | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| capability: Возможность устройства | device capability + permission state | supported/unavailable/request-device result | help platform requirements; Объясняет поддержку платформы и состояние OS permission. | Видимая focus ring; та же справка: Объясняет поддержку платформы и состояние OS permission.; focus не выполняет mutation | request OS permission only on explicit user feature action | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- sync: Показывает local durable frontier, pending commands, ACK и policy lease отдельно. Пример: Socket connected без durable ACK оставляет edits «Сохранено на устройстве». Источник: sync.getState; returned revision/watermark or receipt readback
- capability: Объясняет поддержку платформы и состояние OS permission. Пример: Linux renderer fixture не подтверждает macOS microphone capture. Источник: device.getCapability; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-17 — Пакет облачной реализации

Placement: Cloud Runs settings/run detail; implementation runner contract.

Current: Current prepared prompt/artifact runtime not certified repo coding executor. Target: Target cloud packet branch/checkout/lane/receipt adapter if user launches implementation later.

Evidence: [RunSpec](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/cloud-runner/src/types.ts#L31-L73). Packages: WP-45, WP-47, WP-52.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| packet: Пакет реализации | WP id + integration SHA + prerequisite receipts | reviewable prompt/input manifests | deps/owner/cost/time units; Показывает WP, exact inputSha, dependencies, owned files, lanes и лимиты до dispatch. | Видимая focus ring; та же справка: Показывает WP, exact inputSha, dependencies, owned files, lanes и лимиты до dispatch.; focus не выполняет mutation | validate ready and ownership before submitting; not launched by spec build | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| results: Результаты облачного задания | runId + output manifest/hash | tests/patch/receipts/lane results | execution vs verification distinction; Разделяет executor lifecycle и feature verification, показывает diff и per-lane proof. | Видимая focus ring; та же справка: Разделяет executor lifecycle и feature verification, показывает diff и per-lane proof.; focus не выполняет mutation | import review artifact; no feature complete from done state alone | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- packet: Показывает WP, exact inputSha, dependencies, owned files, lanes и лимиты до dispatch. Пример: Без receipts ready только WP-01/WP-48; пакет сам не запускает cloud job. Источник: coding.preparePacket; returned revision/watermark or receipt readback
- results: Разделяет executor lifecycle и feature verification, показывает diff и per-lane proof. Пример: Linux pass + pending macOS оставляют feature incomplete. Источник: coding.verifyResults; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.

## SH-18 — Напоминание и его источник

Placement: Tasks → reminder detail; Inbox notification → same reminder ref.

Current: Existing recurrence/reminder primitives retained. Target: Target canonical reminder detail, source link separate; no new rail destination.

Evidence: [Rox2EntityRef](https://github.com/rox-one/rox-one/blob/e780e73ae84c977cf81546b49140d318dfcd6049/packages/core/src/rox2/platform-contract.ts#L233-L239). Packages: WP-14, WP-07, WP-40.

| Control | Input | Output | Hover | Focus | Click | Keyboard | Failure |
|---|---|---|---|---|---|---|---|
| open: Открыть напоминание | ReminderRef | same reminder detail route and policy | name/time/zone help, no source private title; Открывает reminder detail того же ID; переход к source — отдельное действие. | Видимая focus ring; та же справка: Открывает reminder detail того же ID; переход к source — отдельное действие.; focus не выполняет mutation | open reminder itself, not auto-navigate underlying source | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| snooze: Отложить напоминание | ReminderRef + untilInstant + IANAzone + expectedRevision | receipt, next occurrence and notification state | date/time/recurrence impact explained; Меняет next occurrence с timezone и revision, сохраняя recurrence rule. | Видимая focus ring; та же справка: Меняет next occurrence с timezone и revision, сохраняя recurrence rule.; focus не выполняет mutation | choose until→preview→confirm; recurrence not silently rewritten | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |
| source: Открыть источник | ReminderRef + sourceRef | authorized source detail or neutral denied placeholder | permission-filtered peek only; Открывает исходную сущность только после текущей проверки её permissions. | Видимая focus ring; та же справка: Открывает исходную сущность только после текущей проверки её permissions.; focus не выполняет mutation | open source separately; no implicit source read grant | Tab → focus; Enter/Space → action; Escape closes overlay | Denied/revoked: «Объект недоступен» и purge denied preview. Иные ошибки: видимое сообщение по errorCode; draft сохраняется только при действующей policy; pending dispatch не обещает отмену side effect. |

Help: meaning/source/freshness/example accessible hover500ms, focus and explicit click.

- open: Открывает reminder detail того же ID; переход к source — отдельное действие. Пример: Reminder из Tasks и Inbox имеет один Ref; A→B меняет displayed identity. Источник: reminder.get; returned revision/watermark or receipt readback
- snooze: Меняет next occurrence с timezone и revision, сохраняя recurrence rule. Пример: Отложить до 09:00 Europe/Berlin; stale revision не перезаписывает чужое изменение. Источник: reminder.snooze; returned revision/watermark or receipt readback
- source: Открывает исходную сущность только после текущей проверки её permissions. Пример: Reminder доступен, source Mail denied: private title/body не показываются. Источник: entity.resolve; returned revision/watermark or receipt readback

Inputs: authenticated workspace scope, EntityRef/filter/cursor/policyEpoch; authenticated Actor + payload + expectedRevision/idempotencyKey. Outputs: authorised projection + watermark; command receipt/ref/revision/events/provider state.

States: loading, empty, filtered_empty, forbidden, offline_cached, queued_local, retryable_error, conflict, unsupported, verified. Permissions: same gateway per query/command/tool; hidden titles/counts absent.

DoD: Reload preserves canonical IDs/revisions; controls produce receipt and native route; screenshot+ARIA matches UI contract. Negative: Denied principal/tool/ref and stale revision must fail; seeded removal of policy or idempotency caught. Evidence lanes: linux-domain, linux-renderer, macos-native where affected, provider-live where affected.


## SH-01 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| navigation.setView | client-command | {destination:RegisteredDestination,ref?:EntityRef,tab?:RegisteredTab,filters:Record<string,JsonValue>,panelId:string} | {route:TypedNavigationState,historyEntryId:string} | invalid_route/unknown_kind/forbidden_ref |  |
| preferences.setFavorite | command | {ref:EntityRef,favorite:boolean} | {receiptId:string,revision:number} | denied/unknown_ref | preference.updated |

Control binding: destination→navigation.setView; panel→navigation.setView; back→navigation.setView.

DoD: Open Project Tasks tab→Task detail→second panel→Back: Project ref/tab/filter unchanged, one canonical task ref.

Negative: Seed local-only tab state: reload/back mismatch must fail. Planned, not run.

## SH-02 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| search.entities | query | {workspaceId:string,text:string,maxTextLength:2048,kinds:EntityKind[],projectRef?:EntityRef,cursor?:string,limit:1..100} | {hits:AuthorizedSearchHit[],cursor?:string,projectionWatermark:string,asOf:string} | denied/invalid_filter/index_unavailable/stale_cursor |  |
| entity.resolve | query | {ref:EntityRef,fields:string[],policyEpoch:number} | {ref:EntityRef,projection:AuthorizedProjection,revision:number} | not_found_or_denied/unsupported_kind |  |

Control binding: query→search.entities; scope→search.entities; hit→entity.resolve.

DoD: A readable Page and B private Page contain same query; A gets only own hit, snippets/facets have no B title/count; opening hit yields same ref.

Negative: Seed ACL omitted in index/postfilter: hidden title/facet assertion fails. Planned, not run.

## SH-03 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| entity.resolve | query | {ref:EntityRef,fields:string[]} | {ref:EntityRef,projection:AuthorizedProjection,revision:number} | not_found_or_denied |  |
| entity.listLinks | query | {ref:EntityRef,direction:inbound/outbound,cursor?:string} | {links:AuthorizedLink[],cursor?:string} | not_found_or_denied |  |
| entity.link | command | {source:EntityRef,target:EntityRef,relation:Rox2Relation,expectedRevision:number} | {linkId:string,receiptId:string,revision:number} | denied/cross_workspace/forbidden_cycle/revision_conflict | entity.linked |
| preferences.setFavorite | command | {ref:EntityRef,favorite:boolean} | {receiptId:string,revision:number} | denied/unknown_ref | preference.updated |

Control binding: peek→entity.resolve; link→entity.link; star→preferences.setFavorite.

DoD: Task→Company link query returns same link through outbound and inbound after reload; denied Company placeholder without title.

Negative: Seed ref collision/cross-workspace acceptance: graph validation fails. Planned, not run.

## SH-04 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| permission.listEffective | query | {ref:EntityRef} | {direct:Grant[],inherited:Grant[],policyEpoch:number} | denied |  |
| permission.grant | command | {ref:EntityRef,principalRef:EntityRef,actions:ResourceAction[],expiresAt?:Instant,expectedRevision:number} | {grantId:string,effective:Grant[],receiptId:string,policyEpoch:number} | denied/invalid_principal/cross_workspace/revision_conflict | permission.granted |
| permission.revoke | command | {grantId:string,ref:EntityRef,expectedRevision:number} | {receiptId:string,state:pending_fence/applied,policyEpoch:number} | denied/revision_conflict/fence_unavailable | permission.revoked |
| share.createCapability | command | {ref:EntityRef,audience:ExplicitAudience,actions:read[],expiresAt:Instant} | {capabilityRef:string,url:string,receiptId:string} | denied/public_disabled/invalid_expiry | entity.shared |

Control binding: grant→permission.grant; revoke→permission.revoke; public→share.createCapability.

DoD: B editor receives grant; revoke while open denies next read/edit/tool and subscription after fenced receipt; no private old preview.

Negative: Seed missing subscription eviction: delivered-after-revoke assertion fails. Planned, not run.

## SH-05 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| notification.list | query | {readState:unread/read/any,types:NotificationType[],cursor?:string,limit:1..100} | {items:AuthorizedNotification[],cursor?:string,stateRevision:number,watermark:string} | denied/invalid_cursor/projection_unavailable |  |
| notification.setRead | command | {ids:string[],read:boolean,expectedStateRevision:number} | {applied:string[],failed:{id:string,code:ErrorCode}[],newRevision:number,receiptId:string} | revision_conflict/target_revoked/denied | notification.state_changed |
| notification.snooze | command | {id:string,until:Instant,expectedStateRevision:number} | {receiptId:string,newRevision:number} | denied/invalid_until/revision_conflict | notification.state_changed |

Control binding: notification→notification.setRead; read→notification.setRead; unread→notification.list.

DoD: Two devices mark same mention read; one final state revision, replay no duplicate notification; partial batch keeps failed item unread. Existing Inbox pending approval remains pending after reading mail/notification.

Negative: Seed notification.setRead calls agent approve or drops partial failure: approval/state assertions fail. Planned, not run.

## SH-06 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| activity.list | query | {ref?:EntityRef,projectRef?:EntityRef,actorRef?:EntityRef,kinds:string[],from?:Instant,to?:Instant,cursor?:string} | {events:AuthorizedActivity[],cursor?:string,watermark:string} | denied/invalid_interval/projection_unavailable |  |
| command.getReceipt | query | {commandId:string} | {commandId:string,ref:EntityRef,revision:number,lifecycle:Lifecycle,verification:Verification,eventIds:string[],providerState?:string} | not_found_or_denied |  |

Control binding: event→activity.list; filter→activity.list; receipt→command.getReceipt.

DoD: One task update outbox event produces one activity row even replayed; row includes causation but no private mail body; receipt points correct task revision.

Negative: Seed activity emitted before transaction commit: rollback leaves row assertion fails. Planned, not run.

## SH-07 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| agent.resolveContext | query | {sessionRef:EntityRef,refs:EntityRef[],requestedFields:string[]} | {sources:AuthorizedSourceManifest[],omitted:NeutralOmission[],policyEpoch:number} | denied/source_revoked/context_too_large |  |
| agent.previewCommand | query | {operation:string,input:JsonValue,expectedRevision?:number} | {previewId:string,contentDigest:string,audience:Audience,policyEpoch:number,diff:SafeDiff} | denied/unsupported_operation/revision_conflict |  |
| agent.executeCommand | command | {previewId:string,contentDigest:string,executionGrant:string} | {receiptId:string,ref:EntityRef,revision:number} | denied/preview_expired/revision_conflict/grant_required | domain-specific operation event |

Control binding: context→agent.resolveContext; preview→agent.previewCommand; toolreceipt→agent.executeCommand.

DoD: Agent allow-all cannot read/update B private Company; permitted Task update has current diff/ref/receipt; revoked source removed from context.

Negative: Seed agent direct store write bypass: denied resource must fail. Planned, not run.

## SH-08 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| session.previewExport | query | {sessionRef:EntityRef,selectedMessageIds:string[],audience:ExplicitAudience} | {projectionId:string,digest:string,redactions:Redaction[],sourcePolicyEpochs:Record<string,number>,expiresAt:Instant} | denied/source_revoked/audience_not_permitted |  |
| session.publishExport | command | {projectionId:string,digest:string,audience:ExplicitAudience,expiresAt:Instant} | {artifactRef:EntityRef,shareCapabilityRef:string,receiptId:string} | denied/preview_stale/source_revoked/digest_mismatch | session.export_published |

Control binding: audience→session.previewExport; publish→session.publishExport.

DoD: Session contains private mail tool output and public Page; external preview redacts mail body/title, publish same digest only; source revoke between preview and publish rejected.

Negative: Seed raw stored session JSON upload: secret-marker absent assertion fails. Planned, not run.

## SH-09 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| memory.getProvenance | query | {factRef:EntityRef} | {fact:AuthorizedFact,sources:AuthorizedSourceRef[],asOf:Instant} | not_found_or_denied/source_revoked |  |
| memory.correctFact | command | {factRef:EntityRef,expectedRevision:number,action:correct/retract,value?:string,reason:string} | {receiptId:string,revision:number,retractionWatermark:string} | denied/revision_conflict | memory.fact_corrected |

Control binding: source→memory.getProvenance; correction→memory.correctFact.

DoD: Correct/retract fact, reload and agent retrieval show current value or exclusion; source revoke suppresses old fact body.

Negative: Seed cache ignoring retraction watermark: obsolete marker detected. Planned, not run.

## SH-10 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| automation.dryRun | query | {ruleRef:EntityRef,eventFixture:TypedEvent,budget:RunBudget} | {executionMode:fixture,plannedCommands:CommandPreview[],externalWrites:0} | denied/invalid_fixture/budget_exceeded |  |
| automation.getRun | query | {runId:string} | {eventId:string,dedupKey:string,attempts:Attempt[],receipts:Receipt[],state:RunState} | not_found_or_denied |  |
| automation.registerTrigger | command | {ruleRef:EntityRef,eventKind:RegisteredEvent,filter:TypedEventFilter,expectedRevision:number} | {receiptId:string,revision:number} | denied/unknown_event/invalid_filter | automation.updated |
| automation.reconcileRun | command | {runId:string,expectedRevision:number} | {receiptId:string,state:reconciling/applied/failed} | denied/provider_ambiguous/budget_exceeded | automation.run_updated |

Control binding: trigger→automation.registerTrigger; action→automation.dryRun; run→automation.getRun.

DoD: Replay task.assigned event twice→one task side effect; dry run provider calls=0; loop reaches budget and halts; unknown mail send enters reconciliation not resend.

Negative: Seed dedup removal or dry-run provider call: call counter assertion fails. Planned, not run.

## SH-11 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| connection.startAuth | command | {provider:ProviderKind,requestedScopes:string[],returnRoute:TypedRoute} | {authUrl:string,stateTokenRef:string} | denied/unsupported_provider/scope_not_permitted |  |
| connection.probe | command | {connectionRef:EntityRef} | {receiptId:string,capabilities:Capability[],lastReadBackAt?:Instant,state:verified/degraded/unavailable} | denied/token_expired/adapter_unavailable |  |
| workspace.switchMode | command | {workspaceId:string,target:standalone/shared,serviceBindingRef?:EntityRef,expectedRevision:number} | {receiptId:string,writerEpoch:number,state:pending_fence/applied} | denied/service_unavailable/active_writer/revision_conflict | workspace.mode_changed |

Control binding: connect→connection.startAuth; probe→connection.probe; mode→workspace.switchMode.

DoD: Stored Calendar token with UnavailableAdapter remains unavailable; verified service switch disables old local writer before shared command accepted.

Negative: Seed token_exists→live badge or dual-writer accepts: negative test fails. Planned, not run.

## SH-12 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| file.download | query | {fileRef:EntityRef} | {proxyRoute?:string,url?:string,expiresAt:Instant,mime:string,checksum:string} | not_found_or_denied/quarantined/deleted |  |
| file.resolveAnchor | query | {fileRef:EntityRef,anchor:PageAnchor/TimeAnchor/LineAnchor} | {viewer:SafeViewerSpec,anchor:ValidatedAnchor} | denied/invalid_anchor/unsupported_type |  |
| file.beginUpload | command | {parentRef:EntityRef,sizeBytes:Integer,sha256:string,mime:string,fileName:string} | {uploadId:string,chunkPlan:Chunk[],expiresAt:Instant,receiptId:string} | denied/size_limit/unsupported_mime/source_revoked |  |
| file.uploadPart | command | {uploadId:string,partNumber:Integer,partChecksum:string,bytes:Binary} | {partReceiptId:string,checksum:string} | denied/upload_expired/checksum_mismatch |  |
| file.finalizeUpload | command | {uploadId:string,partReceipts:string[],sha256:string} | {fileRef:EntityRef,state:quarantined/ready,receiptId:string,revision:number} | denied/upload_expired/checksum_mismatch/missing_part/source_revoked | file.created |

Control binding: upload→file.beginUpload; download→file.download; anchor→file.resolveAnchor.

DoD: Interrupt upload after part2, restart and resume same uploadId, finalize produces checksum-matched one File; hostile MIME quarantined; wrong checksum never ready; expired download after revoke denied.

Negative: Seed skip-finalize checksum or preview before quarantine: bytes/state assertion fails. Planned, not run.

## SH-13 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| sheet.previewImport | query | {pageRef:EntityRef,range:CellRange,csv:BoundedText} | {previewId:string,digest:string,rows:Integer,columns:Integer,diff:SafeSheetDiff} | denied/size_limit/csv_invalid |  |
| sheet.setCell | command | {pageRef:EntityRef,address:CellAddress,value:TypedCellValue,expectedRevision:number} | {receiptId:string,revision:number,computed:CellResult} | denied/revision_conflict/formula_invalid/formula_budget | document.changed |
| sheet.commitImport | command | {pageRef:EntityRef,previewId:string,digest:string,expectedRevision:number} | {receiptId:string,revision:number} | denied/preview_stale/revision_conflict | document.changed |

Control binding: cell→sheet.setCell; range→sheet.previewImport.

DoD: Set A1=2,A2=3,A3=SUM(A1:A2)→5 after reload; formula cycle bounded error; import is preview only before commit.

Negative: Seed executable JS formula evaluation or stale preview import accepted: rejects malicious formula/CAS test. Planned, not run.

## SH-14 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| canvas.patchRevision | command | {pageRef:EntityRef,expectedRevision:number,file:ValidatedCanvasFile} | {receiptId:string,revision:number} | denied/revision_conflict/schema_invalid/size_limit | document.changed |
| canvas.linkEntity | command | {pageRef:EntityRef,targetRef:EntityRef,geometry:CanvasRect,expectedRevision:number} | {nodeId:string,receiptId:string,revision:number} | denied/target_denied/revision_conflict | entity.linked |

Control binding: node→canvas.patchRevision; entitynode→canvas.linkEntity.

DoD: A/B patch same base revision; one CAS applies, other conflict preserves draft; reload same canonical whole-file bytes.

Negative: Seed last-write-wins CAS removal: one conflict assertion fails. Planned, not run.

## SH-15 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| skill.previewInstall | query | {origin:string,version:string,digest:string,capabilities:string[]} | {previewId:string,sourceLicense:string,capabilityDiff:string[]} | origin_untrusted/license_review_required/digest_mismatch |  |
| coding.reviewPatch | query | {repository:string,baseSha:string,patchDigest:string,testReceiptRefs:string[]} | {diff:ParsedDiff,ownershipConflicts:string[],reviewState:string} | invalid_patch/base_stale/receipt_missing |  |
| coding.applyPatch | command | {previewId:string,baseSha:string,patchDigest:string,ownedPaths:string[]} | {commitSha:string,branch:string,receiptId:string} | base_stale/dirty_checkout/unowned_path/license_review_required |  |

Control binding: skill→skill.previewInstall; patch→coding.reviewPatch; apply→coding.applyPatch.

DoD: Patch baseSha mismatch or changed unowned registry rejected; approved digest creates isolated branch commit, no merge; skill permissions upgrade explicit.

Negative: Seed trust-by-name or arbitrary diff applied: origin/owned path test fails. Planned, not run.

## SH-16 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| sync.getState | query | {ref:EntityRef} | {durableFrontier:string,pendingCommandIds:string[],policyEpoch:number,leaseExpiresAt:Instant,status:Rox2Status} | denied/state_unavailable |  |
| device.getCapability | client-query | {feature:DeviceFeature} | {supported:boolean,permission:granted/denied/unknown,reason?:string} | device_unavailable |  |

Control binding: sync→sync.getState; capability→device.getCapability.

DoD: Offline command stays local queued/unverified until durableACK; after revoke reconnect rejects replay; narrow view same ref/draft.

Negative: Seed show-green-on-socket-connect or omit policy epoch: status/replay test fails. Planned, not run.

## SH-17 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| coding.preparePacket | client-query | {wpId:string,inputSha:string,specDigest:string,prerequisiteReceipts:Receipt[]} | {packetDigest:string,ready:boolean,conflicts:string[],requiredLanes:Lane[]} | spec_stale/dependency_missing/base_stale/ownership_conflict |  |
| coding.verifyResults | query | {runId:string,manifestDigest:string,commitSha:string} | {verifiedLanes:Lane[],pendingLanes:Lane[],artifactHashes:Record<string,string>,reviewState:string} | artifact_mismatch/test_failed/provider_not_verified |  |

Control binding: packet→coding.preparePacket; results→coding.verifyResults.

DoD: Done cloud run with only research artifact and no checkout/diff/required test receipts remains unverified; roots only initially ready.

Negative: Seed done⇒feature complete: required-lane gate fails. Planned, not run.

## SH-18 — Typed API and exact acceptance supplement

| Canonical operation | Kind | Input | Result | Errors | Events |
|---|---|---|---|---|---|
| reminder.get | query | {ref:EntityRef} | {ref:EntityRef,sourceRef?:EntityRef,nextAt:Instant,timeZone:string,status:ReminderStatus,revision:number} | not_found_or_denied |  |
| entity.resolve | query | {ref:EntityRef,fields:string[]} | {ref:EntityRef,projection:AuthorizedProjection,revision:number} | not_found_or_denied |  |
| reminder.snooze | command | {ref:EntityRef,until:Instant,timeZone:string,expectedRevision:number} | {receiptId:string,revision:number,nextAt:Instant} | denied/invalid_until/revision_conflict | reminder.updated |

Control binding: open→reminder.get; snooze→reminder.snooze; source→entity.resolve.

DoD: ReminderA opened from Task and Inbox resolves same ref; navigate A→B/reload shows B data and pending state; denied source has no private title; snooze preserves rule.

Negative: Seed fixed component params stale after routeA→B or automatic source redirect: identity/route assertion fails. Planned, not run.
