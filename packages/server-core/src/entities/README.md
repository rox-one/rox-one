# Entity links (W1-02, `entities.links.v1`)

Server side of the entity registry + links package (#1499).

| Module | Role |
| --- | --- |
| `link-store.ts` | One SQLite DB per workspace at `<workspaceRoot>/.rox/entity-links.sqlite` (dir mode 0700, WAL). Links dedupe on `(from, relation, to)`; `add` bumps `revision` atomically in one upsert; `replaceOutgoing` reconciles a source's *owned* links in one IMMEDIATE transaction. |
| `extract.ts` | Explicit-syntax-only extraction: `[[kind:id\|label]]`, `![[…]]`, `[[plain title]]`, `rox://…`, mention nodes. Bare `kind:id` never links. A plain wikilink whose prefix is not a known kind, or with whitespace after `:`, is a note title (the `#Heading` part is dropped). |
| `note-links-indexer.ts` | Note-mention indexer: on every persisted note change the Notes handlers reconcile the note's outgoing links (`mentions`; a whole-line, unescaped `![[…]]` → `embeds`) and push `entities:linksChanged`. Deleted notes lose their outgoing links. Frontmatter, fenced and inline code are skipped; the note text is never rewritten. See "Indexer rules" below. |
| `resolver-host.ts` | Per-workspace, per-actor preview cache behind `entities:resolve`. |
| `workbench-flags.ts` | Live workbench-flag source read on every call. |

## Indexer rules

- **Ownership.** The indexer only reads, deletes and refreshes rows it wrote
  (`created_by = system:notes-indexer`, relation `mentions`/`embeds`).
  Manual links on a note (`relates-to`, a role, a block anchor, or a same-key
  link someone else authored) survive every save, rename and delete of that
  note; the indexer never overwrites their role or anchor. A manual
  `entities:links` add that sets a role or anchor on a row the indexer wrote
  takes ownership of it (`created_by` becomes the caller), so the indexer
  stops touching it.
- **Embeds.** `![[…]]` is an `embeds` link only when the `!` is unescaped and
  the trimmed line is exactly the embed (same rule as the renderer's
  `matchEntityEmbedLine`); `\![[…]]`, inline `a ![[…]] b` and indented code
  lines are `mentions`.
- **Change = link set.** Only added/removed links bump revisions and push
  `entities:linksChanged`. Line anchors are refreshed in place silently, so
  typing above the links causes no revision bump and no push.
- **Ordering.** Filesystem-vault notes are indexed inside the vault lease
  (changed delivery). Native (journal) notes are indexed through a per
  `(workspace, note)` promise chain that skips a read older than the journal
  revision already applied (`createNoteLinksSerializer`). Rename/move
  tombstone the old id at the post-op revision; delete tombstones without
  bound until a create of that id resets it.
- **Bounded work.** Lines over 20 000 chars are skipped and scanning stops
  after 2 MB of a note (both logged); the wikilink (`indexOf` scan, no regex)
  and inline-code scanners are linear per line.
- **Phantom sources.** Ops while the flag is off never touch the store. When
  the store is first used after the flag turns on (and after every later
  off → on transition) indexer rows of notes that no longer exist are pruned;
  backlinks additionally hide any source note that cannot be found. The
  notes root is resolved once per prune run / backlinks call (the probe is a
  per-workspace factory); after that each source is one `existsSync`. If the
  root is not an existing readable directory (unmounted custom `notesPath`,
  unresolved native workspace) nothing is pruned, that generation stays
  unpruned (retried on next use, logged once) and backlinks treat every
  source as present. A run where every source reads as missing is skipped.

## Flag

`entities.links.v1` is default OFF. The renderer owns the persisted toggle
(Settings → localStorage); Electron main owns the **effective** state
(`CRAFT_FEATURE_ENTITIES_LINKS` env override > toggle), keeps a durable copy
in `<configDir>/entities-links.json`, publishes it to the deep-link parser and
this package's live flag source, and returns/broadcasts it to every renderer
(`entities:syncLinksState`, `entities:setLinksEnabled`,
`entities:linksStateChanged`). With the flag off nothing here opens, reads or
writes anything: behaviour is identical to main.

Two small, deliberate costs of the seed design: every window bootstrap makes
one synchronous `entities:syncLinksState` round-trip to main before the first
React render (so restored entity tabs resolve against the effective state;
the listener is registered first thing in `whenReady`, before any await), and
`entities-links.json` is written only once the toggle has been on (a value of
`true`, or updating an existing copy) — a user who never enabled the flag gets
no file. Without a copy, a cold-start entity deep link waits for the first
renderer report (≤ 10 s, then dropped with a warning); a held link that a
later external deep link supersedes is dropped so the most recent link wins.
Internal navigations (new window with an initial link, open session in new
window) neither supersede nor get superseded. A cold-start link whose
handling fails is logged and dropped — there is no retry.

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
  note's own outgoing (indexer) links move to the new id. Manual links from a
  renamed or deleted note stay under the old id (hidden from backlinks once
  that note cannot be found).
