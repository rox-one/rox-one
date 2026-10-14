# Skills at scale (~10,000 skills)

Scope: what happens today when `~/.agents/skills` or `~/.omp/agent/skills` holds ~10k skills, and how to make it cheap.
Base: `perf/program-setup-20261013` (= origin/main 4abca797f + docs). Read-only investigation; nothing was run.
Related epic tickets: #1565 (list payloads, closed), #1561 (skills sync worker), #1578 (virtualize lists), #1586 (server-core in utilityProcess), #1587 (narrowed watcher), #1588 (codec deep walk), #1591 (memory LRUs).

Extrapolated costs at 10k, assuming linear scaling from the 1k fixture: `loadAllSkills` cold takes about 8–12.5 s, the panel path about 18 s, and `listOmpSkills` about 10 s. Summary JSON is about 6.1 MB.
Because server-core runs **in-process in the Electron main process** (`apps/electron/src/main/index.ts:1302` → `bootstrapServer`, `packages/server-core/src/bootstrap/headless-start.ts:507`), every synchronous walk below blocks all IPC and every window.

## Headline findings

1. **The panel lists every `~/.agents/skills` skill twice.** `OMP_SHARED_SKILLS_DIR` *is* `~/.agents/skills` (`omp-discovery.ts:26`), and `listOmpSkills` scans it (`omp-discovery.ts:130`). The craft "global" tier then scans the same directory again (`storage.ts:519`). With `includeShadowedOmp` (panel GET `skills.ts:81`, extensions `extensions.ts:201`), every craft-global skill also yields a `shadowedByCraft` OMP duplicate (`storage.ts:504-510`). Result: 10k skills become ~20k entries, about 12 MB, and the panel renders ~10k extra rows in its read-only OMP group (`SkillsListPanel.tsx:646-700`). Each of those rows mounts a Radix `DropdownMenu`.
2. **Per-skill read cost is about 90 syscalls.** `readSkillInstructions` does realpath of dir+file, lstat of *every ancestor*, open/fstat/lstat, and a full `assertPaths` twice (each one lstat + realpath per ancestor) (`read-instructions.ts:13-67`). Under Node, `fs.realpathSync` is the JS walker, which costs one lstat per path component. For `~/.agents/skills/<slug>/SKILL.md` (6 ancestors) that is ≈ 11 + 6 + 3 + 32 + 1 + 2 + 32 + 1 ≈ 90 syscalls. On top of that, `findIconFile` does up to 7 `existsSync` calls (`icon.ts:92-100`, 7 extensions in `icon-constants.ts:24`), and `isInsideSkillStore` does 2 more realpaths (`managed.ts:23-28`, called per global/OMP skill at `storage.ts:493,523`). One full walk is therefore ~1M syscalls, plus a full read and a full YAML parse of every body.
3. **Bodies are read and parsed for metadata-only use.** `loadSkillAtPath` keeps `content: parsed.body` (`storage.ts:227-244`). Summaries strip the body only *after* the full read (`storage.ts:561-564`).
4. **gray-matter keeps everything.** `matter(content)` with no options caches every input string forever (`node_modules/gray-matter/index.js:35-47`, v4.0.3). All call sites pass no options (`storage.ts:171`, `storage.ts:583`, `omp-discovery.ts:97`). So every SKILL.md version ever read stays resident (string + `orig` Buffer + parsed file). This ties to #1591.
5. **The bundled-sync push ships full bodies.** `headless-start.ts:487` pushes `loadAllSkills(root)` without `toSkillSummaries` to every local workspace after a bundled sync. This runs inside Electron too (`headless-start.ts:700`).
6. **Watcher fan-out.** Each `skills/<slug>/SKILL.md` event gets its own debounce key (`watcher.ts:489-490`). `SessionManager.onSkillChange` then reloads the *full* list and pushes it (`SessionManager.ts:2292-2297`). So adding 10k skills sends up to 10k pushes of N summaries, and each push triggers renderer re-GETs.

## Call sites

