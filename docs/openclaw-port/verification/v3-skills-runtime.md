# V3 — Skills runtime (slice S4 + fix-s4-skills)

Runtime verification against the REAL skill store on this machine (no fixture
store). Repo: `/Users/t/Projects/rox-one-port` @ HEAD (worktree on
`port/openclaw-features`, merged main 9927e86eb). bun 1.4.2, macOS arm64.

## Real store surveyed (baseline)

Root plan for workspace `/Users/t/rox/workspaces/my-workspace`, per-tier
`loadSkillsFromDir` (raw discovery, no gating):

| tier | root | dir entries | skills loaded |
|---|---|---|---|
| omp-global | `~/.omp/agent/skills` | 16 | 53 |
| omp-workspace | `<ws>/.omp/skills` | 0 | 0 |
| global | `~/.agents/skills` | 9275 symlinks + 331 dirs ≈ 9.6k | 4832 |
| app-managed | `~/rox/skills` | 679 | 678 |
| workspace | `<ws>/skills` | 0 | 0 |

The "~9.1k-entry store" is `~/.agents/skills` (9275 symlink + 331 dir
entries). Of those entries only **4832** parse into loaded skills (many
symlinks are dangling/ephemeral test leftovers: targets include
`/tmp/w4smoke.*`, `/var/folders/.../rox-startup-bench-*`, `~/rox/skills`,
`~/.rox/skills`).

Commands were run as `bun -e "$(cat /tmp/…mjs)"` with cwd = repo root so bare
`@rox/*` specifiers resolve to the real packages (no repo files written).

---

## (a) Prompt block — produced, bounded, tool names resolve — PASS (with a critical adjacent finding, F1)

Ran the production form `renderAvailableSkillsBlock(report.eligible)` path
directly:

```
const report = await buildSkillEligibilityReport({ workspaceRoot: WS, includeOmp: true, includeCollisions: false })
const block  = buildAvailableSkillsBlock(report.eligible)
```

Observed:

```
cap_bytes 8000  cap_entries 64          (AVAILABLE_SKILLS_MAX_BYTES, AVAILABLE_SKILLS_MAX_ENTRIES)
observed_block_bytes 7955  entry_lines 27
within_cap true
search_tool mcp__session__skills_search resolves true
read_tool   mcp__session__skills_read   resolves true
last_line: _(… more skill(s) omitted — use mcp__session__skills_search to find them.)_
sample entry: - `gstack--learn-d29469f78e33-20` — … _(load: mcp__session__skills_read slug="gstack--learn-d29469f78e33-20")_
```

- Byte cap enforced: **8000 bytes for the whole rendered block** (header +
  footer + a 96-byte omission reserve; `prompt.ts:31,88`). Observed block
  **7955 bytes** (also 7778/7778 across runs) → within cap; entry cap 64 not
  reached because the byte cap binds first (27 entries).
- Tool names: both advertised host tools resolve against the REAL registry —
  `getToolDefsAsJsonSchema({ prefix: 'mcp__session__' })` (the exact defs OMP
  receives, `backend/pi/session-tool-defs.ts:20`) contains
  `mcp__session__skills_search` and `mcp__session__skills_read`. Verified by
  set membership. **PASS.**

### F1 (FAIL, separate from a) — advertised slugs are largely NOT readable by `skills_read`

The prompt block is built from `report.eligible` (unconfined), but the
tools runtime catalog (`createNativeSkillsToolRuntime.eligibleCatalog`,
`skills-tool-runtime.ts:55-62`) applies an EXTRA filter
`isWithinRealRoot(skill.path, skillBaseDir(skill))` — it drops every skill
whose realpath escapes its discovered root. `eligibility.ts:15-17` claims the
report is "the single source of truth" for the block AND the tools — it is
not.

Measured (same process, same workspace):

```
eligible_unconfined (report.eligible)   = 5157
runtime_list_confined (runtime.list)    = 1005     ← 4152 dropped
prompt_entries                          = 27
advertised_readable                     = 2
advertised_unreadable                   = 25
unreadable_sample = ["gstack--learn-d29469f78e33-20","gstack--ship-1d6b0790d586-18",
                     "gstack--devex-review-e1c2866c0c89-17"]
```

