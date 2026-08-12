# Rox — Remediation Board

Source: `plans/integration-audit.md` (2026-08-12). Integration branch: `rox-integration-remediation-7c33` (from `main` @ `5797f431`; PR #5). NOTE: repo PR policy requires the `rox` branch prefix — subagent branches must be pushed as `rox/<name>` for their own PRs; workstream branch names below are the local/logical names.
Lead agent owns: integration, review gate, cross-cutting verification, final release test.

## Skill inventory (available in this environment)

From `~/.agents/skills` (bundled packs: superpowers, mattpocock-skills, vercel-agent-skills, vercel-next-skills, craft-knowledge) — used where they materially improve execution:

| Skill | Role in this program |
|---|---|
| `systematic-debugging` | A (OMP first-run), E (MCP contract), Wave-4 reviewers |
| `test-driven-development` | All implementation subagents (RED→GREEN mandatory) |
| `verification-before-completion` | All subagents + lead review gate (evidence before claims) |
| `using-git-worktrees` | Lead: isolation topology (native `best-of-n-runner` worktrees) |
| `dispatching-parallel-agents` | Lead: Wave 1–3 parallel dispatch |
| `code-review` | Lead review gate per returned branch (standards + spec axes) |
| `implement` | C/E/F/G feature workstreams (spec-driven implementation) |
| `diagnosing-bugs` | Wave-4 test adversary |
| `finishing-a-development-branch` | Per-branch close-out (merge into integration branch) |
| `writing-plans` / `executing-plans` | H (docs/branch disposition) |
| `knowledge-distill`, `research-and-publish` | C (knowledge skills contract alignment) |
| `react-best-practices` | D/G frontend work |
| `resolving-merge-conflicts` | Lead integration |
| Cursor-native: `security-review`, `bugbot`, `computerUse` (browser QA) | Wave-4 reviewers |

## File ownership map (conflict avoidance)

| Owner | Exclusive files | Notes |
|---|---|---|
| A (OMP) | `packages/shared/src/agent/omp-agent.ts`, `packages/shared/src/agent/__tests__/omp-*`, `packages/shared/src/agent/errors.ts` (additive only) | Must NOT touch `SessionManager.ts`; error surfacing via existing `typed_error`/`error` AgentEvents |
| B (Viewer) | `apps/viewer/**` (functions, src), `packages/server-core/src/sessions/SessionManager.ts` share-online call sites ONLY (patch recommendation if wider) | No production share data touched |
| C (Knowledge) | `packages/core/src/knowledge/**`, `packages/server-core/src/knowledge/**`, `packages/server-core/src/handlers/rpc/knowledge.ts`, `packages/session-tools-core/**` (knowledge tools), `apps/electron/src/renderer/knowledge/**`, `apps/electron/src/renderer/pages/Knowledge*`, `apps/electron/src/renderer/pages/settings/KnowledgeSettingsPage.tsx` | Session tool registration via `session-tool-defs.ts` — coordinate with A: A owns `omp-agent.ts`, C owns `session-tool-defs.ts` additions |
| D (Identity) | `apps/webui/src/login.html`, `apps/viewer/src/components/Header.tsx`, `apps/electron/src/renderer/components/onboarding/RoxConnectStep.tsx`, `packages/shared/src/i18n/locales/*.json`, `packages/shared/src/branding.ts`, `plans/identity-migration-plan.md` | i18n: all 10 locales, ASCII sort, parity tests must pass |
| E (MCP) | `packages/shared/src/mcp/**`, `packages/shared/src/sources/server-builder.ts`, `packages/shared/src/sources/types.ts` (SSE demotion), `packages/server-core/src/handlers/rpc/sources.ts` (getMcpTools normalization), `packages/shared/src/agent/session-tool-defs.ts` ONLY if C hasn't touched (else patch recommendation) | No edits to `omp-agent.ts` — OMP regression test goes in `packages/shared/src/agent/__tests__/omp-*` ONLY as patch recommendation to A if file conflicts arise |
| F (Secrets) | `packages/shared/src/credentials/**` (new provider files), `packages/shared/src/secrets/**` (new), `packages/shared/src/agent/options.ts` env injection seam (additive), `packages/shared/src/config/storage.ts` runtime config (additive) | No UI placeholders; vertical slice only |
| G (Collections/Shell) | `apps/electron/src/renderer/atoms/collection-*`, `apps/electron/src/renderer/components/app-shell/{SessionList,SessionItem,MainContentPanel,collection/**,session-table/**,kanban/**}`, `apps/electron/src/renderer/platform/**`, `packages/shared/src/sessions/collection-*` | No `SessionManager.ts` edits; rank drag uses existing `reorderRank` RPC |
| H (Docs/Branches) | `docs/**`, `AGENTS.md`, `README.md`, `docs/cli.md`, `plans/branch-disposition.md`, `packages/shared/src/agent/omp-agent.ts` header comment ONLY (coordinate: wait for A, or patch recommendation) | No code changes; no remote branch deletion |

Shared/high-conflict files (`SessionManager.ts`, `packages/shared/src/protocol/**`, `packages/shared/src/config/storage.ts`): single owner as mapped; everyone else produces patch recommendations integrated by lead.

## Workstream tracker

| WS | Branch | Status | Owner skill(s) | Result |
|---|---|---|---|---|
| A OMP first-run | `fix/p0-omp-first-run` | ✅ MERGED (57e721dd, a308b627, 8cc2da4c, fcf4da70; lead-verified: 898 agent tests green, tsc clean, **original hang repro → typed OMP_NO_MODELS + idle in 23 ms**) | systematic-debugging, test-driven-development, verification-before-completion | P0 hang fixed (settleReady exactly-once + child-scoped handlers + generation guard); 6 typed startup codes with stderr classification; queryLlm honors request.model truthfully; 30 regression tests; remaining: OMP codes ride wire as strings (core union untouched by design) |
| B Viewer security | `security/p0-viewer-share-auth` | ✅ MERGED (78939f19, 83938a02, 72a8b1f2; lead-verified: 27 viewer + 129 server-core sessions + 74 shared sessions tests green, viewer+server-core tsc clean) | threat modeling (manual), test-driven-development, verification-before-completion | Owner-capability auth on share mutations; legacy shares immutable; desktop persists `sharedOwnerKey` stripped from renderer; follow-ups: CF rate-limit rule (dashboard), R2 lifecycle for legacy shares, conditional PUTs |
| C Knowledge | `feat/knowledge-runtime-completion` | DISPATCHED (wave 1) | implement, test-driven-development, react-best-practices | — |
| D Identity | `fix/rox-identity-coherence` | DISPATCHED (wave 2, parallel) | writing-plans (migration), react-best-practices, i18n parity gates | — |
| E MCP | `fix/mcp-runtime-contract` | ✅ MERGED (06511851, 31edc7b0, 986401da, a031f9f7; lead-verified: 12 mcp + 2 omp-proxy + 171 sources + 870 agent tests green, tsc clean ×2) | systematic-debugging, test-driven-development | Genuine SSE implemented (SDK transport, headers on both channels); stdio discovery normalized; OMP proxy chain regression incl. sabotage non-vacuity proof; legacy components classified in `docs/mcp-components.md` |
| F Secrets | `feat/secrets-provider-runtime` | ✅ MERGED (135635db, 22515bed, 8eec20f5; lead-verified: 65 secrets + 201 config + 719 server-core tests green, tsc clean ×2) | implement, test-driven-development | Full vertical slice incl. real Infisical REST v3 provider; anti-leak fix in settings RPC; no UI (per scope); gaps documented in `docs/secrets-providers.md` |
| G Collections/Shell | `fix/collections-shell` | ✅ MERGED (b7930694, 9fc7ec30, 62cdcb10, e48c03e8, f13e270c; lead-verified: 81 sessions + 749 renderer tests green, i18n gates pass, renderer builds; 3 pdfjs failures proven pre-existing on base) | react-best-practices, test-driven-development | FR-11 filters persisted per navigator key; FR-45 list rank drag; grouping unified; bulk UI deduped; PanelHost implemented; **shell verdict: KEEP_EXPERIMENTAL** (14/14 playground checks, but W2 inspector stubs + zero real panel contributions); pre-existing pdfjs test breakage noted for follow-up |
| H Docs/Branches | `chore/repo-hygiene` | ✅ MERGED into integration (e4c7a36c, a0b153d6, 5427f76c; merge commit on `rox-integration-remediation-7c33`) | writing-plans, verification-before-completion | Docs aligned with v2; 94 branches classified (85 rox + 9 donor SAFE_TO_DELETE, proposed commands in `plans/branch-disposition.md` §5); corrected audit: all 62 `feature/pr-*` tips are ancestors of main; donor `feat/shell-ext-activate2` has one unique 142-line test to port/discard before donor archival |
| Integration | `rox-integration-remediation-7c33` | ACTIVE (PR #5) | code-review, resolving-merge-conflicts | — |

Dispatch note (2026-08-12): all eight workstreams run in parallel in isolated worktrees (best-of-n-runner). Waves indicate merge priority at the integration gate, not dispatch order: A/B/C merge first, then D/E/F, then G/H. Wave-4 reviewers (integration verification, browser QA, security regression, test adversary) and the Wave-5 fresh-machine E2E run after integration.

## Review gate checklist (per returned branch)

1. Full diff inspection — scope discipline vs ownership map.
2. `bun run tsc --noEmit` in affected packages.
3. Targeted `bun test` — new tests must include RED evidence (fails without the fix).
4. Error paths actually surface (typed errors, not silent hangs).
5. Migration/backward compatibility for persisted state and public APIs.
6. Security implications (auth, secrets, env, CORS, injection).
7. No third-party code copied; no production infra touched.
