# Entity UI (W1-08, #1505)

Entity-aware components built on the `#1499` contracts (`@rox/core/entities`:
`EntityRef`, `parseEntityRef`, `formatEntityRef`, `kindDescriptor`,
`applyPreviewRedaction`, `entityRoute`, …). This is not a second
orchestrator, rail, palette or editor: navigation uses the existing
`navigate()` event, and mentions plug into the existing `TiptapMarkdownEditor`.

## Gating

`entities.previews.v1` is registered in `@rox/core/platform` with default OFF
and depends on `entities.links.v1`. `flags.ts` resolves both through
`isWorkbenchFlagEnabled`, using the localStorage keys
`craft-feature-entities-links-v1` (STUB(#1499), see below) and
`craft-feature-entities-previews-v1`.

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
| `EntityPicker` / `EntityPickerPanel` | «Связать элемент Rox…», 560 px: search, kind filter chips, Recent / Results groups, ↑↓ / Enter / Esc. A typed `kind:id` is always offered as a literal row. |
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

## Stubs

- `flags.ts`, `STUB(#1499)`: the renderer atom for `entities.links.v1` uses the `craft-feature-*` key convention until #1499 exports its own atom.
- `entity-data-source.ts`, `STUB(#1504)`: no search provider yet.
