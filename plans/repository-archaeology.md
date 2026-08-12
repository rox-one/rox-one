# Repository archaeology — Rox program

- **Date:** 2026-08-12
- **Audited from:** the `rox-one/rox-one` checkout (`main` @ `5797f431`) + read-only `gh`/`git` probes of the fork network.
- **Confidence labels:** `VERIFIED` (command output), `FUNCTIONAL`, `PARTIAL`, `SOURCE_GAP` (could not access), `UNKNOWN`.

## 0. Canonical-repo determination (evidence over naming)

The program brief names `agisota/rox-one` as the destination. That premise does
**not** hold against evidence:

| Repo | Accessible? | Evidence | Verdict |
|---|---|---|---|
| `agisota/rox-one` | **NO (404)** | `gh repo view agisota/rox-one` → "Could not resolve to a Repository" | `SOURCE_GAP` — does not exist / not visible |
| `rox-one/rox-one` | **YES** | checked-out `origin`; fork of `agisota/craft-agents-oss`; pushed 2026-08-12; 2 open PRs; tags to v0.11.5 | **CANONICAL destination** (this repo) |
| `agisota/craft-agents-oss` | YES | fork of `craft-ai-agents/craft-agents-oss`; `main` HEAD `5797f43` == `rox-one/rox-one` main | Donor / same code line |
| `craft-ai-agents/craft-agents-oss` | YES | upstream (v0.11.4, `50ffa14`) | Upstream baseline |
| `agisota/rox-one-website` | YES | not a fork; branches match the brief's "rox-one-website" list; has env PR #8 | Related product (website) |
| `rox-one/rox-one-website` | **NO (404)** | `gh repo view` → cannot resolve | `SOURCE_GAP` |

**Reconciliation of the brief's branch lists** (they map to *accessible* repos,
just under different owners):

- The brief's "`agisota/rox-one` … `craft-agents-oss`" branch list
  (`feat/shell-ext-activate2`, `fix/electron-renderer-node-shims`,
  `fix/renderer-node-polyfills`, `fix/renderer-review-followup`,
  `fix/rox-connect-onboarding-followup`, `fix/sandbox-env-strip`,
  `fix/sessions-fr38-fr47`, `fix/sessions-list-shared-filters`,
  `fix/test-pollution-fetches`) is an **exact match** for the branches on
  `agisota/craft-agents-oss` (VERIFIED via `gh api .../branches`).
- The brief's "`rox-one-website`" branch list
  (`cursor/setup-cloud-agent-env-7cfc`, `feat/redesign-rc7`,
  `mac/rox-live-release-feeds`, `rox/zed-settings-docs-a7e9`, dependabot, `main`)
  is an **exact match** for `agisota/rox-one-website` (VERIFIED).
- The brief's Huly line (`feat/huly-vendor`, `fix/electric-proxy-auth`,
  "Huly vendoring", Electric/Postgres/Turbo/Caddy) exists in **none** of the
  accessible repos. `SOURCE_GAP` — either it lives in an inaccessible repo or it
  is aspirational. The accessible `rox-one/rox-one` is the **craft-agents
  Bun/Electron/headless-server agent product**, not a Huly-based Electric/Postgres
  app. See `plans/rox-current-state-audit.md` §Target-stack reconciliation.

## 1. Prior art — do not duplicate

- **`rox-one/rox-one` PR #2** — "Integration audit: product-surface inventory,
  OMP docs-vs-impl, Craft-vs-Rox comparison" (branch `cursor/integration-audit-7c33`,
  OPEN, author agisota). Adds `plans/integration-audit.md` (430 lines), a
  live-verified 60-surface truth inventory. **This is the Section-5 "Rox Truth
  Inventory" deliverable — it already exists.** This program builds on it and
  does not re-inventory surfaces.
- **`agisota/rox-one-website` PR #8** — "chore(env): add Cloud Agent development
  environment" (branch `cursor/setup-cloud-agent-env-7cfc`, DRAFT). The website's
  Cloud Agent env work is already in flight — **do not create a duplicate**
  website `.cursor/environment.json`.

## 2. `rox-one/rox-one` branch reconciliation

~87 remote branches. A full `git rev-list --count origin/main..origin/<b>` sweep
shows the large families are **already merged** (0 commits ahead of `main`) with
stale tips left behind. Only the branches below carry commits not on `main`.