Cache facts: the craft cache is a module `Map`, 5-minute TTL, keyed by `ws::project::includeOmp:includeShadowed::disabled` (`storage.ts:350-351,477-483`). The OMP cache is per directory, 60 s TTL plus directory mtime (`omp-discovery.ts:50,70-73`). `invalidateSkillsCache()` clears **all** keys (`storage.ts:387-389`). It is called on any working-directory change (`SessionManager.ts:7301`), every watcher directory event (`watcher.ts:815`), update/import/prune (`storage.ts:769`, `skills.ts:255`, `skill-usage.ts:182`), pending queue (`SkillPendingQueue.ts:399,461`), learning (`LearningHost.ts:174`), bundled sync (`bundled.ts:226`, `bundled-background.ts:177`) and the marketplace (`installer.ts:595,831`). At least 5 distinct keys are in live use, and each pays its own cold walk: `(ws,proj,F,F)` base agent; `(ws,proj,T,F)` OMP agent and eligibility; `(ws,–,F,F)` SessionManager/watcher/CHANGED; `(ws,wd,T,T)` panel GET; `(ws,–,T,T)` warm-up, library, profiles and extensions without a working directory.

| # | Call site | Trigger / frequency | API & options | Reads bodies? | Notes |
|---|---|---|---|---|---|
| 1 | `base-agent.ts:1017` `extractSkillPaths` (from `chat()` `:1096`) | **every chat message**, all backends | `loadAllSkills(ws, proj, getSkillLoadOptions())`; OMP overrides to `includeOmp:true` (`omp-agent.ts:463-465`) | yes (cold) | Then O(N·A) `allowedSkillSlugs.includes` (`:1018`), a debug string joining all N slugs (`:1021`), `skills.find` per mention (`:1032`) and a Map of N names (`:1047`). A cold walk after TTL or any invalidation takes about 8–12 s on the main thread. |
| 2 | `omp-agent.ts:588-602` `computeAvailableSkillsBlock` (spawn, `:954`) | per OMP process spawn/respawn | `buildSkillEligibilityReport` → `loadAllSkillsWithTierScans(…,{includeOmp:true})` (`eligibility.ts:382`) | yes | Per skill: `isInsideSkillStore` with 2 realpaths (`eligibility.ts:428`, `:431`), and serial `await` of bin lookups per `requires.bins` (`eligibility.ts:207-250`, `defaultBinExists` `:93-111`), uncached. The output is capped to 64 entries (`prompt.ts:30`). |
| 3 | `skills-tool-runtime.ts:55-62` (`list`/`search`/`read`) | per `skills_search` / `skills_read` tool call | full eligibility report each call | yes, plus `loadSkillDetails` per search hit (`:80`) | Adds 2 more realpaths per skill (`isWithinRealRoot`, `session-tools-core/src/skills/scope.ts:28-37`). `read` builds the full report just to check one slug (`:88-89`). |
| 4 | `skills.ts:56-60` `broadcastSkillsChanged` | after UPDATE (`:224`) and PRUNE (`:306`) | `toSkillSummaries(loadAllSkills(ws))` | yes, then stripped | The payload omits project/OMP; listeners ignore it (see Payloads). |
| 5 | `skills.ts:63-85` `skills.GET` | per renderer call (see Renderer table) | `loadAllSkills(ws, wd, {includeOmp:true, includeShadowedOmp:true})` | yes, then stripped | Returns the full list with no paging; a cold call takes about 18 s at 10k. |
| 6 | `skills.ts:118-137` GET_ELIGIBILITY | per skill-info open | scoped `slugs:[slug]` | 1 body per tier | Already O(tiers). |
| 7 | `skills.ts:153,269,284`; `workspace-work.ts:58`; `workspace-work/profile.ts:14`; `SessionManager.ts:8034,8060` | per RPC / per send with `skillSlugs` | `loadSkillBySlug` | yes (1 per tier) | O(tiers), except a `--` alias, which falls back to a full `loadAllSkills` (`storage.ts:622`). |
| 8 | `skills.ts:241` IMPORT_OMP | per import | `listOmpSkills(ws).find(slug)` | yes (cold) | A 60 s cache helps; a cold call scans 3 roots for one slug. |
| 9 | `extensions.ts:201-205` LIST_INSTALLED | per extensions page load | `loadAllSkills(…,{includeOmp:true, includeShadowedOmp:true})` | yes | Projects about 20k records (duplicates) into the extension list. |
| 10 | `SessionManager.ts:743` `resolveToolDisplayMeta` (called `:10558`, `:10722`) | every `Skill` tool event | `loadAllSkills(ws)` + `find` | yes (cold) | Needs a single slug. |
| 11 | `SessionManager.ts:2288-2298` watcher callbacks | per watcher event (see Watcher) | list: payload from watcher; per-slug: `loadAllSkills(ws)` | yes | Full push per single-skill event. |
| 12 | `SessionManager.ts:5953` `create_task` tool | per `create_task` with skills | `loadAllSkills(ws)` → Set | yes (cold) | Needs only `input.skills`. |
| 13 | `SessionManager.ts:11522` `resolveAutomationMentions` | per automation run with mentions | `loadAllSkills(ws)` + `some` per mention | yes (cold) | Needs only the mentions. |
| 14 | `watcher.ts:798,816` | skills-dir event (100 ms debounce) | `loadSkill` per added folder + `invalidateSkillsCache` + `loadAllSkills(ws)` | yes | See Watcher. |
| 15 | `headless-start.ts:487` | after a bundled sync that changed files (first launch / update) | `loadAllSkills(ws)` per local workspace | **yes, sent with bodies** | Runs on the main thread in Electron too. |
| 16 | `storage.ts:572-597` `loadSkillDetails` | GET_DETAILS, tool read, scoped eligibility | per-slug tier probe | yes (intended) | This is the selected-detail path; keep it hardened. |
| 17 | `omp-discovery.ts:125-138` `listOmpSkills` | from #1, #2, #3, #5, #8, #9 when `includeOmp` | 3 roots incl. `~/.agents/skills` | **yes** (`readSkillInstructions` + `matter`, `:95-97`) | Only name/description are kept, but the whole file is read and parsed. |

