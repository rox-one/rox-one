# RS-WIKI-01 — Rox Wiki: spaces, hierarchy, access и history над общими Docs

Wiki — ordered hierarchy/context representation над canonical Docs, не второй document editor/store. WikiSpace и WikiNode membership связывают существующие Page/Note refs. Drive/Wiki/Project/pins открывают одну entity.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [apps/electron/src/renderer/pages/NotesPage.tsx::TiptapMarkdownEditor / onWikiLinkClick](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/NotesPage.tsx#L2292-L2308) — Markdown body/wiki callbacks/comments существуют; это не Wiki spaces.
- [packages/core/src/types/page.ts::PageConfig](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/types/page.ts#L294-L320) — Stable id/slug/projectId, runtime kind, digest-bound grants/refresh/share существуют.
- [apps/electron/src/renderer/components/pages/PagesHome.tsx::PagesHome/visiblePages/openPage/handleCreatePage](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PagesHome.tsx#L25-L105) — Pages grid фильтрует Project ID, сортирует updatedAt, создаёт interactive artifact.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [apps/electron/src/renderer/contexts/NavigationContext.tsx::navigate / newPanel](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/contexts/NavigationContext.tsx#L838-L883) — Существующий router и focused panels — точка расширения.

Референс5 показывает Wiki/PinnedWiki/tree/Location patterns. Separate Wiki body, permissions inheritance и server history на screenshot не установлены.

## Экран, navigation и размеры

Docs rail220 with Wiki; tree240, breadcrumb40, header48, shared Docs body70–88ch/TOC optional. Tree row28/hitbox32/44, indent16 bounded; separate disclosure/open. <960 overlay tree/<720 drilldown Back. Proposed typed space/node route requires registry/parser/migration; current wiki-link callback не backend Wiki. Hidden ancestors/paths не раскрываются.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| space · «Пространство» | SpaceRef/membership/cursor → permitted roots | Owner/scope/direct/inherited policy help | Select restores tree; denied ≠ empty |
| node · «Открыть страницу» | NodeId→targetRef → same Doc/Note | Alias vs Doc title distinction; safepeek | Arrow tree/HomeEnd/Enter; Escape focus return |
| create/link · «Создать / Добавить существующую» | space/parent/existingref or Docdraft → node+Doc receipt | New object vs reference; no implied access | Reviewed picker; idempotent create; private target remains restricted |
| move · «Переместить раздел» | node/newparent/order/treeRev → CAS receipt | Affected subtree/audience impact/source revision | Drag + keyboard Move; cycle/self-parent denied; conflict oldtree retained |
| access · «Доступ пространства» | grants/inheritance/epoch → effectivepolicy/fence | Direct vs inherited/exception explanation | Impact review; current ACL; no private leaf auto-grant |
| history · «Структура / Страница» | treeRev vs bodyRev → separate audits | Tree move ≠ content edit | Readonly compare; tree restore newrevision, no body/ACL rollback |
| pin/search · «Закрепить / Искать» | personalpin or scoped query → refs/asOf | Pin link notcopy; permitted counts | Rollback favoriteerror; same canonical Docroute |

## Domain / API / storage / realtime / events / ACL

Space aggregate common container registry; Node{id,space,parent,order,targetRef,displayAlias?} no body. Ordered tree CAS with cycle/depth/parentvisibility checks; no unproven CRDT-tree. Register container identity/schema before UI, common Doc writer reused. Target wiki.createSpace/linkNode/moveNode/archiveNode/readTree/history/search compiled through common gateway. SQL tree/metadata/membership/index+outbox; same Page CRDT body. Central PermissionGrant inheritance resolver plus direct constraints; moving private branch to shared needs current audience impact review, may retain neutral restricted leaves. Events tree/link/policy feed common authorised search/mentions/activity/notifications/agent; notify subscriptions/share/mentions only. Agent bounded permitted tree, stale move denied. Archive node never silently deletes underlying Doc.

## Точные изменения файлов

- Proposed components/wiki/{WikiSpaceView,WikiTree,WikiMoveReview}.tsx; Drive rail owner RS-DRV-01, editor owner RS-DOC-01.
- Extend existing router/registry/graph/permissions; workspace-domain/wiki metadata contracts, no WikiBody service.
- Versioned space/node alias migration; unknown legacy links unresolved, not name merge.
- Proposed wiki-tree-cycle/CAS/visibility/history/access UI tests.

## Пользовательский flow

Create Space → new Doc → link existing Doc → move subtree reviewed → reader same Doc in Drive → revoke hides permitted branch → tree history readonly leaves Doc history unchanged.

## Tests / Definition of Done

- [ ] One underlying DocRef/body in Wiki/Drive/Project/pins after reload.
- [ ] Cycles/selfmove/race denied; CAS conflict focus, no orphan subtree.
- [ ] Private-to-shared branch cannot leak titles/breadcrumbs/facets; policy review required.
- [ ] Archive node doesn't delete Doc; restore tree doesn't restore body/ACL.
- [ ] Keyboard tree aria-level/posinset/expanded states; selected page/expansion restored.
- [ ] Agent context bounded/permitted; seed duplicate Wiki body/cycle bypass caught.

## Dependencies / related / complexity

Draft dependencies: RS-DRV-01, RS-DOC-01.

- [#563](https://github.com/rox-one/rox-one/issues/563) — [[wiki links]] Notes сохраняются, но не равны WikiSpace.
- [#570](https://github.com/rox-one/rox-one/issues/570) — Wiki page открывает same Page Docs/grants, не копирует body.

Complexity: XL: new hierarchy metadata, inherited policy and migrations; shared Docs reuse limits editor cost.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.


## GitHub dependency links (нормативный handoff)

- Требуется [RS-DRV-01 — #1109](https://github.com/rox-one/rox-one/issues/1109)
- Требуется [RS-DOC-01 — #1110](https://github.com/rox-one/rox-one/issues/1110)
- Связанный ранее созданный issue: [#563](https://github.com/rox-one/rox-one/issues/563)
- Связанный ранее созданный issue: [#570](https://github.com/rox-one/rox-one/issues/570)

Specification ID: RS-WIKI-01. Снимок исходного ROX: 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Эти ссылки задают зависимости, а не статус выполненной реализации.