Reading each advertised slug through the real handler:

```
gstack--learn-d29469f78e33-20 | source=global | inEligible=true | err=true | [ERROR] SKILL_NOT_FOUND: no eligible skill "gstack--learn-d29469f78e33-20" in this workspace.
understand-knowledge          | source=global | inEligible=true | err=false | ## understand-knowledge (understand-knowledge)
```

The slug IS in `report.eligible` and IS advertised by the block, yet
`skills_read` returns `SKILL_NOT_FOUND`. Root cause: these entries are
symlinks under `~/.agents/skills` whose target escapes that root (e.g.
`gstack--learn-…-20 → /tmp/rox-glass-visual/config/skills/…`), so the runtime
catalog drops them while the block still lists them. Repro (focused):

```
bun -e "$(cat /tmp/v3f.mjs)"
```

Suspected files: `packages/shared/src/skills/prompt.ts` (built from an
unconfined catalog) vs
`packages/server-core/src/handlers/rpc/skills-tool-runtime.ts:55-62`
(confinement applied only in the runtime); production caller
`packages/shared/src/agent/omp-agent.ts:582-589`.

Because with `--no-skills` this block is the model's only discovery surface
(`prompt.ts:12-14`), advertising unreadable slugs is the exact failure mode the
file's own docstring warns about — only for slugs, not tool names.

---

## (b) `skills_search` — real hits, correct metadata — PASS

Registered the real runtime (`registerSkillsToolRuntime(createNativeSkillsToolRuntime())`)
and called the real handler `handleSkillsSearch` with a real tool context
(`{ workspacePath: WS }`):

```
## Skills search: "scientific-method"
1 skill(s)

1. **scientific-method** (`scientific-method`)
   source: global
   path: /Users/t/.agents/skills/scientific-method
   Use this skill whenever someone doubts a number, demands rigorous proof …
   > # Scientific Method A working method for discoveries, distilled from real campaigns: …
```

Metadata is real and correct (slug, name, `source`, absolute `path`,
description, ≤240-char body excerpt). No-match path:

```
## Skills search: "zzzznomatchq"
No skills matched.
```

`isError=false` for both. Match is substring over slug/name/description; limit
clamped to `SKILLS_SEARCH_MAX_LIMIT = 25` (`skills-search.ts:17,53`). **PASS.**

Note: hits come from the CONFINED catalog (1005), so the 4152 escaping-symlink
skills of F1 are invisible to search as well.

---

## (c) `skills_read` confinement — PASS

Positive control + two escape attempts, through the real handler:

```
(c) legit success isError false len 23012                 # slug scientific-method
(c) absolute path isError true | [ERROR] INVALID_ARGUMENT: unsafe skill slug "/etc/passwd" — skill slugs never contain path separators, "..", or leading dots.
(c) dotdot isError true        | [ERROR] INVALID_ARGUMENT: unsafe skill slug "../../etc/passwd" — …
(c) isSafeSkillSlug("/etc/passwd") false   isSafeSkillSlug("../../x") false
```

Escaping directory symlink — fixture: `/tmp/v3-ws/skills/esc -> /tmp/v3-evil`
(a real SKILL.md outside the workspace root), plus a legit control
`/tmp/v3-ws/skills/legit-skill`:

```
raw workspace tier slugs: ["legit-skill","esc"]      # esc IS discovered by the raw scan
esc discovered raw? true | esc path /tmp/v3-ws/skills/esc
(c2) list(WS2) slugs: [ … "legit-skill" … ]          # esc absent from the confined list
(c2) runtime.read(esc) => null
(c2) runtime.read(legit-skill) => Legit Skill        # control readable
(c2) handler read(esc) isError true | [ERROR] SKILL_NOT_FOUND: no eligible skill "esc" in this workspace.
```

The raw tier scan DOES discover `esc`, so the `isWithinRealRoot` filter in the
runtime is the load-bearing guard; both the escaping symlink and the
out-of-root absolute path are refused. **PASS.**

---

## (d) Per-slug collision detection — PASS (real collisions found)

