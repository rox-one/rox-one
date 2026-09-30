# RS-MSG-01 — Messenger: трёхпанельная human collaboration surface в ROX

Создать Messenger representation человеческих разговоров по референсу2: global navigation/search → Chats list → conversation и contextual action rail. Один human entry открывает те же ChannelRefs, что Project→Channels; Sessions остаются агентскими. New Messenger registry slot — explicit suite proposal, совместное изменение с центральным navigation owner; это не второй Channels service.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [apps/electron/src/renderer/components/app-shell/nav-destinations.ts::APP_NAV_DESTINATIONS](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/app-shell/nav-destinations.ts#L87-L181) — Sessions, Projects, Pages, Tasks, Notes существуют. Новые suite destinations пока target.
- [apps/electron/src/shared/routes.ts::routes.view / buildNotesRoute](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/shared/routes.ts#L170-L224) — Typed routes Tasks/Projects/Pages/Notes существуют; новые subviews требуют parser/builder/tests.
- [apps/electron/src/renderer/contexts/NavigationContext.tsx::navigate / newPanel](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/contexts/NavigationContext.tsx#L838-L883) — Существующий router и focused panels — точка расширения.
- [apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx::ModeScreenLayout](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx#L12-L53) — Navigator220/list440/detailmin320 и semantic font-sans уже есть; размеры будущих screens ниже — proposal.
- [apps/electron/src/renderer/pages/ChatPage.tsx::ChatPage/useSessionData](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/ChatPage.tsx#L89-L172) — Chat привязан к Agent Session ID; не human Message domain.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [packages/ui/src/styles/index.css::font-ui-narrow/font-sans/font-mono/font-chat](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/ui/src/styles/index.css#L121-L129) — Наследовать selected semantic fonts/theme, не навязывать второй global font.

Референс2 визуально просмотрен: nav/search, Chats avatars/unread/name/snippet/date, selected tint, conversation header/member count, All/Subscribed, right tools, bottom composer. Private names/IDs/images не переносятся.

## Экран, navigation и размеры

Desktop1440×900: существующий global shell; inner navigator220px, Chats320–400px(min240), conversation flexible(min400), tools40px. Header48px, rows56–64px, composer88px/max30%viewport. Pane ratios сохраняются per device. <960 detail скрывает list/nav; <720 single pane, Back восстанавливает selected row/scroll. Proposed typed messenger/conversation/{encodedCanonicalId} требует builder/parser/MainContentPanel/history gates; существующие Sessions/Projects пути остаются. Contacts — contextual subview, а не новый user store.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| search · «Найти разговор» | query≤2048/workspace/scope/cursor → authorized ChannelRefs | Scope/asOf/readable example; no hidden totals | / outside editor; CmdK global; debounce250ms/cancel stale query; error ≠ empty |
| row · «Открыть разговор» | ChannelRef/unreadCursor/latestAllowedSnippet → same selection | Avatar/name/date/snippet; focus reveals overflow без shift | Arrows/Enter; hover не marks read; reload restores canonical ref |
| tabs · «Все / Подписанные» | personal attention filter → permitted rows | Подписка не grant membership; source/watermark help | Tablist arrows/Enter; filtered-empty reset |
| rail · «Поиск / Задачи / Закреплённое / Настройки» | currentChannelRef/capabilities → drawer | Icon labels and authorized peek; focus same help | Enter drawer/Escape return; unavailable reason |
| new · «Новый разговор» | PrincipalRefs or channel draft → reviewed ensure/create receipt | DM/group/channel distinction; never AgentSession | N outside input; title validation; stable commandId |
| back · «Назад» | route/filter/scroll/panel state → previous view | Permitted prior label only | AltLeft outside editor; overlay Escape first; draft retained under policy |

## Domain / API / storage / realtime / events / ACL

Queries target channel.list/read, entity.resolve, attention counts under common gateway. Conversation index fields: ref/type/title/avatar/latest permitted snippet/time/read cursor/watermark. View/pane preferences per actor/workspace/device; membership and read state server-authoritative. No UI localStorage second master. RS-MSG-02 owns Message writes. Lossy presence/typing expire separately from durable unread. Search/activity/notification queries filter ACL at delivery. Agent read/search tools use same gateway; composer is human. Registry discrimination ChannelRef vs AgentSessionRef compiled before routing.

## Точные изменения файлов

- Extend existing nav-destinations.ts, shared/routes.ts and route-parser.ts, NavigationContext.tsx, MainContentPanel.tsx under serialized shell owner.
- New proposed components/messenger/{MessengerSurface,ConversationList,ConversationTools}.tsx reuse ModeScreen kit and allocated MessageTimeline/Composer.
- Reuse platform-contract.ts and workspace-domain/messaging contracts, not second SessionStore.
- Proposed tests/rox-suite/messenger-navigation.spec.ts.

## Пользовательский flow

Open Messenger → search channel → inspect pinned drawer → Escape restores trigger → open same Channel from Project → no duplicate identity → return Sessions with existing agent transcript intact.

## Tests / Definition of Done

- [ ] Sessions→Messenger→ProjectChannel→Search has one ChannelRef, creates no agent session.
- [ ] Reload restores conversation/thread/filter/scroll/pane sizes; narrow390 and200% zoom focus usable.
- [ ] Distinct loading/trueempty/filteredempty/serviceerror/denied cached selection.
- [ ] Revoke removes channel/snippet/facets, direct route denied.
- [ ] Native route and #562 agent stream/tool/approval regression verified separately.
- [ ] Seed row selection creating Channel copy caught by canonical identity count.

## Dependencies / related / complexity

Draft dependencies: нет среди этих семи; common identity/ACL/command authority — обязательный foundation gate.

- [#562](https://github.com/rox-one/rox-one/issues/562) — Сохранить agent chat/approvals/IME; Sessions не становятся human Messenger.
- [#380](https://github.com/rox-one/rox-one/issues/380) — Внешние Mail/Channels adapters подключаются через подтверждённые capabilities.

Complexity: L: routing/selection/recovery across existing shell; messaging mechanism dependent. Risks duplicate state and deep-link disagreement.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.
