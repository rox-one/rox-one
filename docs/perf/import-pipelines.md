# Import pipelines: map, bottlenecks, shared design

Status: investigation (read-only), 2026-10-13. Base: `origin/main` 4abca797f.
Scope: every import path in `packages/server-core`, `packages/shared` and the renderer.
Related epic: rox-one/rox-one#1596. No child ticket covers imports directly. The closest
are #1572 (StartupScheduler), #1578 (virtualize every list), #1579 (polling → events),
#1586 (server-core in utilityProcess) and #1566 (low-power profile).

## 1. Summary

- **Every import runs on the Electron main process.** server-core is in-process
  (handlers registered in `packages/server-core/src/handlers/rpc/index.ts:177,227`). No
  import uses a worker thread. The only `worker_threads` user in the codebase is the
  bundled-skills sync (`packages/shared/src/skills/bundled-background.ts:64`). Nothing
  sizes work by hardware: there are 0 call sites of `os.availableParallelism` or
  `os.cpus` in server-core, shared or main.
- **Most "async" import code is really synchronous.** `persistForeignSession` is
  declared `async` but contains only `*Sync` fs calls
  (`packages/shared/src/sessions/import-persist.ts:8,150-276`). The browser-data
  importer, the notes import and the dossier import are fully synchronous.
- **Two imports start automatically and run while the app warms up.**
  - Foreign chat import is **on by default** (`session-foreign-auto-import-storage.ts:20`).
    It starts 20 s after launch and repeats every 15 min
    (`session-foreign-auto-import.ts:25-26,260-271`).
  - Browser history/bookmarks import starts at 25 s and repeats every 15 min, for every
    workspace in turn (`browser-data-auto-import.ts:131-141`).
- **The worst cost is quadratic per-item work in the foreign chat import.** For each
  item it re-reads whole index files and, for new items, re-reads every existing session
  file. It then sends one `session_created` event per item, and the renderer handles
  each one with a full-message RPC plus an O(S) atom copy.
- **Rendering imported data is not progressive.** Results come back in one big RPC
  response. The foreign-import picker renders up to 100,000 `<li>` with no
  virtualization. Drive progress is polled every 1.5 s, and each poll returns the
  entire plan.

## 2. Pipeline table

Thread "main" means the Electron main process (server-core in-process). The same code
runs inside the headless server process via `bootstrap/headless-start.ts`.