`detectSkillCollisions` over the real ordered root plan (each tier scanned
with `loadSkillsFromDir`):

```
collisions total = 392
sample:
 {"name":"acpx--acpx-2e1efc5a8917-7",            "winner":"app-managed","shadowed":["global"]}
 {"name":"agent-browser",                         "winner":"global",     "shadowed":["omp-global"]}
 {"name":"agent-swarm--agent-swarm-orchestration…","winner":"app-managed","shadowed":["global"]}
 {"name":"agents-md",                             "winner":"global",     "shadowed":["omp-global"]}
```

392 real collisions from this store, with the highest-priority tier attributed
as winner (plan is lowest-priority-first; `eligibility.ts:282-303`). The
slug-scoped form `detectSkillCollisionsForSlugs` is exercised by the
`skills:getEligibility` RPC (`skills.ts:118-137`). **PASS.**

---

## (e) Full eligibility pass timing / single-walk claim — FALSIFIED

Code path: a full `buildSkillEligibilityReport` (default
`includeCollisions:true`) walks the catalog via `loadAllSkills` AND,
independently, builds `planScans` by re-scanning EVERY tier with
`loadSkillsFromDir` for collision attribution
(`eligibility.ts:387-393`). So a collision-enabled pass walks the whole store
**twice**; the "deduplicated single walk" only holds inside `loadAllSkills`
(its app-managed dir reuse, `storage.ts:462`), not across the pass.

Decisive isolation (catalog cache warm, so the `loadAllSkills` side is a
cache hit, `storage.ts:296-297`):

```
bun -e "$(cat /tmp/v3c.mjs)"
{"tGlobalAlone":5196, "tAllCold":10951,
 "tReport_noCollisions_warm":86,        ← loadAllSkills cache hit; no tier walk
 "tReport_withCollisions_warm":12365,   ← full independent store walk every pass
 "noColl_eligible":5157, "yesColl_collisions":392}
```

With `includeCollisions:true` the pass costs **12.4 s even with the catalog
cached**; with `includeCollisions:false` it costs **86 ms**. That ~12 s is a
fresh full walk of every tier (global alone = 5.2 s) performed once more per
pass — the walk is NOT deduplicated against the catalog walk.

Cold full-pass wall time (this machine, under the concurrent verify pool, so
noisy):

```
COLD_FULL_PASS_MS 37782  eligible 5157 ineligible 14 collisions 392    (includeCollisions:true)
COLD_NOCOLL_MS    10963  collisions 0                                  (includeCollisions:false)
```

Earlier cold full pass measured 17.5–17.9 s. Either way the collision path
adds a full extra store walk (`planScans`), so **a full-store walk happens
more than once per pass** — the S4 "deduplicated single walk" claim is
falsified for the default (collision-enabled) full scan.

Suspected file: `packages/shared/src/skills/eligibility.ts:387-393`
(`planScans` re-scans tiers already scanned by `loadAllSkills` at line 376).

---

## Verdicts

| claim | verdict |
|---|---|
| (a) block produced, bounded (cap 8000 B, observed ≤7955 B), tool names resolve | **PASS** |
| (a-adjacent F1) advertised slugs resolvable by `skills_read` | **FAIL** — 25/27 advertised slugs unreadable; block uses unconfined catalog, runtime confines. |
| (b) `skills_search` real hits + metadata | **PASS** (over the confined catalog, 1005 entries) |
| (c) read confined (abs path, `..`, escaping symlink refused) | **PASS** |
| (d) per-slug collision detection reports real collisions | **PASS** (392 real) |
| (e) deduplicated single full-store walk per pass | **FAIL** — collision-enabled pass walks every tier twice (~12.4 s vs 86 ms warm). |

## Unproven / not covered

- `skills:getEligibility` RPC + `skills_search`/`skills_read` end-to-end over a
  live server RPC socket were not driven; handlers were called directly with a
  real runtime and real context (the same code path the RPC process registers).
- `report.eligible` count varied run-to-run (5157 / 5160 / 5308) — likely a
  background bundled-skills sync mutating `~/rox/skills` during the runs; the
  F1 invariant (advertised ≫ readable; confined ≪ unconfined) held in all runs.