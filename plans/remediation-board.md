# Rox — Remediation Board

Source: `plans/integration-audit.md` (2026-08-12). Integration branch: `integration/remediation-7c33` (from `main` @ `5797f431`).
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
| A OMP first-run | `fix/p0-omp-first-run` | DISPATCHED (wave 1) | systematic-debugging, test-driven-development, verification-before-completion | — |
| B Viewer security | `security/p0-viewer-share-auth` | DISPATCHED (wave 1) | threat modeling (manual), test-driven-development, verification-before-completion | — |
| C Knowledge | `feat/knowledge-runtime-completion` | DISPATCHED (wave 1) | implement, test-driven-development, react-best-practices | — |
| D Identity | `fix/rox-identity-coherence` | PENDING (wave 2) | writing-plans (migration), react-best-practices, i18n parity gates | — |
| E MCP | `fix/mcp-runtime-contract` | PENDING (wave 2) | systematic-debugging, test-driven-development | — |
| F Secrets | `feat/secrets-provider-runtime` | PENDING (wave 2) | implement, test-driven-development | — |
| G Collections/Shell | `fix/collections-shell` | PENDING (wave 3) | react-best-practices, verification-before-completion, computerUse | — |
| H Docs/Branches | `chore/repo-hygiene` | PENDING (wave 3) | writing-plans, git archaeology (manual) | — |
| Integration | `integration/remediation-7c33` | ACTIVE | code-review, resolving-merge-conflicts | — |

## Review gate checklist (per returned branch)

1. Full diff inspection — scope discipline vs ownership map.
2. `bun run tsc --noEmit` in affected packages.
3. Targeted `bun test` — new tests must include RED evidence (fails without the fix).
4. Error paths actually surface (typed errors, not silent hangs).
5. Migration/backward compatibility for persisted state and public APIs.
6. Security implications (auth, secrets, env, CORS, injection).
7. No third-party code copied; no production infra touched.
