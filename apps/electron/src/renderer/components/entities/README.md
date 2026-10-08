# Entity UI (W1-08, #1505)

Entity-aware components built on the `#1499` contracts (`@rox/core/entities`:
`EntityRef`, `parseEntityRef`, `formatEntityRef`, `kindDescriptor`,
`applyPreviewRedaction`, `entityRoute`, …). This is not a second
orchestrator, rail, palette or editor: navigation uses the existing
`navigate()` event, and mentions plug into the existing `TiptapMarkdownEditor`.

## Gating

`entities.previews.v1` is registered in `@rox/core/platform` with default OFF
and depends on `entities.links.v1`. `flags.ts` resolves both through
`isWorkbenchFlagEnabled`, using #1499's renderer atom for links
(`craft-feature-entities-links-v1`) and `craft-feature-entities-previews-v1`.

Settings → Appearance → Workbench has a toggle for each, previews right under
links (`EntitiesPreviewsSettingsToggle`, same `atomWithStorage` persistence).
While links is off the previews switch is disabled, shown off, and its
description says to turn links on first.

When the flag is off:
- no preview or backlink request is made;
- no hover card can open;
- Notes loads no entity nodes, so `[[kind:id|label]]` stays plain text;
- the Tasks Links tab shows nothing new.

## Components

| Component | Notes |
|---|---|
| `EntityChip` | Inline ref with icon + title. A restricted ref shows a lock and «Нет доступа» (never the title or the stored label); a tombstone shows «Удалено» struck through; an unavailable ref shows a warning icon. The hover card opens after 300 ms (flag on only). The chip is a drag source and has the common row context menu. |
| `EntityHoverCard` | 360 px preview: kind, title, badges, up to 4 fields, progress, people, updated, plus Open / Copy link. |
| `EntityCard` | Preview-driven block card; also the node view for `![[kind:id]]` embeds. |
| `EntityPicker` / `EntityPickerPanel` | «Связать элемент Rox…», 560 px: search, kind filter chips, Recent / Results groups, ↑↓ / Enter / Esc. A typed `kind:id` is offered as a literal row unless its literal cannot be written inside `[[…]]` (`\|`, `]`, `[[`, line breaks). `accept(ref)` lets the caller hide refs it cannot link (Notes does). |
| `BacklinksPanel` / `BacklinksList` | «Упоминается в»: backlinks grouped Tasks / Docs / Projects / Goals / Meetings / Chats / Other, one row per source, relation labels, "show all", retry on error. |
| `EntityRowContextMenu` | Open, Open in new tab, Copy link, then `getEntityRowActions(ref)`. |
| `useNoteEntityMentions` | Notes integration: `entityNodes` + picker (Mod-Shift-K inserts a mention). |
| `TaskEntityBacklinks` | Tasks integration: the backlinks panel in the TaskDetail Links tab. |

## Contracts for later waves

- **Row actions:** `getEntityRowActions(ref)` returns `{ id, labelKey, run, disabled }[]`. The defaults `ask-rox` («Спросить @rox»), `pin` («Закрепить») and `remind` («Напомнить…») stay disabled and inert until `registerEntityRowActionHandler(id, { run, isAvailable? })` is called. Custom ids need a `labelKey`.
- **Drag (X-13):** `application/x-rox-entity-ref` carries JSON `{ ref: formatEntityRef(ref), label }`. Use `setEntityDragData` / `readEntityDragData` (the latter returns null for anything invalid). Wave 1 registers no drop targets.
- **Per-kind renderers:** `registerPreview(kind, { ChipLabel?, HoverCardBody?, CardBody? })`. Restricted previews never reach custom renderers.
- **Data:** every read goes through `entity-data-source.ts`. The default implementation calls the `entities:resolve` / `entities:links` bridge methods (`window.electronAPI.entitiesResolve` / `entitiesLinks`). Search is `STUB(#1504)` and returns `[]` until W1-07 calls `setEntityDataSource(...)`.
- **Markdown:** mention ⇄ `[[kind:id|label]]`, embed ⇄ `![[kind:id]]` (see `@rox/ui` `EntityMention` / `EntityEmbed`). Both round-trip through `server-core/src/entities/extract.ts`.

## Preview freshness

`use-entity-preview.ts` keeps one cache per workspace:
- requests made in one tick are batched into one `entities:resolve` call;
- a ready preview older than 60 s (`ENTITY_PREVIEW_TTL_MS`) is refetched in the background on the next mount (`retain`) or hover-card open, and the old value stays visible until the new one arrives (stale-while-revalidate). A deleted entity then shows its tombstone;
- `entities:linksChanged` refetches every mounted preview;
- the existing `notes:changed` (note id) and `personalTasks:changed` broadcasts refetch the mounted note / task previews they concern (`EntityDataSource.onEntitiesChanged`);
- a failed resolve shows the `unavailable` placeholder and retries after 15 s, doubling per consecutive failure up to 5 min. Success or `linksChanged` resets the backoff.

## Stubs

- `entity-data-source.ts`, `STUB(#1504)`: no search provider yet.

## Known limitations (UNDONE)

- **Tasks «Упоминается в» stays empty for now.** Nothing indexes note mentions yet: the save-time indexer (Markdown → `extract.ts` → link store, behind `entities.links.v1`) belongs to the #1499 package, not this one. Until it lands, the panel shows its empty state («Пока нигде не упоминается») from the real `entities:links` call; it never shows fixture or invented rows. Backlinks appear as soon as links are written (today only through the explicit `entities:links add` RPC). QA should not file the empty panel as a bug.
- The server resolver host keeps its own LRU; a renderer revalidation can return that cached preview until the owning module invalidates it on the server.
- `[[` / `@` suggestion menu (UI-SPEC MentionMenu) is a later package; typed or pasted explicit syntax converts, and Mod-Shift-K opens the picker.
- An `![[kind:id]]` line inside a list item or blockquote stays text, not an embed card. The legacy (tiptap-markdown) editor escapes it on save as `!\[\[…\]\]`, exactly as with the flag off (same as main).