## Payloads

- **Type.** `LoadedSkill` (`types.ts:78-103`) with fields `slug`, `metadata{name, description, globs, alwaysAllow, icon, requiredSources, requires, os, skillKey, primaryEnv, always, homepage}`, `content` (`''` in summaries), `contentLength`, `iconPath` (absolute), `path` (absolute), `source`, and `shadowedByCraft`. That is about 610 B per skill, so about 6.1 MB per 10k. The panel GET carries up to 2× that because of finding 1.
- **Wire.** JSON over the WS codec after a deep `encodeWireValue` walk (`server-core/src/transport/codec.ts:142`; ticket #1588). The cost is paid per client and per push.
- **`skills.CHANGED`.** The event type is `[workspaceId, LoadedSkill[]]` (`protocol/events.ts:93`). Senders: `SessionManager.ts:2889` (summaries, workspace/global tiers only), `skills.ts:59` (summaries), and `headless-start.ts:487` (**full bodies**). **Every renderer listener ignores the list and re-fetches**: `AppShell.tsx:1668-1673`, `MainContentPanel.tsx:194-199`, `SkillsListPanel.tsx:140-142` (pending + usage), `SkillsCatalogPage.tsx:61`, `SkillInfoPage.tsx:105-110` (GET_DETAILS), and `event-bridge.ts:168` (agents-catalog refetch). So one CHANGED event costs one wasted N-sized push plus 1–4 N-sized GETs per window.
- `GET_DETAILS` returns one full body, up to 2 MB (`read-instructions.ts:5`). That is correct and should stay.

## Renderer surfaces

No skills surface virtualizes today. `EntityList` supports opt-in `virtualize` (threshold 40, `entity-list.tsx:51,193,667`), but `EntityPanel` never passes it (`entity-panel.tsx:72-103`).

| Surface | Fetch | Filter / search | Cap | Virtualized | Per-row cost |
|---|---|---|---|---|---|
| `AppShell.tsx:1641-1676` (feeds `skillsAtom` `:1074`, context `skills`) | `getSkills(ws, wd)` on workspace or **active session working-directory change**, plus a re-GET on every CHANGED | — | — | n/a | Switching to a session with a new working directory is a new cache key, so a cold walk (about 18 s at 10k) |
| `SkillsListPanel.tsx:363-375` craft list | props from AppShell | **no search box** | none | **no** (`EntityPanel`) | `SkillAvatar` → `useEntityIcon` (`skill-avatar.tsx:28`) |
| `SkillsListPanel.tsx:646-700` OMP group | same | none | none | **no** (plain `<ul>`) | `DropdownMenu` + avatar per row; includes the ~10k shadowed duplicates |
| `mention-menu.tsx:540-556,142-178,333` (@-mention in composer) | `skills` prop from context | substring over label/id/description, then a **full sort** of all matches per keystroke | files capped at 20 (`:107`), **skills uncapped** | no | `SkillAvatar` per row |
| `rich-text-input.tsx:548,561-563,370` (composer) | context | — | — | n/a | **Preloads the icon of every skill** (an IPC/file read per skill with `iconPath`) whenever `skills` changes; `textToHTML` maps N slugs |
| `lib/mentions.ts:81,97,256`; `FreeFormInput.tsx:1671`; `App.tsx:507` | context / atom | `Array.includes` per mention (O(N)) | — | n/a | Rebuilds the slug array per send/render |
| `SkillSelectorPopover.tsx:47-56` → `packages/ui/.../FilterableSelectPopover.tsx:64,194` (TaskEditor `TaskEditor.tsx:551,1120-1128`) | `skillsAtom` | label substring | none | no | Avatar + check per row |
| `omnibox-providers.ts:141-180` (bootstrap `omnibox-bootstrap.ts:487-492`) | `skillsAtom` | `scoreMatchAny` over all N per keystroke | `slice(0, limit)` ✓ | n/a | O(N) scoring per keystroke |
| `SkillsCatalogPage.tsx:48,61,78,91` | `getSkills` ×(load, CHANGED, 2 readbacks) | `filterCapabilityCatalog` (`capability-catalog.ts:121`) | none | **no** (`<table>` `rows.map`, `:129`) | `buildCapabilityCatalog` does `packs.filter(p => p.skills.includes(slug))` per skill (`capability-catalog.ts:95-96`), which is O(N·P·S) |
| `AgentProfilesView.tsx:18-21,77,82` (react-query `agentsCatalog`, persisted `persist.ts:16`) | `getSkills(ws)`, no working directory | substring | none | no | Checkbox per row; the 10k projection is **persisted** to the client cache |
| `LibraryPage.tsx:76,144-157`; `use-library-index.ts:33`; `library-model.ts:106-110,160-167` | `getSkills(ws)` | join+lowercase per entry per keystroke | none | no | Button per row |
| `MainContentPanel.tsx:150-200` (route guard for a skill view) | **full `getSkills` to test whether one slug exists**, again on every CHANGED | — | — | n/a | — |
| `shell-warmup.ts:106-109` (idle warm-up) | `getSkills(ws)`, no working directory, so a different cache key from AppShell | — | — | n/a | A second cold walk |
| `SessionContextPanel.tsx:38-41` | context | — | — | n/a | Sums *all* skill body lengths into the context estimate (wrong at scale: at most 64 are advertised) |
| `SkillInfoPage.tsx:105-110` | `getSkillDetails` (selected only) ✓ | — | — | n/a | Fine |

## Watcher behaviour

- There is one `ConfigWatcher` per workspace, owned by SessionManager (`SessionManager.ts:2353`); agents skip theirs (`SessionManager.ts:5217`, `base-agent.ts:392`). It watches `{workspace}` recursively (`watcher.ts:421`). **It does not watch `~/.agents/skills`, `~/.omp/agent/skills`, the app store, or the project tier.** Those tiers refresh only via TTL (5 min craft; 60 s + directory mtime for OMP) or via an invalidation from some unrelated event.
- Routing (`watcher.ts:477-495`): `skills/<slug>` sends a single `skills-dir` debounce; `skills/<slug>/SKILL.md` or `icon.*` sends a **per-slug** debounce (`skill:<slug>`). The debounce is a 100 ms trailing timer (`watcher.ts:84,562-574`).
- `handleSkillsDirChange` (`watcher.ts:765-822`) does `readdirSync` + `statSync` on all N entries, `loadSkill` (full body) for every new folder (`:798`), `invalidateSkillsCache()` (all keys, `:815`), then a full `loadAllSkills` (`:816`), and finally `onSkillsListChange` → push (`SessionManager.ts:2288-2290`).
- `handleSkillChange` (`watcher.ts:829-859`) calls `loadSkill` (full body) and then `onSkillChange` → `SessionManager.ts:2292-2297` → `loadAllSkills(ws)` → push of N summaries. It **does not invalidate**, so an external SKILL.md edit pushes the *cached, stale* list for up to 5 min (a correctness bug).
- **Storm example: copy/unzip 10k skills into `{workspace}/skills`.** This produces about 10k per-slug timers, so about 10k `loadSkill` calls, about 10k full-list pushes (about 6 MB each), and about 10k renderer re-GETs (AppShell's revision guard drops stale *results*, but every request still runs and serializes on the server). In addition, the `skills-dir` handler re-runs a full walk after every quiet gap of at least 100 ms during the copy. This is a plausible source of the "computer overheats" report.

## Design

### D1. Metadata-only head reader (`packages/shared/src/skills/frontmatter-head.ts`)
`readSkillHead(skillDir, opts) → { meta, contentLength, fileKey } | null`:
1. `realpathSync.native(dir)` and `realpathSync.native(dir/SKILL.md)`. The leaf must be inside `dir` (same rule as `read-instructions.ts:19-20`).
2. `openSync(file, O_RDONLY|O_NOFOLLOW|O_NONBLOCK)`, then `fstat`: it must be a regular file and ≤ `MAX_SKILL_INSTRUCTIONS_BYTES`. `lstat(file)` must match the fd's dev/ino.
3. Read the first **8 KB**. If the frontmatter terminator (`\n---`) is not found and `size > 8 KB`, read up to **64 KB**. If it is still not found, treat the frontmatter as unterminated and fall back to `readSkillInstructions` + `parseSkillFile` (rare, but keeps exact parity).
4. Parse only the frontmatter block with `matter(head, {})`. Passing an options object **disables the gray-matter cache**, and the YAML engine is the same. Reuse `parseSkillMachineMetadata`/`validateIconValue`/`normalizeStringList` by extracting a pure `parseSkillFrontmatter(data)` from `parseSkillFile` (`storage.ts:169-197`).
5. `contentLength = size − frontmatterBytes`. This is bytes, not UTF-16 units; the only consumer is the estimate at `SessionContextPanel.tsx:39`.
6. Find the icon with **one** `readdirSync(dir)` (which also proves SKILL.md exists) instead of 7 `existsSync` calls.

Cost is about 7–8 syscalls per skill instead of about 90, with ≤ 8 KB read and no body retained.

### D2. Persistent skill index (`packages/shared/src/skills/skill-index.ts` + `skill-index.worker.ts`)
- **Tier plan.** Reuse `getSkillRootPlan` (`storage.ts:442-454`) and add the `omp-shared` (`~/.agents/skills`) root. Merge semantics move into a pure `mergeSkillTiers(scans, {includeOmp, includeShadowedOmp, disabledBundled})` extracted from `storage.ts:485-553`. Both legacy `loadAllSkillsWithTierScans` and the index call it, so aliasing (`chooseManagedSkillName`), craft-wins and disabled-pack behaviour stay identical. **Fix:** do not emit a shadowed OMP variant whose real path equals the craft winner's real path (same directory seen via `~/.agents/skills` twice); this removes the 2× duplication.
- **In-memory model.** Per root: `{rootReal, rootMtimeMs, entries: Map<slug, {fileKey:{dev,ino,size,mtimeMs,ctimeMs}, dirMtimeMs, meta, contentLength, iconPath, realPath, insideAppStore}>}`. The merged view per scope is cached by `(ws, project, includeOmp)` with a `revision` counter, plus a lowercase search string per entry.
- **On-disk cache.** `<configDir>/cache/skill-index/v1/<sha256(rootReal)>.json` (an NDJSON variant is optional), written atomically (tmp + rename) at most every 2 s after a change. It holds metadata only and no bodies. Records are keyed by slug and validated by `fileKey`. A schema version bump discards it.
- **Warm start.** Load the disk cache asynchronously (about 6 MB JSON, parsed in the worker), serve it immediately with `complete:false`, and revalidate in the background.
- **Incremental refresh.** Per root: `stat(root)`. If `rootMtimeMs` changed, `readdir` and diff names (adds/removes). In all cases, `lstat` each `SKILL.md` in parallel and re-read the head only where `fileKey` differs (catches in-place edits that do not bump directory mtime). Refresh triggers: query when the last validation is older than 2 s; watcher events (D5); explicit `invalidate`. **This replaces the 5-minute TTL and `invalidateSkillsCache()` clearing all keys; keep `invalidateSkillsCache` as an alias that marks roots dirty.**
- **Off-thread cold scan.** A worker pool reuses the bundled-sync precedent (`bundled-background.ts:22-64`, build output `scripts/electron-build-main.ts:38`, asar unpack pinned by `apps/electron/scripts/perf/__tests__/worker-packaging.test.ts`). Pool size `K = clamp(os.availableParallelism() − 2, 1, 4)`. Each worker takes a shard of directory entries and runs D1 with *sync* fs calls; sync calls inside a worker do not contend for libuv's 4-thread pool. Results stream back in batches of 500 so the first page is served before the scan ends. In headless Bun without a worker script, fall back to inline scanning chunked with `setImmediate` every 200 entries.
- **Memory.** About 600 B per entry plus the search string, roughly 10 MB at 10k. No bodies; no gray-matter cache.

Public API (async):
```ts
export interface SkillSummary { slug: string; name: string; description: string; source: SkillSource; path: string;
  iconPath?: string; icon?: string; contentLength: number; shadowedByCraft?: boolean;
  requiredSources?: string[]; requires?: SkillRequires; os?: string[]; always?: boolean; skillKey?: string; primaryEnv?: string; homepage?: string }
export interface SkillScope { workspaceRoot: string; projectRoot?: string; includeOmp?: boolean; includeShadowedOmp?: boolean }
export interface SkillQuery { query?: string; offset?: number; limit?: number; sources?: SkillSource[]; slugs?: string[] }
export interface SkillPage { items: SkillSummary[]; total: number; revision: number; complete: boolean }
export function getSkillIndex(): {
  query(scope: SkillScope, q: SkillQuery): Promise<SkillPage>
  resolveSlugs(scope: SkillScope, slugs: readonly string[]): Promise<Map<string, SkillSummary>>
  listAll(scope: SkillScope): Promise<readonly SkillSummary[]>          // eligibility / prompt only
  markDirty(root: string, slugs?: readonly string[]): void
  onChange(fn: (e: { scopeKey: string; revision: number; changed: string[]; removed: string[] }) => void): () => void
}
```
Search: score `slug` prefix > `name` prefix > word-start > substring over a precomputed lowercase `slug\nname\ndescription`. Sort by score, then name. `limit` defaults to 50, max 500.

### D3. Paginated RPC (replaces full-list shipping)
- New `skills.QUERY`: `(workspaceId, { workingDirectory?, query?, offset?, limit?, sources?, includeShadowed?, slugs? }) → SkillPage`. Add it to `HANDLED_CHANNELS` (`skills.ts:35-48`), `RPC_CHANNELS`, routing/catalog (`protocol/routing.ts:1142`, `protocol/catalog.ts:72`), `channel-map.ts:758` (`querySkills`), and `shared/types.ts:2529`. Use the same `assertSkillWorkspace` + `rpcSkillsListResult` gate as GET (`skills.ts:64-66`).
- `skills.CHANGED` payload becomes a delta: `[workspaceId, { revision: number; changed: string[]; removed: string[] }]`. No list. Coalesce per workspace with a 250 ms trailing debounce and 1 s max wait. All current listeners already ignore the list. `ipc-channels.test.ts:68` pins the payload type and must be updated deliberately; the QA fixture (`tests/e2e/qa-observations/fixture.tsx:35`) also passes a list.
- `skills.GET` stays for compatibility but is served from the index (no FS walk) and no longer includes shadowed duplicates of the same real path. Migrate renderer callers off it; consider capping it at 2,000 entries with a logged warning.
- Fix `headless-start.ts:487` to send the delta (or at minimum `toSkillSummaries`).
- `extensions.ts:201` projects from `index.listAll`, or pages via the same query.

### D4. Mention / slug fast path (no catalog walk per message)
- `base-agent.extractSkillPaths` becomes async. `chat()` is already an async generator (`base-agent.ts:1089-1096`), and the `omp-agent.ts:411-418` override changes with it. Steps: regex-extract the candidate `[skill:(ws:)?slug]` tokens first (same pattern as `lib/mentions.ts:94`), filter by a `Set(allowedSkillSlugs)`, then `resolveSlugs(scope, candidates)`.
- `resolveSlugs` serves from the in-memory index when warm. When cold, it probes **only the mentioned slugs** in tier priority order (project → workspace → global non-app → app-managed non-disabled → OMP workspace/shared/global) with D1. `--` aliases resolve from the index map, so the full-walk fallback at `storage.ts:622` disappears. Cost is O(mentions × tiers) instead of O(N).
- Drop the N-slug debug join (`base-agent.ts:1021`); log only the resolved slugs. `resolveSkillMentions` gets a names Map for the mentioned slugs only.
- Apply the same `resolveSlugs` at `SessionManager.ts:743`, `:5953`, `:11522`, at `skills-tool-runtime.ts:88` (eligibility for one slug via `buildSkillEligibilityReport({slugs:[slug]})`), and at `skills.ts:241`.
- `buildSkillEligibilityReport` full scan takes `index.listAll` (summaries). Memoize `binExists` per report (or per 60 s), and hoist the root realpath out of the per-skill `isInsideSkillStore` (`eligibility.ts:428,431`) by using the index's stored `realPath`/`insideAppStore`. `skills_search` excerpts (`skills-tool-runtime.ts:80`) stay bounded by `limit`.

### D5. Watcher
- `ConfigWatcher` per-slug events call `index.markDirty(workspaceSkillsRoot, [slug])`; directory events call `markDirty(root)`. **Remove** the `loadSkill` per added folder (`watcher.ts:798`) and the full `loadAllSkills` (`watcher.ts:816`). `SessionManager.ts:2288-2298` forwards index `onChange` as the coalesced delta CHANGED (D3) and stops calling `loadAllSkills`.
- Add non-recursive, directory-level `fs.watch` on `~/.agents/skills`, `~/.omp/agent/skills` and the app store, shared across workspaces. These only mark roots dirty, and the index revalidates lazily. This aligns with #1587. If a watch fails, keep the 2 s query-time revalidation.

### D6. Renderer
- Replace the list-shaped `skillsAtom` with `skillsCatalogAtom = { total, revision, complete }` and a `useSkillSearch(workspaceId, { query, limit, offset, workingDirectory })` hook. The hook uses react-query (key `[ws,'skills',revision,wd,query,offset]`) with an 80 ms debounce. Invalidate on the CHANGED revision.
- `SkillsListPanel`: add a search box (EntityList header slot), pass `virtualize` through `EntityPanel`, use infinite paging (limit 200), collapse the OMP group by default and virtualize it, and show shadowed variants only on demand. Replace the per-row `DropdownMenu` with one shared menu.
- `mention-menu` / `SkillSelectorPopover` / omnibox / `AgentProfilesView` / Library: query-first with `limit` 20–50, and render a "refine your search" footer when `total > items.length`. Resolve selected slugs via `slugs:[…]`.
- `rich-text-input.tsx:561-563`: remove the eager icon preload; `SkillAvatar` loads lazily per visible row. Badges and mention validity use `querySkills({slugs: mentioned})`, cached in a small `Map`, instead of `Array.includes` over N.
- `MainContentPanel.tsx:150-200`: existence check via `querySkills({slugs:[slug], limit:1})`.
- `SkillsCatalogPage`: page plus virtual table; precompute a `slug→packs` Map in `capability-catalog.ts:95-96`.
- `shell-warmup.ts:108` and the persisted `agents-catalog` (`persist.ts:16`): warm/persist only the first page and `total`.
- `SessionContextPanel.tsx:38-41`: estimate from the advertised catalog (≤ 64 entries / 8,000 bytes, `prompt.ts:30-31`), not all N.

### Safety: which `readSkillInstructions` checks remain
| Check (`read-instructions.ts`) | Metadata (index, list, search) | Selected detail (GET_DETAILS, `skills_read`, `loadSkillBySlug` body, mention prerequisite) |
|---|---|---|
| Leaf realpath confined to the skill dir (`:13-20`) | **Keep**: otherwise a `SKILL.md` symlink could leak the head of an arbitrary file as name/description | Keep |
| Excluded app-store directory (`:21-29`) / `isInsideSkillStore` | **Keep**: compute once per root and store `insideAppStore` per entry | Keep |
| `O_NOFOLLOW` + `O_NONBLOCK` open, `fstat` regular file, 2 MB cap (`:50-52`) | **Keep**: avoids FIFOs/devices and huge files | Keep |
| fd ↔ path identity (`same()` vs `lstat`, `:53-57`) | **Keep (1 lstat)**: cheap; proves we parsed what we confined | Keep |
| Ancestor lstat chain + dev/ino binding (`:32-41`) | **Drop per skill**: validate the root's ancestors once per scan; metadata is advisory and re-validated on body read | **Keep** |
| `assertPaths` before and after read (`:42-49,58,67`) | **Drop**: `fileKey` change detection on the next refresh covers swaps | **Keep** (TOCTOU guarantee pinned by `selected-details.test.ts:47,62`) |
| Post-read `fstat`/`lstat` re-check (`:66`) | Drop | Keep |
| `isSafeSkillName` / dot-dir skip (`storage.ts:222,264`) | Keep | Keep |
The index must never be a source of *bytes*. Every body read goes through `loadSkillDetails` → `readSkillInstructions`, unchanged. `skills_read` keeps its "advertised implies readable" invariant (`skills-tool-runtime.test.ts:72`) by checking eligibility for that slug and then reading through the hardened path.

## Test seams

These must stay green. Run `bun test` per file; the `*.isolated.ts` files run isolated.
- `packages/shared/src/skills/__tests__/storage.test.ts`: `loadSkill`/`loadWorkspaceSkills` semantics, icon detection (`:227-237`), requiredSources normalization (`:176-205`). The legacy sync loaders stay.
- `skill-summaries.test.ts:23-50`: `toSkillSummary` shape, and **`loadAllSkills` still returns bodies and scans the app store exactly once**. Keep `loadAllSkills` as the legacy body-reading API (tests and the pack tooling use it). Production callers move to the index.
- `selected-details.test.ts` (all 9 tests) and `selected-path-boundary.test.ts:5`: hardened body reads must be unchanged.
- `eligibility.test.ts` (reason codes, `:249` mention catalog with `includeOmp`, `:342-446` custodian scans via `loadSkillsFromDir`), `prompt.test.ts` (caps 64 / 8,000 B / 200 chars), `managed-installation.test.ts`, `bundled.test.ts:257`, `bundled-sync-stamp.test.ts`, `ambient-links-isolation.test.ts`, `update-skill-content.test.ts`.
- `packages/shared/src/agent/__tests__/omp-skills-surface.test.ts:42-55`: `includeOmp` merge and craft-wins. It must hold for both `mergeSkillTiers` and the index.
- `packages/shared/src/config/__tests__/watcher-skill-errors.test.ts:57-87`: watcher error surfacing for EACCES/denied paths. Keep `onSkillChange` emission and error propagation.
- `packages/server-core/src/handlers/rpc/__tests__/`: `managed-skills-installation.isolated.ts` (aliases `rox--review`, directory packs, `loadSkillBySlug` alias resolution `:93-212`), `skills-tool-runtime.test.ts:50-72` (symlink containment), `skills-selected-native.test.ts:54-69`, `skills-workspace-auth.test.ts:7`, `skills-eligibility.test.ts`, `extensions.test.ts:128-206`.
- `packages/server-core/src/memory/__tests__/skill-pending-queue.test.ts:143`.
- `apps/electron/src/shared/__tests__/ipc-channels.test.ts:68` (CHANGED payload type, to be updated intentionally), `apps/electron/scripts/perf/__tests__/worker-packaging.test.ts` (extend to the new worker).
- Renderer: `components/app-shell/__tests__/rox-readiness-ui-001.*` (browser, navigation, selected-resource, workspace-recovery, component-harness: these stub `getSkills`/`onSkillsChanged`), `skill-runtime-row.fixture.mjs`, `pages/__tests__/skill-info-owner.browser.node.ts`, `pages/__tests__/rox2-native-surfaces.test.ts`, `platform/__tests__/omnibox-providers*.test.ts`, `lib/query/__tests__/query-cache.test.tsx:253`, `lib/__tests__/shell-warmup.test.ts`, `pages/extra-screens/library/__tests__/library-model.test.ts`, `lib/capability-catalog.test.ts`, `lib/runtime-catalog-capabilities.test.ts`, `lib/starter-prompts.test.ts`. Also `tests/e2e/qa-observations/backend-detail.isolated.ts`, which calls `invalidateSkillsCache`/`invalidateOmpSkillsCache`; keep both exports.
- New tests to add: head-reader parity with `parseSkillFile` on fixtures (unterminated frontmatter, >8 KB frontmatter, CRLF, BOM, symlinked leaf escaping, FIFO); index incremental refresh (in-place edit without directory mtime change); no shadowed duplicate for the same real path; `resolveSlugs` does not call `readdirSync` on unrelated roots; CHANGED coalescing (10k events → ≤ a few pushes); a 10k-fixture bench gate in #1560.

## Risks

- **Semantics drift between the index and legacy `loadAllSkills`.** Mitigate with one shared `mergeSkillTiers` plus parity tests on the same fixtures.
- **Unterminated or very large frontmatter.** The head reader's window can differ from gray-matter's parse of the whole file. Mitigate with the fallback to a full read when the terminator is missing within 64 KB.
- **`contentLength` changes from UTF-16 units to bytes.** Only `SessionContextPanel` consumes it (an estimate).
- **Stale metadata between refreshes.** Display-only; bodies are always re-read through the hardened path. Revalidation is bounded to 2 s.
- **Worker packaging in asar.** It must be unpacked like `bundled-skills-worker.cjs`. Headless Bun needs the inline fallback.
- **libuv threadpool (4 threads, process-wide).** If async fs is used instead of sync-in-worker, parallelism silently caps at 4. Raising `UV_THREADPOOL_SIZE` must happen before first use. Prefer sync calls in K workers.
- **Changing `extractSkillPaths` to async** touches all backends (`claude-agent`, `pi-agent`, `omp-agent`) and tests that stub it.
- **Removing shadowed duplicates** changes the panel's OMP group and extensions records. Product should confirm that a same-real-path duplicate is never meaningful (a different-path OMP variant still shows).
- **The CHANGED payload type change** is visible to remote/thin clients that might read the list. Grep found none in-repo, but external clients must be checked.
- **The gray-matter cache** stays populated by legacy paths (`updateSkillContent`, `loadSkillDetails`, tests) until those pass options or call `matter.clearCache()`.
- **Moving server-core out of the main process (#1586)** mitigates blocking but not CPU/heat. The index is still required.
