# RS-NOTE-01 — Notes ↔ Drive: personal Markdown и явная миграция в shared Docs

Сохранить existing Notes и native Markdown vault; Drive показывает typed projection. Personal Note не становится shared автоматически. «Сделать совместной» — explicit identity/privacy/authority conversion с одним writer, stable aliases и source/assets review.

## Current source evidence

Repository rox-one/rox-one; source SHA 249b3b44220bcfbd7d467de9cfc18f76e1c37807. Код — source of truth; screenshot не доказывает backend/API.

- [apps/electron/src/renderer/pages/NotesPage.tsx::saveCurrentNote](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/NotesPage.tsx#L871-L905) — Save queue одного renderer; вызов saveNote без expectedRevision.
- [packages/server-core/src/handlers/rpc/notes.ts::saveNote](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/server-core/src/handlers/rpc/notes.ts#L502-L517) — Optional read-check-write без lock/atomic CAS — не доказательство защиты от multi-writer conflict.
- [apps/electron/src/renderer/pages/NotesPage.tsx::TiptapMarkdownEditor / onWikiLinkClick](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/pages/NotesPage.tsx#L2292-L2308) — Markdown body/wiki callbacks/comments существуют; это не Wiki spaces.
- [packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx::TiptapMarkdownEditorProps / TiptapMarkdownEditor](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx#L202-L265) — React Tiptap content/onUpdate/editable/markdownEngine — кандидат binding, не готовый CRDT editor.
- [packages/core/src/rox2/platform-contract.ts::Rox2EntityRef / formatRox2EntityId](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/packages/core/src/rox2/platform-contract.ts#L218-L240) — workspaceId/entityId/revisionId/accountNamespace сохраняются как общая identity.
- [apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx::SessionFilesSection](https://github.com/rox-one/rox-one/blob/249b3b44220bcfbd7d467de9cfc18f76e1c37807/apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx#L423-L459) — Session folder tree/expanded state; workspace Drive ACL/index не установлены.

Референс 5 задаёт структуру library/pinned для поиска документов; семантика существующих Notes проверена по текущему коду ROX. Приватные содержимое и пути screenshot не переносятся.

## Экран, navigation и размеры

Existing notes/note/{encodednativeNoteId}, body70ch/Tiptap/NoteInspector/comments/TOC retained. Header48 authoritybadge «На устройстве / Совместная», «Показать в Drive»; inspector320 collapsible. Conversiondialog520–640/max90vw with content/hash/aliases/workspace/audience/assets; conflict compare650 or stackedmobile. No second Note editor/framework.

## Controls и interactions

| Control / RU label | Input → Output | Hover / focus / help | Click / keyboard / failure |
|---|---|---|---|
| save · «Сохранение» | native ID/expectedRevision/body → atomicwriter receipt | File hash/mtime/device source; not servergreen | Autosave queue ≠ multiwriter CAS; current optional oldwrite upgraded |
| drive · «Показать в Drive» | NoteRef/local scopedalias → same library selection | Link/projection, not upload or grant | Open personalview; sharedunavailable reason; mode unchanged |
| convert · «Сделать совместной» | ref/revision/workspace/audience/digest → migration receipt | Who sees exact content/metadata/privateassets | Cancel no mutation; confirm cutover/readback; pending≠shared |
| assets · «Вложения и ссылки» | FileRefs/wiki targets/currentACL → safe embed review | Private image/source needs own grant; no hidden title | Exclude/approved copy/grant explicit; plainlink never access |
| conflict · «Сравнить изменения» | diskcurrent/localdraft/baseRev → compare/rebaseddraft | Source clock/versions/Markdown meaning | Keepfile/copypermitteddraft/manual merge newrev; no silent overwrite |
| rename/move · «Переименовать / Переместить» | sameRef/pathalias/title/impact → file/alias receipt | Affected wiki/backlinks; path notidentity | Impact confirmation; same-title note notmerged |
| import/export · «Markdown» | bytes/aliases/assets/digest → perfile receipts | Frontmatter/wiki/comments/footnotes provenance | Collision preview; allowed exportrevision; failed files distinct |
| agent · «Попросить агента» | permitted NoteRef/mode/revision → separate Session proposal | Source provenance/currentACL, not whole vault | Typed preview write via authority router; raw shared file bypass denied |

## Domain / API / storage / realtime / events / ACL

Current Notes UI omits expectedRevision and server ordinary optional read-check-write lackslock. Target native per-note atomicwriter and requiredexpectedRevision; standalone behavior remains. Same-workspace adoption preserves NoteRef and native aliases; cross-workspace transfer explicit mapping/new scoped ref. Shared CRDT body is server authority; Markdown file materialized projection/exportasset, watcher not second writable master. note.update/adoptShared/rename/move/import/export schemas and aliases compile before dispatch. Migration inventory/hash/backup/collision/privacy review/idempotent receipt+rollback mapping; private attachment/source ACL independent. Search/memory/mentions/agents Note extractor respects personal scope until explicit sharedadoption. Events authority/content/alias changes commonoutbox; notifications share/comments/mentions, not autosaveheartbeat. Offline durable journal/docWAL not disposable appcache; currentpolicy replay and writer fencing.

## Точные изменения файлов

- Extend NotesPage/saveCurrentNote and existing NoteInspector/NotesViewHost/wiki/rename/import flows; preserve mounted editor/sheets focus.
- Extend packages/server-core/src/handlers/rpc/notes.ts via atomic CAS/authority router; renderer-only optimistic patch insufficient.
- Proposed components/notes/{NoteAuthorityDialog,NoteConflictReview}.tsx; reuse identity/notes/collaboration/File ports, no second editor.
- Existing Markdown/rename/wiki tests + nativeconflict/sharedcutover/watcher/recovery and NotesDrive UI tests.

## Пользовательский flow

Native Note edit→device save→Drive same Note→external edit conflict compare→shared preview excludes private asset→onewriter cutover→B sharededit→legacywrite denied→restart body/aliases/readback correct.

## Tests / Definition of Done

- [ ] Existing create/move/rename/delete/import/export/frontmatter/wiki/footnotes/comments/tasks roundtrip retained.
- [ ] Concurrent native external writer preserves newer disk bytes; seeded read-check-write CAS omission caught.
- [ ] Drive personal Note neither uploads nor shares; stable ref after path rename/reload.
- [ ] Crash before/after sharedcutover one writer; oldsave/rawagentwrite rejects shared ID.
- [ ] Shared Note with private image/wiki/mail source no body/URL leak; revoke purges context.
- [ ] Projection watcher no write loop; cacheupgrade never clears docWAL; incompatible schema hold notwipe.
- [ ] Native #563 IME/focus/zoom/sheets and #570 Page regressions proof separate fixtures.
- [ ] Seed dualwriter/autoembedshare/namealias each caught identity/policy/hash assertions.

## Dependencies / related / complexity

Draft dependencies: RS-DRV-01, RS-DOC-01.

- [#563](https://github.com/rox-one/rox-one/issues/563) — Продолжить existing Notes document/rails/comments/wiki/properties; реальный native conflict/IME acceptance остаётся отдельным gate.
- [#570](https://github.com/rox-one/rox-one/issues/570) — Page artifacts/Docs/Note assets сохраняют distinct type/grants.

Complexity: XL: native preservation, atomic CAS and authority migration; greatest risks draft loss/dualwrite/private export. Personal Drive projection first, shared cutover later.

## Общие quality gates

Draft specification; implementation/runtime **NOT_RUN**. Geometry — proposed ROX layout, не pixel measurements screenshot. RU i18n labels; current semantic fonts/theme/accent; light fixture + dark regression. Hitbox≥32px desktop/44px touch; visible focus, reduced-motion, readable contrast, Escape focus return. Tooltip и help доступны hover/focus/click; каждый metric объясняет definition/source/freshness/example. Hover не выполняет send/share/read mutation.

Feature включает model, persistence, commands/queries, permissions, realtime где нужно, search, mentions, attention/activity, agent tools, failures и observable receipt. Actor поступает из authenticated transport. Local saved/queued/committed/provider-confirmed различаются. Cached private preview после revoke очищается по policy; нельзя обещать физическое стирание disconnected device.

Acceptance evidence: exact commit/inputSha, domain receipt/ref/revision/hash, reload/concurrency/negative assertions, screenshots/ARIA/computed font/viewport/locale. Linux fixture UI, live service, Electron native и provider read-back — отдельные gates. Seeded assertion failure должен быть пойман; timeout/infra error не считается sensitivity. Literal Macro/Lark code/assets и приватные screenshot names/IDs/images не копировать.
