# Rox remediation board

- **Date:** 2026-08-12 · **Base:** `main` `5797f431` · **Lead:** integration agent
- **Source of findings:** `plans/integration-audit.md` (PR #2) — the audit; **not** repeated here.
- **Related:** `plans/repository-archaeology.md`, `plans/rox-current-state-audit.md`, `plans/session-domain-convergence.md` (PR #3).
- **Rule:** subagents implement in isolated worktrees/branches; they do **not** merge to `main`. The lead reviews every diff (two-axis `code-review`), re-runs tests independently (`verification-before-completion` — no completion claim without fresh evidence), then integrates.

## Skills inventory (available in this environment)

- Repo bundled `apps/electron/resources/skills/superpowers/`: `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `using-git-worktrees`, `subagent-driven-development`, `dispatching-parallel-agents`, `requesting-code-review`, `receiving-code-review`.
- `~/.agents/skills/`: `diagnosing-bugs`, `code-review`, `implement`, `executing-plans`, `resolving-merge-conflicts`, `verification-before-completion`, `finishing-a-development-branch`, `receiving-code-review`, …
- Cursor env skills: `env-setup`, `migrate-to-builds`.
- No dedicated "threat-modeling/security" SOP skill exists → security workstreams use `code-review` (security lens) + `test-driven-development` with explicit negative tests.

## Workstream → skill → subagent → branch map

| WS | Scope | Primary skill(s) | Branch | Owner | Wave |
|---|---|---|---|---|---|
| **A** | OMP first-run lifecycle: typed startup errors, no hang, exit `processing`; `queryLlm` model honesty | systematic-debugging + TDD + verification | `fix/p0-omp-first-run` | Subagent A | 1 |
| **B** | Viewer share auth: owner capability for PUT/DELETE, public GET, CORS, legacy policy, tests | code-review(security) + TDD + verification | `security/p0-viewer-share-auth` | Subagent B | 1 |
| **C** | Knowledge agent tools (`search`/`read`/`get_backlinks`) w/ 3-backend parity, permissions, bounded, provenance (Mission-1 slice only) | implement + TDD + verification | `feat/knowledge-runtime-completion` | Subagent C | 1 |
| **D** | Rox identity: user-visible branding/i18n now; migration plan for `~/.craft-agent`/`CRAFT_*`/`@craft-agent/*`/`craftagents://`/appId | migration-planning + i18n | `fix/rox-identity-coherence` | Subagent D | 2 |
| **E** | MCP/sources: SSE truthful (implement or demote), `resolveStdioConfig` normalization, host-tool proxy regression test, legacy MCP classification | protocol impl + integration testing | `fix/mcp-runtime-contract` | Subagent E | 2 |
| **F** | Secrets: `SecretProvider` (LocalEncrypted/Environment/Infisical) scoped injection + redaction — functional vertical slice, no stub UI | secure-secrets + architecture | `feat/secrets-provider-runtime` | Subagent F | 2 |
| **G** | Collections (persist filters, list LexoRank drag, grouping, dedupe bulk UI) + Shell (PanelHost decision, browser verify) → `ENABLE_DEFAULT`/`KEEP_EXPERIMENTAL`/`BLOCKED` | frontend-state + browser-testing | `fix/collections-shell` | Subagent G | 3 |
| **H** | Docs drift fixes + `plans/branch-disposition.md` (MERGED/SUPERSEDED/UNIQUE_DELTA/PORT/KEEP/SAFE_TO_DELETE) | git-archaeology + docs | `chore/repo-hygiene` | Subagent H | 3 |

## File-ownership map (conflict avoidance)

| Owner | Owns | High-conflict shared files (coordinate; patch-recommendation only) |
|---|---|---|
| A | `packages/shared/src/agent/omp-agent.ts`, new omp error types, agent lifecycle tests | `SessionManager.ts` (error surfacing — A owns the OMP path; others patch-recommend) |
| B | `apps/viewer/**` (Pages Functions/share API) + desktop share caller (small) | — |
| C | `packages/core/src/knowledge/**`, `packages/server-core/src/knowledge/**`, knowledge RPC/tools/UI wiring | `session-tool-defs.ts` / `SESSION_TOOL_REGISTRY` (C owns knowledge-tool additions; E owns MCP proxy changes — split by tool) |
| E | `packages/shared/src/mcp/**`, sources RPC/config | shared session-tool registry (split with C) |
| F | `credentials/`, new secret-provider module, subprocess env injection | `omp-agent.ts`/`options.ts` spawn env (coordinate with A) |
| G | collection renderer/state, unified-shell renderer, `PanelHost` | protocol DTOs (coordinate if touched) |
| D | branding/i18n/onboarding | avoid core runtime files |
| H | `docs/**`, `AGENTS.md`, branch analysis only | — |

Do not allow parallel blind edits to `SessionManager.ts`, shared protocol DTOs, or global config — one owner, others submit patch recommendations integrated centrally.

## Execution matrix (updated as branches land)

| WS | Branch | Commit(s) | Status | Tests added | Lead re-verified | PR |
|---|---|---|---|---|---|---|
| A | `fix/p0-omp-first-run` | — | RUNNING | — | — | — |
| B | `security/p0-viewer-share-auth` | — | RUNNING | — | — | — |
| C | `feat/knowledge-runtime-completion` | — | RUNNING | — | — | — |
| D–H | see map | — | QUEUED (waves 2–3) | — | — | — |

## Lead review gate (per branch, before integration)

1. Inspect full diff (`git diff main...<branch>`); confirm in-scope per ownership map.
2. Security implications (esp. B, F, E env handling, subprocess env, logging/redaction).
3. Re-run the branch's tests **myself** (verification-before-completion — no trust of reports).
4. Test quality: red-green (revert fix → test must fail), no false-greens (Reviewer 4's job later).
5. Errors actually surfaced + session leaves `processing` (A); bounded typed failures everywhere.
6. Migration/back-compat (B legacy shares; D identity; C persistence).
7. Reject superficial fixes; send back with concrete comments or assign a follow-up subagent.

## Integration & second-wave plan

`main` → integration branch (`cursor/rox-remediation-a5eb`) ← reviewed A/B/C, then D–H. Then fresh independent reviewers (did not write the code): (R1) integration/build/boot/CLI/persistence, (R2) browser UX incl. error states, (R3) security regression on changed attack surfaces only, (R4) test-adversary for false-greens. Then Wave 5 fresh-machine E2E incl. all negative paths → each must end in bounded typed failure + recoverable idle state (never permanent spinner / silent hang / processing-forever).

## Status

- **Wave 1 launched** (A, B, C) in isolated worktrees. Lead review + integration on completion.
- Waves 2–3 (D–H) sequenced after Wave 1 integrates, to keep conflicts on shared files (`SessionManager`, session-tool registry, spawn env) centrally coordinated.
