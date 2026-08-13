# Branch Disposition — rox-one/rox-one + agisota/craft-agents-oss (donor)

- **Date:** 2026-08-12
- **Base:** `origin/main` @ `5797f431` (rox-one/rox-one). Donor `agisota/craft-agents-oss` `main` == same commit (verified: donor mirror `refs/heads/main` resolves to the same history; see `plans/integration-audit.md` §1).
- **Method:** for every remote branch — `git merge-base --is-ancestor <branch> origin/main`, `git rev-list --left-right --count origin/main...<branch>`, `git diff --shortstat origin/main...<branch>` (three-dot = branch's own delta), `git cherry [-v] origin/main <branch>` (`-` = patch-equivalent on main, `+` = not), and for squash-merge candidates a tip-tree vs merge-commit-tree comparison (`git diff <branch> <mergeCommit> --shortstat`). PR merge evidence from `gh pr list --repo agisota/craft-agents-oss --state merged` (donor holds the PR history; rox-one has only PRs #1–#5, all open).

## Classes

| Class | Meaning |
|---|---|
| MERGED | Tip is an ancestor of `main`, or content verified on `main` (patch-equivalence / identical tree to the squash merge commit) |
| SUPERSEDED | A newer variant landed on `main`; residual delta is stale/outdated, not unique work |
| UNIQUE_DELTA | Has real content not on `main` |
| PORT | Part of the `feature/pr-NNN-*` upstream-port pipeline |
| KEEP | Active line (open PR or current work) |
| SAFE_TO_DELETE | Merged or superseded with no unique content |
| UNKNOWN | Cannot determine (none in this audit) |

---

## 1. rox-one/rox-one — feature-series branches (feat/*, spec/*, fix/*)

All evidence commands run against `origin/main` @ `5797f431`.

| Branch | Class | Cleanup | Evidence |
|---|---|---|---|
| `feat/knowledge-p1-provider` | MERGED → SAFE_TO_DELETE | delete | `git cherry origin/main origin/feat/knowledge-p1-provider` → `- fb81c539` (patch-equivalent); squash merge `93f83500` (donor PR #4) is ancestor of main |
| `feat/knowledge-w2-knowledge-mode` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- eabe6724`; squash `1a4e7a72` (PR #6) on main |
| `feat/knowledge-p3-writeback` | MERGED → SAFE_TO_DELETE | delete | tip tree **identical** to squash `ddc4bb3d` (PR #7): `git diff origin/feat/knowledge-p3-writeback ddc4bb3d --shortstat` → empty. (`git cherry` shows `+` because squash merge changes patch-ids) |
| `feat/knowledge-type-convergence` | MERGED → SAFE_TO_DELETE | delete | tip tree identical to `98dabff8` (PR #8 squash). Note: `98dabff8` itself is **not** an ancestor of main (stacked PR merged into the p3-writeback line), but content comparison vs main shows main is a superset (main has +1414 lines more in the touched knowledge files incl. later P4 publications) |
| `feat/knowledge-p4-distill` | MERGED → SAFE_TO_DELETE | delete | squash `cbd36712` (PR #9) on main; branch-only residue vs main sampled = 2 stale comment lines in `channels.ts` + pre-rebase file states |
| `feat/knowledge-p5-views` | MERGED → SAFE_TO_DELETE | delete | squash `181c33f6` (PR #10) on main; branch-only residue sampled = outdated locale strings (e.g. old `workspace.underDefaultFolder` translations since rewritten on main) |
| `feat/knowledge-p6-automations` | MERGED → SAFE_TO_DELETE | delete | squash `4d26a509` (PR #11) on main; residue = pre-rebase snapshots (`HANDLED_CHANNELS` count 32, superseded by later sync commit `51a8627b` on main) |
| `feat/knowledge-p7-prep` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 800d5eb4`; squash `6ef918ad` (PR #12) on main |
| `feat/p4-siyuan-surfaces` | MERGED → SAFE_TO_DELETE | delete | all 18 branch commit subjects found verbatim in `git log origin/main` (e.g. `P4.4 migrate Craft notes vault` → `8837bcbf`/`e1be9269`, `local FTS index MVP` → `1482de56`); landed via PR #23 (`a156d8ba`, ux P0–P3) + PR #24 (`391c4653`, knowledge P4 surfaces) |
| `feat/shell-w1-scaffold` | MERGED → SAFE_TO_DELETE | delete | tip tree identical to squash `bf82a197` (PR #5) |
| `feat/shell-w3-omnibox` | MERGED → SAFE_TO_DELETE | delete | tip tree identical to squash `e2db510b` (PR #13) |
| `feat/shell-w4-identity` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 663fe9f5`; squash `8675f7fc` (PR #14) on main |
| `feat/shell-w5-extension` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 20799148`; squash `393f3c57` (PR #16) on main |
| `feat/shell-w6-bridge` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 5c4fc4fa`; squash `48ed532b` (PR #17) on main |
| `feat/shell-w6-residuals` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 964b11d5`; squash `0b27d5b5` (PR #18) on main |
| `feat/shell-plugin-feed` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 15db8621`; squash `53e4bac3` (PR #19) on main |
| `feat/runtime-context-finish` | MERGED → SAFE_TO_DELETE | delete | tip is ancestor of main (`merge-base --is-ancestor` true; 0 ahead / 154 behind) |
| `spec/knowledge-integration` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 8b87537c`; squash `5e5a789a` (donor PR #2) on main; tip-to-tip diff on touched files: main strictly newer (9 lines) |
| `spec/unified-shell` | MERGED → SAFE_TO_DELETE | delete | `git cherry` → `- 1b3ef9e0`; squash `74293d01` (PR #3) on main; tip-to-tip diff on touched files **empty** |
| `fix/sandbox-env-strip` | SUPERSEDED → SAFE_TO_DELETE | delete | 2 commits ahead: `56f62551` is patch-equivalent to `7e483de5` on main (`git cherry` `-`); the shared `c437804e` landed on main in evolved form (see next row) |
| `fix/test-pollution-fetches` | SUPERSEDED → SAFE_TO_DELETE | delete | sole unique commit `c437804e` (fetch-stub restore, koffi warning, Windows path semantics): main already contains all three in evolved form — `oauth-callback-url.test.ts:13-19` has the `afterAll` restore with the same comment, `mode-manager.ts:177` has the drive-letter/UNC comment; residual branch-vs-main diff on the touched files = comment wording only (main newer) |
| `integration/2026-08-06-pr-bundle` | MERGED → SAFE_TO_DELETE | delete | tip is ancestor of main (0 ahead / 277 behind) — the port bundle is fully landed |
| `obalint/feb-5` | MERGED → SAFE_TO_DELETE | delete | tip is ancestor of main (0 ahead / 596 behind; tip `27b63aea` "v0.3.4") |
| `dependabot/npm_and_yarn/packages/server-core/npm_and_yarn-e190a37596` | KEEP (while PR open) | keep | open PR rox-one#1; 1 ahead (+2/−2 dep bump) / 149 behind; dependabot-managed |

## 2. rox-one/rox-one — `feature/pr-NNN-*` port family (62 branches, grouped)

**Group classification: PORT — all 62 are MERGED (tips are ancestors of `main`) → SAFE_TO_DELETE.**

Method: `git merge-base --is-ancestor origin/feature/pr-* origin/main` returned true for every branch, and `git rev-list --left-right --count origin/main...<branch>` shows `0 ahead` for all 62 (behind 471–522). Spot-check that these are upstream-port branches: upstream PR #663 ("Add optional workspace icon rail") is still OPEN upstream, yet `feature/pr-663-workspace-icon-rail` is an ancestor of rox main — the pipeline merged ports into main and left the branch tips behind. (This corrects the earlier audit line "several `feature/pr-*` branches remain unmerged" — as of 2026-08-12 every `feature/pr-*` tip is reachable from `main`.)

| Branch | Class | Evidence (ahead/behind, ancestor) |
|---|---|---|
| `feature/pr-663-workspace-icon-rail` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-665-turn-complete-notifications` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-667-context-overflow-classify` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-669-undo-slash-command` | PORT → MERGED → SAFE_TO_DELETE | 0/518, ancestor |
| `feature/pr-673-ask-mode-self-mgmt-hang` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-675-zh-hans-strings` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-685-dedupe-model-dropdown` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-688-router-hardening` | PORT → MERGED → SAFE_TO_DELETE | 0/520, ancestor |
| `feature/pr-694-i18n-sync-title-gen` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-713-preferences-notes-pi` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-721-notes-vault` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-724-i18n-sync-startup` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-728-default-zoom-level` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-735-hierarchical-switcher` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-750-custom-endpoint-protocol` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-752-custom-endpoint-ui` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-753-dedupe-toolcall-ids` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-762-contextwindow-pi-catalog` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-764-ime-composition-race` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-765-ime-placeholder-overlay` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-768-mcp-custom-headers` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-779-telegram-final-messages` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-781-zh-hant` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-786-sidebar-label-counts` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-789-skills-symlink-discovery` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-805-server-side-source-retry` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-813-anthropic-compat` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-819-fr-locale` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-821-refresh-models-reauth` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-822-masked-api-key-edit` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-836-macos-dock-icon` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-845-wechat-ilink` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-848-dist-bundle-subprocess` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-851-craft-config-dir` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-860-branch-session-register` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-861-browser-pane-preflight` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-863-ime-autocapitalize` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-865-mcp-toolname-sanitize` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-871-windows-system-proxy` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-874-pi-ai-fork` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-889-confirm-delete-workspace` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-890-per-group-pagination` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-917-multi-subscription` | PORT → MERGED → SAFE_TO_DELETE | 0/520, ancestor |
| `feature/pr-918-relative-path-sources` | PORT → MERGED → SAFE_TO_DELETE | 0/519, ancestor |
| `feature/pr-919-model-activity-expanded` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-934-fix-ci-baseline` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-945-percent-encoded-links` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-950-ssh-remote-workdir` | PORT → MERGED → SAFE_TO_DELETE | 0/500, ancestor |
| `feature/pr-952-i18n-builtin-status-labels` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-956-strip-claudecode-env` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-957-disable-growthbook` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-958-oauth-abandoned-fix` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-960-discord-channel` | PORT → MERGED → SAFE_TO_DELETE | 0/511, ancestor |
| `feature/pr-962-zh-hant-keys` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-964-eslint-rules-tests` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-966-ios-client` | PORT → MERGED → SAFE_TO_DELETE | 0/471, ancestor |
| `feature/pr-974-copilot-gpt56` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-989-kimi-k3` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |
| `feature/pr-990-vps-browser` | PORT → MERGED → SAFE_TO_DELETE | 0/520, ancestor |
| `feature/pr-994-excluded-filter-inheritance` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-996-openai-empty-toolcalls` | PORT → MERGED → SAFE_TO_DELETE | 0/521, ancestor |
| `feature/pr-1005-dockerfile-server` | PORT → MERGED → SAFE_TO_DELETE | 0/522, ancestor |

## 3. rox-one/rox-one — active remediation/audit lines (KEEP)

| Branch | Class | Evidence |
|---|---|---|
| `main` | KEEP | base branch |
| `chore/repo-hygiene` | KEEP | this workstream (docs + this disposition) |
| `cursor/integration-audit-7c33` | KEEP | open PR rox-one#2; unique content: `plans/integration-audit.md` (+430) — the audit this document builds on |
| `cursor/rox-program-p0-archaeology-env-a5eb` | KEEP | open PR rox-one#3; UNIQUE_DELTA (intentional): `.cursor/environment.json`, `docs/cloud-agents/environment.md` (+149), `plans/repository-archaeology.md` (+126), `plans/rox-current-state-audit.md` (+111), `plans/session-domain-convergence.md` (+169) |
| `cursor/rox-remediation-a5eb` | KEEP | open PR rox-one#4; `plans/remediation-board.md` (+69) |
| `rox-integration-remediation-7c33` | KEEP | open PR rox-one#5 (integration branch for the remediation program); 3 ahead, `plans/remediation-board.md` (+66) |

## 4. Donor repo `agisota/craft-agents-oss` — donor-only branches (7)

Donor `main` == rox `main` (`5797f431`). `fix/sandbox-env-strip` and `fix/test-pollution-fetches` exist in **both** repos (classified in §1). Verification run from the rox worktree with `donor/` remote refs.

| Branch | Class | Cleanup | Evidence |
|---|---|---|---|
| `fix/sessions-fr38-fr47` | MERGED → SAFE_TO_DELETE | delete | tip is ancestor of main (0 ahead / 1 behind); PR #64 merge `5797f431` **is** current main HEAD |
| `fix/renderer-review-followup` | MERGED → SAFE_TO_DELETE | delete | tip tree identical to squash `9f11bfd9` (PR #63): `git diff donor/fix/renderer-review-followup 9f11bfd9 --shortstat` → empty |
| `fix/rox-connect-onboarding-followup` | MERGED → SAFE_TO_DELETE | delete | tip tree identical to squash `44e32db3` (PR #61) → empty diff |
| `fix/renderer-node-polyfills` | MERGED → SAFE_TO_DELETE | delete | squash `e50d539d` (PR #62, on main) is a **superset** of the branch: `git diff e50d539d donor/fix/renderer-node-polyfills` shows only deletions (127 lines in squash absent from branch = onboarding test/routing lines main got via PR #61). Nothing on the branch is missing from main |
| `fix/sessions-list-shared-filters` | SUPERSEDED → SAFE_TO_DELETE | delete | `c811ceed` patch-equivalent on main (PR #54 squash `cb3e7eb0`); the review-followup commit `bcc0a645` ("address PR #54 cubic review") landed via PR #56 (`de08bb86`, on main, same subject). Residual vs current main on the 2 touched files = outdated barrel import path (`@craft-agent/shared/sessions` vs main's `.../sessions/collection`) and missing newer multi-select effects — main strictly newer |
| `fix/electron-renderer-node-shims` | SUPERSEDED → SAFE_TO_DELETE | delete | earlier variant of the PR #62 fix: branch `node-stub.ts` 136 lines vs main's evolved 194 lines; branch commits dated 2026-08-08, squash `e50d539d` 2026-08-09 (newer). Same-file diff vs main is main-side growth |
| `feat/shell-ext-activate2` | SUPERSEDED (small test-only residual) | triage-then-delete | the feature is on main: `extensionHost:listCommands` at `packages/shared/src/protocol/channels.ts:341` + `apps/electron/src/main/handlers/extension-host.ts:177` (via PRs #42 `32eafa48` / #44 `7e9d3628`). **Unique residual:** `apps/electron/src/main/extension-host/__tests__/worker-list-commands.test.ts` (142 lines) does not exist on main (`git show origin/main:...worker-list-commands.test.ts` → "does not exist"). If that worker-level test coverage is wanted, port the test file first; otherwise delete |

---

## 5. PROPOSED cleanup commands (NOT executed)

Everything below is a **proposal** — review and run manually. Order: donor branches first (donor archival), then rox-one. Branches with open PRs (§3, dependabot) are intentionally excluded.

Ticket 14 binding: [plans/next-program/decisions/006-branch-deletion.md](./next-program/decisions/006-branch-deletion.md) — **do not execute** these deletes until a human ports or discards the 142-line `worker-list-commands.test.ts` residual and runs §5 themselves. Agents must not `git push --delete` remotes.

### Donor repo `agisota/craft-agents-oss`

```bash
# PROPOSED — donor merged branches
git push https://github.com/agisota/craft-agents-oss --delete \
  fix/sessions-fr38-fr47 \
  fix/renderer-review-followup \
  fix/rox-connect-onboarding-followup \
  fix/renderer-node-polyfills \
  fix/sessions-list-shared-filters \
  fix/electron-renderer-node-shims

# PROPOSED — after deciding the fate of the 142-line worker-list-commands test
# (port it to rox-one first if wanted), then:
git push https://github.com/agisota/craft-agents-oss --delete feat/shell-ext-activate2

# PROPOSED — donor duplicates of rox-one branches (see §1 for classification)
git push https://github.com/agisota/craft-agents-oss --delete \
  fix/sandbox-env-strip \
  fix/test-pollution-fetches
```

### rox-one/rox-one — feature series + specs + fixes

```bash
# PROPOSED — knowledge series (all squash-merged, donor PRs #4,#6-#12 + #23/#24)
git push origin --delete \
  feat/knowledge-p1-provider \
  feat/knowledge-w2-knowledge-mode \
  feat/knowledge-p3-writeback \
  feat/knowledge-type-convergence \
  feat/knowledge-p4-distill \
  feat/knowledge-p5-views \
  feat/knowledge-p6-automations \
  feat/knowledge-p7-prep \
  feat/p4-siyuan-surfaces

# PROPOSED — shell series (squash-merged, donor PRs #5,#13,#14,#16-#19)
git push origin --delete \
  feat/shell-w1-scaffold \
  feat/shell-w3-omnibox \
  feat/shell-w4-identity \
  feat/shell-w5-extension \
  feat/shell-w6-bridge \
  feat/shell-w6-residuals \
  feat/shell-plugin-feed

# PROPOSED — misc merged/superseded
git push origin --delete \
  feat/runtime-context-finish \
  spec/knowledge-integration \
  spec/unified-shell \
  fix/sandbox-env-strip \
  fix/test-pollution-fetches \
  integration/2026-08-06-pr-bundle \
  obalint/feb-5
```

### rox-one/rox-one — `feature/pr-*` port family (all 62, ancestors of main)

```bash
# PROPOSED — generated; deletes all 62 feature/pr-* branches
git branch -r --format='%(refname:short)' \
  | grep '^origin/feature/pr-' \
  | sed 's|^origin/||' \
  | xargs -n 20 git push origin --delete
```

### Not proposed for deletion

`main`, `chore/repo-hygiene`, `cursor/integration-audit-7c33`, `cursor/rox-program-p0-archaeology-env-a5eb`, `cursor/rox-remediation-a5eb`, `rox-integration-remediation-7c33` (open PRs #2–#5), `dependabot/npm_and_yarn/packages/server-core/npm_and_yarn-e190a37596` (open PR #1).

## 6. Counts

| Scope | MERGED | SUPERSEDED | UNIQUE_DELTA (intentional, KEEP) | KEEP (active) | UNKNOWN |
|---|---|---|---|---|---|
| rox-one feature series + misc (§1) | 21 | 2 | 0 | 1 (dependabot) | 0 |
| rox-one `feature/pr-*` (§2) | 62 | 0 | 0 | 0 | 0 |
| rox-one active lines (§3) | — | — | 1 (`cursor/rox-program-p0-archaeology-env-a5eb`) | 5 + main + this branch | 0 |
| donor-only (§4) | 4 | 3 | 0 (see shell-ext-activate2 residual note) | 0 | 0 |

**SAFE_TO_DELETE total: 85 rox-one branches (21 + 2 + 62) + 9 donor branches (7 donor-only + 2 shared `fix/*`).**