| Pipeline | Trigger | Thread | Concurrency | Batching of writes / index | Progress to renderer | Renderer display |
|---|---|---|---|---|---|---|
| Foreign chats, manual (`sessions:foreignDiscover` / `foreignPersist`) | User: Settings → Import (`ImportSettingsPage.tsx:175,205`) | main; discovery time-sliced 12 ms (`import-discover.ts:345-358`); persist fully sync | serial `for…await` over ≤5,000 paths (`session-foreign-import.ts:32,102-112`) | none: registry read+rewrite per item (`import-registry.ts:46-57`); one ingest + notify per item (`session-foreign-import.ts:114-124`) | one big response (all results); plus one `session_created` per item | non-virtualized `<ul>` of all entries (`ImportSettingsPage.tsx:409-430`); per-item `getSessionMessages` + `addSession` (`App.tsx:1333-1344`) |
| Foreign chats, auto (`ForeignAutoImporter`) | **Automatic**: 20 s after start, then every 15 min; default-enabled | main | serial, ≤150 per run (`session-foreign-auto-import.ts:24,204-238`), `setImmediate` between items | same as manual; status file rewritten at the end (`:250`) | none pushed; renderer polls `foreignAutoStatus` every 1.5 s / 10 s while the page is open (`ImportSettingsPage.tsx:80`); `session_created` per item | same per-item session events |
| Browser history/bookmarks, auto (`BrowserDataAutoImporter`) | **Automatic**: 25 s, then 15 min, every workspace (`browser-profile-import.ts:199`); only after opt-in | main, **fully sync** | serial over workspaces (`browser-data-auto-import.ts:136-138`) | whole index rewritten (`profile-import.ts:371-380`) + durable state write (`browser-data-auto-import.ts:59-63`) | none (status RPC) | n/a (counts only) |
| Browser profile import, manual (`browserProfile:import`) | User consent dialog | main, sync except credential prep | single profile; in-flight guard (`browser-profile-import.ts:257`) | one index write + rollback snapshot copy (`profile-import.ts:339-340`) | one response (summary) | summary |
| Notes folder import (`notesImport:preview` / `execute`) | User: Notes → Import folder (`NotesImportButton.tsx:66,85`) | main, **fully sync** | serial over ≤500 files (`notes-import.ts:20-24,221-263`) | one provenance manifest at the end (`:268-275`) | one response `{copiedCount, skippedCount}` | toast; preview list ≤500 rows unvirtualized (`NotesImportButton.tsx:137-142`); `onImported` → caller refetch |
| Craft notes migration (`importNotes`) | **No production caller** (exported only via `knowledge/index.ts:23`) | main (async fs) | serial | **map rewritten after every note/asset**: 12 `persistMap` sites (`notes-migration.ts:1052…1191`), ≤2,000 notes + 2,000 assets (`:40-42`) | `onCheckpoint` callback per item | n/a |
| Drive cloud import (`drive:import*`) | User: Drive import dialog | main, async network IO | **bounded: 8 workers** (`job-runner.ts:57,414`); planning is a serial recursive `list` (`:244-263`) | **whole job JSON (incl. full plan) rewritten per file** (`:162-175,356-360`); `recompute` O(plan) per file (`:211-231`) | events emitted but never wired to the renderer (`subscribe` unused in `drive.ts:193-205`); renderer polls `drive:importStatus` every 1.5 s (`import-controller.ts:90,154-183`) | status returns `cloneJob` incl. full plan (`job-runner.ts:103-109,483-497`) |
| Meeting media (`meetings:importMedia`) | User (helpers exist, but `importMediaViaRpc` / `specFromBytes` have **no UI caller**) | renderer hashes whole file (`import-rpc.ts:56-65`); main commits one journal intent (`meetings.ts:434-449`, `import.ts:80-149`) | single item | 1 journal commit | one response | n/a. `MeetingMediaArchive` (`import-media.ts:41-112`) is unused |
| Memory repo edits (`memory:repoPreviewImport` / `repoApplyImport`) | User | main | runtime accessor reads files **serially** (`memory-repo.ts:376-383`); parse runs twice (preview + apply, `memory-repo-import.ts:176,202`) | **batched** `saveMany` (`:219`) | one response | proposals list |
| Dossier → contact cards (`directory:exportDossier`) | **No renderer caller** (absent from `channel-map.ts`) | main, sync | single pass, ≤5,000 entities (`dossier-import.ts:25,81`) | **one** `writeAll` + read-back verify (`:228-232`) | one response | n/a |
| Workgraph credential imports (GitHub env, docker, AWS, ADC, keychain, ssh-agent; plus `git-helper-import.ts`, `github-oauth-import.ts`, `infisical-import.ts`) | User (connections UI) | main; host runners spawn processes (`host-import-runners.ts:6-13`) | serial preview per candidate (`local-imports.ts:39-46`, `github-import.ts:21-29`) | single commit | one response | small lists (n ≲ tens) |

## 3. Ranked bottlenecks

Notation: N = items per run, S = existing sessions in the workspace, E = scan-cache
entries (≤100,000, `import-discover.ts:20`), R = registry entries.

1. **Foreign persist scans every stored session for every new item.** When the registry
   has no record of a source (true for every first-time import),
   `persistForeignSession` calls `findPersistedSource`
   (`import-persist.ts:179-180`). That function `readdir`s `sessions/` and then
   `readFileSync` + `JSON.parse`s **every line of every `session.jsonl`**
   (`import-persist.ts:82-88,127-147`). The cost is O(N × S × session size), all on the
   main thread. The auto run does this for up to 150 items, 20 s after launch, with no
   user action. `existingIds()` repeats the `readdir` for each created item (`:250`).
2. **Foreign persist re-reads and rewrites whole index files per item, and parses each
   source twice.** Per item it does:
   - `findScannedForeignSource`: parses the whole scan cache, then does a linear
     `find`, with a `realpath` fallback over all E entries (`import-registry.ts:93-105`).
   - `lookupImportedSession` + `recordImportedSession`: two parses and one pretty-printed
     rewrite of the registry (`import-registry.ts:46-57`, `JSON.stringify(…, null, 2)` at
     `:42`).
   - `convertForeignSource` + `fingerprint` (a SHA-256 over `JSON.stringify` of every
     message, `import-persist.ts:78-80,168,175`). This runs **before** the
     `mode === 'skip'` early return (`:193`), so already-imported sources are still
     fully parsed. Discovery parsed the same file already (`import-discover.ts:218`).
     Sources may be up to 32 MB (`import-convert.ts:16`), and a single parse cannot
     yield, because the 12 ms slicing only happens *between* files
     (`import-discover.ts:345-358`).

   Total: O(N × (E + R)) JSON parsing plus N registry writes.