| Branch | Base | Ahead of main | Purpose | Merged? | Unique work? | Keep/Merge/Port/Delete | Evidence |
|---|---|---|---|---|---|---|---|
| `feature/pr-*` family (~80: pr-663…pr-1005) | main | **0** (spot-checked pr-966/989/1005/874 = 0) | Upstream PR bulk-port pipeline (`integration/2026-08-06-pr-bundle`) | **Yes** | No | **Delete** (prune) | `rev-list --count` = 0 ahead |
| `feat/runtime-context-finish` | main | **0** | Runtime-context marketplace | Yes | No | **Delete** | `154 0` |
| `feat/p4-siyuan-surfaces` | main | **18** | SiYuan surfaces: local kernel bootstrap, local FTS MVP, flashcard/plugins modes, post-P4 UX/route/kanban fixes | Partial | **Yes (largest residual)** | **Port/triage** — reconcile vs audit §3.3 "P4 merged" claim | `git log origin/main..` (2e330a89, ae903aa3, 82c0a415, d750938e) |
| `feat/knowledge-p3-writeback` | main | 4 | P3 safe write-back + type convergence (#8) + audit fixes | Mostly | Partial (merge/rebase noise) | **Triage** | 4254ed2a merge + f62dc21d |
| `feat/knowledge-p4-distill` | main | 3 | Distill residuals | Mostly | Partial | Triage | 3 ahead |
| `feat/knowledge-type-convergence` | main | 3 | core↔wire type convergence residuals | Mostly | Partial | Triage | 3 ahead |
| `feat/knowledge-p5-views` / `p6-automations` / `p7-prep` / `w2-knowledge-mode` / `p1-provider` | main | 1–2 each | Knowledge series stale tips | Yes (bulk on main) | Minor | Delete after triage | 1–2 ahead |
| `feat/shell-w1-scaffold` | main | 3 | Unified-shell W1 residuals | Mostly | Partial | Triage | 3 ahead |
| `feat/shell-w3-omnibox` | main | 2 | W3 residuals | Mostly | Minor | Triage/Delete | 2 ahead |
| `feat/shell-w4-identity` / `w5-extension` / `w6-bridge` / `w6-residuals` / `plugin-feed` | main | 1 each | Shell wave stale tips | Yes (bulk on main) | Minor | Delete after triage | 1 ahead |
| `fix/sandbox-env-strip` | main | 2 | Strip host python/uv cache vars from non-python runtime env; test/script fixes | No | **Yes (small real fix)** | **Port/cherry-pick** (security-adjacent) | 56f62551, c437804e |
| `fix/test-pollution-fetches` | main | 1 | Restore global fetch after oauth test stubs; path-style fixes | No | Yes (test hygiene) | **Port/cherry-pick** (same commit as sandbox-env-strip's c437804e) | c437804e |
| `spec/unified-shell` | main | 1 | Unified-shell spec doc | Doc-only | Yes (doc) | Keep/merge as docs | 1b3ef9e0 |
| `spec/knowledge-integration` | main | 1 | SiYuan-integration PRD suite doc | Doc-only | Yes (doc) | Keep/merge as docs | 8b87537c |
| `cursor/integration-audit-7c33` | main | 2 | Integration audit (PR #2) | In review | Yes | **Merge (PR #2)** | this program depends on it |
| `dependabot/.../server-core/...` | main | 1 | npm bump (PR #1) | No | Yes (dep) | Review/merge | PR #1 |

**Net branch-hygiene action:** prune the ~80 fully-merged `feature/pr-*` tips and
the 0-ahead `feat/*` tips; run a one-time triage on the residual `feat/knowledge-*`,
`feat/shell-*`, and especially `feat/p4-siyuan-surfaces` (18 commits) before
deleting; cherry-pick-verify `fix/sandbox-env-strip` + `fix/test-pollution-fetches`.

## 3. `agisota/craft-agents-oss` (donor / same code line)

`main` HEAD == `rox-one/rox-one` `main` (`5797f43`). It is not a separate product
— it is the same line. Its 9 non-`main` branches are the brief's "craft-agents-oss"
list; per PR #2 §5.4 these are merged-PR leftovers or small superseded follow-ups
(e.g. `fix/sessions-fr38-fr47` == merged PR #64; renderer-shim / rox-connect /
shared-filters branches carry small deltas vs earlier commits already on `main`).

| Verdict | Action |
|---|---|
| Same commit as destination | Treat as **legacy mirror**; do not fork work here |
| 9 residual branches | One-time triage (port the 1–2 genuinely-unmerged fixes such as `fix/sandbox-env-strip`; archive the rest); then **archive the repo** |

## 4. `agisota/rox-one-website` (related product)

Astro website; source-of-truth for Rox Connect device APIs / better-auth / cabinet
(per `docs/ROX_CLOUD_CONNECT.md`). Out of scope for `rox-one/rox-one` code changes.

| Branch | State | Action |
|---|---|---|
| `main` | active | Track (Connect contract dependency) |
| `cursor/setup-cloud-agent-env-7cfc` | **PR #8 DRAFT** (env) | **Do not duplicate**; let PR #8 land |
| `feat/redesign-rc7` | open | Owner-driven; ignore here |
| `mac/rox-live-release-feeds` | open | Release-feeds; ignore here |
| `rox/zed-settings-docs-a7e9` | **PR #7 DRAFT** | Owner-driven; ignore here |
| `dependabot/...` (astro bump) | **PR #6** | Owner-driven |

## 5. Tags / releases

`rox-one/rox-one` tags run through `v0.8.x`…`v0.11.5` (self-versioned; upstream is
v0.11.4). Release tooling is `scripts/release.ts` + `scripts/oss-sync.ts`. No
GitHub Releases were probed (out of scope for this pass) — `UNKNOWN`.

## 6. SOURCE_GAPs to resolve before deeper program work

1. `agisota/rox-one` (brief's stated destination) is unreachable — confirm whether
   it exists (private/renamed) or the brief conflated it with `rox-one/rox-one`.
2. The Huly / Electric / Postgres / Turbo / Caddy "target stack" is absent from all
   accessible repos — confirm whether it is a separate (inaccessible) product or a
   future direction. Until then, planning targets the actual craft-agents stack.
3. `rox-one/rox-one-website` (private) — Rox Connect / billing contract can only be
   audited from the desktop side (see PR #2 §3.7.8).
