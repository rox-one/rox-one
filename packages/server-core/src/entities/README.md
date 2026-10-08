# Entity links (W1-02, `entities.links.v1`)

Server side of the entity registry + links package (#1499).

| Module | Role |
| --- | --- |
| `link-store.ts` | One SQLite DB per workspace at `<workspaceRoot>/.rox/entity-links.sqlite` (dir mode 0700, WAL). Links dedupe on `(from, relation, to)`; `add` bumps `revision` atomically in one upsert; `replaceOutgoing` reconciles a source's links in one IMMEDIATE transaction. |
| `extract.ts` | Explicit-syntax-only extraction: `[[kind:id\|label]]`, `![[…]]`, `[[plain title]]`, `rox://…`, mention nodes. Bare `kind:id` never links. A plain wikilink whose prefix is not a known kind, or with whitespace after `:`, is a note title (the `#Heading` part is dropped). |
| `note-links-indexer.ts` | Note-mention indexer: on every persisted note change the Notes handlers reconcile the note's outgoing links (`mentions`; `![[…]]` → `embeds`) and push `entities:linksChanged`. Deleted notes lose their outgoing links. Frontmatter, fenced and inline code are skipped; the note text is never rewritten. |
| `resolver-host.ts` | Per-workspace, per-actor preview cache behind `entities:resolve`. |
| `workbench-flags.ts` | Live workbench-flag source read on every call. |

## Flag

`entities.links.v1` is default OFF. The renderer owns the persisted toggle
(Settings → localStorage); Electron main owns the **effective** state
(`CRAFT_FEATURE_ENTITIES_LINKS` env override > toggle), keeps a durable copy
in `<configDir>/entities-links.json`, publishes it to the deep-link parser and
this package's live flag source, and returns/broadcasts it to every renderer
(`entities:syncLinksState`, `entities:setLinksEnabled`,
`entities:linksStateChanged`). With the flag off nothing here opens, reads or
writes anything: behaviour is identical to main.

## Known limitations (W1, by decision — no behaviour change planned here)

- **Cross-workspace `rox://workspace/{id}/…` links** are stored in the
  current workspace's DB; the extractor drops the workspace id.
- **Legacy nested note routes** (`rox://notes/note/folder/page`) create no
  link (`matchLegacy` expects exactly three segments), and legacy
  `projects/project` / `pages/page` slugs are percent-decoded here but not by
  the renderer, so escaped slugs can yield different ids.
- **Base record ids containing `/`** (allowed via `?record=`) do not
  round-trip through `entityRoute`; table/view names with `/` neither.
- **Remote / standalone servers only see the env override.** The user's
  toggle reaches the server hosted inside Electron main (incl. headless
  Electron via the durable copy) but not a remote server, so a thin client
  gets `unavailable` resolution and no note indexing there unless that server
  sets `CRAFT_FEATURE_ENTITIES_LINKS=1`.
- **Plain wikilinks are stored by title** (`note:<title>`), whereas indexed
  note sources use the path id; backlinks for a note queried by id do not
  include title-based mentions until a title → id mapping exists.
- **Indexing is forward-only**: notes are indexed when Rox persists them.
  Existing notes and edits made outside Rox (external editors, sync) are
  picked up on the next save through Rox; there is no backfill yet.
- **Incoming links to a renamed/moved note keep its old id**; only the
  note's own outgoing links move to the new id.
