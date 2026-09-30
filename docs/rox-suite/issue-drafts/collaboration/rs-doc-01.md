# RS-DOC-01 — Rox Docs: collaborative editor, comments, entity mentions и export

Добавить collaborative_document representation в существующий Page/library. One React editor→CRDT binding выбирается conformance spike; не переносить Solid UI и не держать два production writers. Existing HTML Page не становится document by rename.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [packages/core/src/types/page.ts::PageConfig](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/types/page.ts#L294-L320) — Stable id/slug/projectId, runtime kind, digest-bound grants/refresh/share существуют.
- [apps/electron/src/renderer/components/pages/PageView.tsx::PageView/PageFrame](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/pages/PageView.tsx#L386-L439) — Сохраняется artifact runtime с lease/snapshot/error states.
- [apps/electron/src/renderer/pages/NotesPage.tsx::TiptapMarkdownEditor / onWikiLinkClick](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/NotesPage.tsx#L2292-L2308) — Markdown body/wiki callbacks/comments существуют; это не Wiki spaces.
- [packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx::TiptapMarkdownEditorProps / TiptapMarkdownEditor](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L202-L265) — React Tiptap content/onUpdate/editable/markdownEngine — кандидат binding, не готовый CRDT editor.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [packages/core/src/rox2/platform-contract.ts::ROX2_ENTITY_KINDS](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L17-L40) — note/page/channel/channel-message/person — существующие kinds, не доказательство backend полноты.

Референс5 задаёт library entry/lifecycle CreateDoc; editor internals не доказаны screenshot. Existing ROX React editor evidence guides target binding.

## Экран, navigation и размеры

Header48 title/project/sync/avatars/Share, formatbar36, body70–88ch(min320), TOC180–220 collapsible, comments inspector320. Narrow hides rails before text, focused selection remains. Existing pages/page/{slug} stable alias; proposed history/discussion queries typed. Title metadata CAS separate body CRDT. Type labels «Документ / Страница-приложение» visible.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| body · «Содержимое» | CRDT schema/ops/frontier → local durable then serverACK | Durability/presence freshness; caret no aria spam | Typing/IME/paste/blocks/table/code/embed; ownUndo does not undo remote actor |
| title · «Название» | title/expectedMetadataRev → rename receipt | Metadata revision differs frontier | Explicit apply; offline concurrent rename conflict compare |
| presence · «Участники» | principal/device awareness → avatar/caret/selection | Activity/TTL, no hidden private contact fields | Hover/focus card/help; expiry removes stale cursor |
| mention · «Упомянуть» | permitted ref/query/source → entity chip/link/notification | Mention not sharing; revision/source/ACL example | @ picker Enter selects not sends; grant separate |
| comment · «Обсудить выделение» | PageRef/anchor/sourceRevision/body → shared MessageRef | Anchor drift/history help | CmdEnter-send/Enter-newline; one message.create; resolve not source deletion |
| history · «История / Восстановить» | allowed bodyRevision/current → compare/new restoreRevision | Author/time/frontier; ACL not restored | Version selection readonly; restore confirmation/newrevision |
| export · «Экспорт» | ref/revision/format/audience → bounded artifact receipt | Markdown/PDF initial; DOCX only verified capability | Source/export/attachment policy; no automatic public link |
| sync/share · «Синхронизация / Доступ» | epoch/pending ops/grants → status/fenced revoke | Local≠server saved; ACK/readback freshness | Offline WAL/reconnect; revoke open editor denial/purge; app cache not WAL |

## Domain / API / storage / realtime / events / ACL

Versioned Page contentKind html_app|collaborative_document; runtime PageKind/CSP remains existing separate property. Editor-neutral schema, CRDT local WAL/snapshot, serverappend under current ACL/document lock with ACK after durable commit; relational metadata/grants/status not CRDT. Reconnect anti-entropy/opId dedup/multi-device peers, awareness lossy expiry. Commands page.create/rename, collaboration.append, document.restore, common message.create anchored parent and permission grant/revoke. SQL entity+body WAL/snapshot/materialized search watermark, not parallel Markdown master. Common events/mentions/discussions feed search/notifications/activity/agent/memory. ACL through ws/API/tools/download/export; agent typed preview-before-write and current revision, not raw legacy file writes. Literal Macro code/license source requires separate clearance; behavior implementation default.

## Точные изменения файлов

- Extend PageConfig/PageView/PagesHome and common platform contract; preserve PageFrame sandbox.
- Use allocated components/pages/CollaborativeDocumentEditor.tsx and workspace-domain/collaboration/contracts.ts.
- Common EntityDiscussion from RS-MSG-02; no separate DocumentComments engine.
- Proposed doc-editor-conformance/concurrency/offline/revoke/export tests plus existing Notes/artifact regressions.

## Пользовательский flow

Drive create Doc → A/B same Page → concurrent text → anchored mention discussion → one notice → B offline edit → reconnect → history/citedsource → approved export with checksum/readback.

## Tests / Definition of Done

- [ ] Two-user convergence/hash/frontier/caret; localUndo preserves B insert.
- [ ] Crash/upgrade between localcheckpoint and ACK retains exact IDs/WAL; no duplicate or lost acknowledged edits.
- [ ] Revoke open WS/API/agent/legacy writer fails after fence; disconnected erase not claimed.
- [ ] Anchors drift fallback/current ACL; mentions notify once, never grant.
- [ ] IME/loading/empty/offline/queued/rejected/conflict/narrow native states verified.
- [ ] Restore creates new revision, does not revert ACL; export actual allowed artifact.
- [ ] Seed ACK-before-persist, raw shared file writer, private embed bypass caught; #563/#570 regressions.

## Dependencies / related / complexity

Draft dependencies: RS-DRV-01, RS-MSG-02.

- [#563](https://github.com/rox-one/rox-one/issues/563) — React Markdown roundtrip/rails/comments/editor mount сохраняются.
- [#570](https://github.com/rox-one/rox-one/issues/570) — HTML Page artifact renderer/grants остаётся separate contentKind.
- [#562](https://github.com/rox-one/rox-one/issues/562) — Agent side session/approval остаётся отдельным от human discussions.

Complexity: XL: CRDT/editor binding/offline/fence highest correctness risk; first vertical DoD two users one Page.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.