3. **Each imported session invalidates the session index, and the renderer handles each
   one separately.** On the server, `ingestImportedSession` calls `readFreshHeaders`
   (`SessionManager.ts:3564`). That function walks and stats every session dir
   (`sessions-projection.ts:150-162`). It always misses right after a write, because the
   count or mtime changed (`:340`). The fallback is `listStoredSessions`, a full
   header scan of the workspace (`SessionManager.ts:3571`, `storage.ts:363`), plus a
   queued `rebuildWorkspace` (`:3572`). Then `notifySessionCreated` pushes one
   `session_created` per item (`SessionManager.ts:4525-4530`).

   In the renderer, every event triggers a full `getSessionMessages` RPC
   (`App.tsx:1334`). `addSessionAtom` then copies the meta Map, the ids array and the
   loaded Set (O(S) each, `atoms/sessions.ts:482-495`) and re-renders the list. A
   150-item auto run therefore costs about 150 full scans, 150 RPCs and 150 list
   re-renders.
4. **Browser-data auto-import blocks the main thread on a timer.**
   `BrowserDataAutoImporter.run` is synchronous end to end
   (`browser-data-auto-import.ts:105-129`). It:
   - `copyFileSync`s the browser's History SQLite DB plus WAL/SHM, up to 3 attempts
     (`profile-native-data.ts:44-56`; History DBs are often hundreds of MB);
   - queries up to 50,000 rows per category (`profile-native-data.ts:13,226,241-254`);
   - reads and parses the previous index, then `JSON.stringify`s the whole index, up to
     100k items (`profile-import.ts:339,371-380`);
   - writes it with `durable: true` (fsync) (`browser-data-auto-import.ts:62`).

   This runs for every opted-in workspace, serially, at 25 s and every 15 min. There is
   no "source unchanged" short-circuit, so a full copy happens on every tick.
5. **Foreign discovery sends one huge payload, and the picker renders all of it.**
   `sessions:foreignDiscover` returns every entry in a single response (up to 100,000,
   20,000 per kind; `import-discover.ts:20-21,329`). The page stores it and renders
   `visible.map(…)` into a plain `<ul>` (`ImportSettingsPage.tsx:149-157,409-430`). Each
   keystroke in the filter re-runs `filterForeignIndexEntries` over all entries
   (`import-discover.ts:149-161`), and "select visible" copies the selection map per
   click (`ImportSettingsPage.tsx:228-235`). This breaks the epic's 256 KB list-payload
   budget (#1596).
6. **`notesImport:execute` is synchronous and silent.** For up to 500 files it runs
   `scanSourceFolder` (sync `readdirSync`/`lstatSync` walk) and then `materializeImport`.
   Per file, `materializeImport` does: 2 component `lstat` passes, `openSync`,
   `fstatSync` ×2, `readFileSync`, `mkdirSync` and `writeFileSync` with up to 51
   collision retries (`notes-import.ts:45-96,120-144,163-200,221-263`). The scan runs
   **twice** (preview and execute, `handlers/rpc/notes-import.ts:74,86`). The UI only
   gets a spinner and then a toast (`NotesImportButton.tsx:83-103`).
7. **Drive job checkpoints are O(plan) per file, and progress is polled.** Every
   committed file re-serializes the whole job, including the full plan, and writes it
   (`job-runner.ts:162-175,360`). It also runs `recompute` over the entire plan
   (`:211-231`), which gives O(F²) bytes written for F files. Status polling every 1.5 s
   clones and ships the full plan (`job-runner.ts:103-109,483-486`,
   `import-controller.ts:90`). Meanwhile the runner's push events (`file`, `progress`)
   reach no one. Planning walks folders one `list` call at a time (`:244-263`).
8. **The Craft notes migration rewrites its whole map per item** (12 `persistMap` sites,
   `notes-migration.ts:984-986,1052-1191`). With 2,000 notes and 2,000 assets that is up
   to about 8,000 full-map rewrites, so O(N²) bytes. It is dormant today because
   `importNotes` has no production caller, but it must be fixed before it is wired.
9. **Smaller items:**
   - Memory-repo runtime reads bank files serially and parses edits twice
     (`memory-repo.ts:376-383`; `memory-repo-import.ts:176,202`).
   - The LCS diff uses a dense (n+1)×(m+1) matrix per changed rule
     (`repo-import-parser.ts:130-150`). That is fine for rules, but would be quadratic
     for large files.
   - Workgraph previews run candidates serially (`local-imports.ts:42-45`). This is
     harmless at n ≲ 10.

## 4. Shared design: one bounded, cancellable, resumable import pipeline

### 4.1 Shape

```text
discover ──► parse (CPU) ──► write (IO) ──► index (batched) ──► notify (coalesced)
 stream       worker pool     bounded        single writer        ≤ 1 event / 100 ms
 pages        sized to HW     semaphore      flush every k/ms     + final summary
```

Module proposal: `packages/server-core/src/import-pipeline/` (`pipeline.ts`, `pool.ts`,
`journal.ts`, `progress.ts`), with pure parse functions in `packages/shared` so they can
be loaded in a worker. It is process-agnostic, so it keeps working when server-core
moves to a utilityProcess (#1586).

```ts
interface ImportSource<D, P> {
  kind: string                                    // 'foreign-sessions' | 'browser-data' | 'notes' | 'drive'
  discover(signal: AbortSignal): AsyncIterable<D[]>       // pages, newest-first
  key(item: D): string                            // stable id (sourcePath, relativePath, …)
  fingerprint(item: D): string | undefined        // cheap (mtime+size) → skip unchanged before parse
  parseTask?: { module: string; fn: string }      // runs in worker; returns P (small metadata)
  write(item: D, parsed: P, signal: AbortSignal): Promise<WriteResult>   // IO stage
  indexBatch(results: WriteResult[]): Promise<void>                      // one call per flush
}
runImport(source, { jobId, signal, onProgress, limits }): ImportJobHandle
```

### 4.2 Stage rules

- **Discover.** Yield pages of about 200 items, newest first. The first page must reach
  the renderer in under 300 ms. Apply the fingerprint short-circuit here, using an
  in-memory `Map` built **once per run** from the registry, so unchanged and
  already-imported items never reach parse. That fixes bottleneck 2's skip-after-parse.
- **Parse (CPU).** Use a `worker_threads` pool sized as
  `clamp(os.availableParallelism() - 2, 1, 6)`. Use 1 worker when the low-power
  profile is on (#1566) or on battery, and 1 for automatic runs while the user is
  active. The worker reads the source file, converts it, hashes it and **writes the
  output file itself** (tmp + rename). It returns only a small header (id, title,
  counts, hash), so no structured clone of multi-MB message arrays. Pure CPU parsers
  that qualify: `convertForeignSource` + `fingerprint` + `toMessages`, notes link
  rewriting (`rewriteImportedMarkdown`), browser `parseHistory` / `parseBookmarks`, and
  the SQLite snapshot read.
- **Write (IO).** An async-fs semaphore: 4 for local disk, 8 for network (keep Drive's 8).
  Never `*Sync` on the main thread. Allocate ids from an in-memory set loaded once,
  replacing per-item `readdir` (`import-persist.ts:250`).
- **Index (batched, single writer).** Flush every 50 items or 500 ms, plus once at the
  end. A flush means: one registry/map write (append-only JSONL journal, compacted on
  completion), one `sessionManager.ingestImportedSessions(workspaceId, ids[])`, and one
  `projector.rebuildWorkspace`. That replaces N full scans.
- **Notify (coalesced).** At most one `import:progress` push per job per 100 ms:
  `{jobId, kind, phase, done, total, failed, added: ItemSummary[] (≤200 per tick), etaMs}`.
  Plus one `import:done`. For sessions, replace per-item `session_created` with a
  single `sessions_added {ids, metas}` per flush. The renderer applies it with one
  batched `addSessionsAtom` (one Map / array copy per flush, not per item), and fetches
  messages lazily when a session is opened, not on arrival.
- **Cancellation.** One `AbortSignal` per job, threaded through every stage. Workers
  are terminated on abort. Consent revocation (`consentRevision`,
  `session-foreign-auto-import.ts:53,205`) and `drive:importCancel` map onto it. Expose
  `import:cancel {jobId}`.
- **Resumability.** A per-job append-only journal
  (`<workspace>/.rox/imports/<jobId>.jsonl`) with lines like
  `{key, state: planned|written|indexed, hash}`. On restart, replay the journal and
  resume from items not yet `indexed`. Writes stay idempotent: keep today's
  registry/hash checks and `wx` / tmp + rename. This generalizes Drive's
  `committedBytes` (`job-runner.ts:189-195`) without its O(plan) rewrite.
- **Scheduling.** Automatic imports register with the StartupScheduler (#1572) as
  `idle` priority. They start only after first paint plus warm-up, pause while a chat
  turn is streaming or input is active, and never run concurrently with another
  automatic import (one global lane, plus one lane for user jobs). Both the foreign-chat
  and browser-data timers move under this scheduler, and both gain a
  "source fingerprint unchanged → no-op" pre-check (for browser data, the
  `History` + WAL mtime and size).

### 4.3 Progressive rendering

- **Discovery.** `sessions:foreignDiscover` returns `{jobId, firstPage, total?}`, and
  later pages arrive as `import:progress` deltas. The renderer keeps entries in a keyed
  store and renders through the shared `VirtualList` (#1578; existing
  `entity-list-virtualization.ts` / `table-virtualization.ts`). Filtering runs on the
  store with a deferred value (`useDeferredValue`), and selection uses a `Set` keyed by
  `sourcePath`.
- **Persist/import.** The dialog shows a progress bar from coalesced events, and new
  items appear in the (already virtualized) `SessionList` per flush. The first
  imported item should be visible within about 1 s of starting.
- **Drive.** Replace the 1.5 s poll with `import:progress` pushes (#1579). `status`
  returns the job without `plan`; serve the plan through a paged
  `drive:importPlanPage`.

### 4.4 Budgets and test invariants

These are deterministic, counted rather than timed.

- Main-thread synchronous section per pipeline step ≤ 16 ms. No `*Sync` fs call in any
  pipeline stage on the main thread (enforced by a lint/grep ratchet on
  `import-pipeline/**`).
- For a run of N items: registry/journal compaction writes ≤ ⌈N/50⌉ + 1, session-dir
  scans ≤ 1, `session_created`/`sessions_added` events ≤ ⌈N/50⌉ + 1, and progress
  events ≤ duration/100 ms + 2.
- Parse calls per source ≤ 1 per run, and 0 for sources whose fingerprint matches the
  registry.
- A cancelled job leaves no `.tmp` files, and on resume every item is processed
  exactly once.

## 5. Conversion order

1. **Foreign chat import (auto + manual).** This is the highest user impact: it is
   automatic, on by default, runs during warm-up, and holds bottlenecks 1–3. Steps:
   - **(a)** Hoist registry, scan-cache and id-set loads out of the per-item loop.
     Build an in-memory `Map` once, and drop `findPersistedSource` in favour of a
     one-time `foreignSource.sourcePath → id` map built from headers, not full message
     reads. Move the `skip` check before `convertForeignSource`.
   - **(b)** Batch registry writes and add `ingestImportedSessions(ids[])` plus a single
     `sessions_added` event.
   - **(c)** Move parse + write into the worker pool.
   - **(d)** Schedule automatic runs under the StartupScheduler.

   Step (a) alone removes the O(N×S) and O(N×E) terms with no new infrastructure.
2. **Foreign discovery + Import settings page.** Paged discover response, virtualized
   picker, deferred filter (bottleneck 5).
3. **Browser-data auto-import.** Fingerprint no-op, worker for snapshot + query + parse,
   async atomic write, StartupScheduler lane (bottleneck 4).
4. **Notes folder import.** Async pipeline with progress events, a single scan (reuse
   the preview result by token), and items streamed into the notes tree (bottleneck 6).
   Before `importNotes` (migration) is wired, switch `persistMap` to the journal plus a
   flush every k items (bottleneck 8).
5. **Drive.** Append-only checkpoint, pushed progress instead of polling, a status
   payload without `plan`, and parallel folder listing during planning (bottleneck 7).
6. **Leave as-is for now** (already batched or small n): memory-repo (only parallelize
   the file reads in `memory-repo.ts:376-383`), dossier, meetings intent, and workgraph
   credential imports.

## 6. First conversion: test seam

- **Pipeline:** foreign chat import.
- **Public functions to test at:**
  - `persistForeignSessions(workspaceRoot, items, mode, homeDir)`
    (`packages/shared/src/sessions/import-persist.ts:278-289`). It is already exported
    and already takes `homeDir`, so a temp home and a temp workspace make it hermetic.
    Extend its signature with an optional `{ signal, onProgress, batchSize }` and keep
    the result type.
  - End to end: `ForeignAutoImporter.run({ workspaceId, force: true })`
    (`packages/server-core/src/handlers/rpc/session-foreign-auto-import.ts:107`), which
    backs the RPC `RPC_CHANNELS.sessions.FOREIGN_AUTO_RUN`. Use a fake `sessionManager`
    in `HandlerDeps` to count ingest and notify calls.
- **Counted assertions:** for N = 150 new sources and S = 1,000 pre-existing sessions:
  - 0 reads of existing `session.jsonl` bodies;
  - ≤ 4 registry writes;
  - exactly 1 scan-cache parse;
  - ≤ 4 ingest batches;
  - parse called once per new source and 0 times for `already-imported`.

  Idempotency stays unchanged: a re-run yields `already-imported` for all N. Spy on
  `node:fs` or inject an fs port, the same way `browser-profile-import.ts:53-68` injects
  `ProfileFs`.
