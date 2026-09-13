# Spec — Rox Next Program: First-Run Completeness + Deep Seams

Synthesized from `plans/problem-inventory.md`, `plans/integration-audit.md`, `plans/remediation-board.md`, `plans/identity-migration-plan.md`. No interview. Seams chosen at the highest existing points.

## Problem Statement

A new Rox user can install the product, log in, create a session, and still cannot complete a first turn without out-of-band credentials. Failures are now bounded and typed, but the happy path is incomplete. Meanwhile the public share API still has residual size/TOCTOU holes, the OAuth callback page interpolates untrusted strings into HTML, Knowledge CTAs exist but are unmounted, and every new change still serializes through a 10 000-line session module and a 3 500-line config module. The product presents as Rox in the UI and as Craft in the filesystem, env, app id, and system prompt.

## Solution

Finish the first-run path so a clean machine reaches a real turn or a single actionable credential step. Close the remaining public-surface security holes. Mount the knowledge-to-session path that already exists. Make one real unified-shell panel contribution or keep the flag experimental with an explicit date. Start identity migration with an env/config-dir resolver that never strands installs. Prefactor the session and config modules so the next feature does not edit the same two files. Do not ship a managed SiYuan kernel. Do not rename appId or delete remote branches in this program.

## User Stories

1. As a new desktop user, I want onboarding to either connect a working model or tell me exactly which credential is missing, so that I am never left with a “ready” session that cannot chat.
2. As a new headless/server user, I want a documented token and config-dir contract, so that my first `bun run` does not die on a 15-character token or a second-instance lock.
3. As a returning user with `~/.craft-agent`, I want my data to keep working after any Rox rename, so that an update never looks like a factory reset.
4. As a user who shared a session, I want only me to update or delete that share, so that a forwarded link cannot be hijacked.
5. As a user who shared a large session with non-ASCII content, I want the size limit to measure real bytes, so that the share is not silently oversized on the bucket.
6. As a user of a legacy share, I want a clear “create a new share” path, so that immutability is not a dead end.
7. As an operator of `agents.rox.one`, I want a platform rate-limit rule and a legacy-object cleanup, so that isolate memory is not the only abuse control.
8. As a user authorizing Google/Slack, I want the callback page to never execute strings from the IdP, so that a crafted error cannot run in my browser.
9. As a knowledge user, I want “Ask about this document” to open a session that still holds the document, so that I do not re-paste context.
10. As a knowledge user, I want Inbox/Daily/Tags to either list real items or disappear, so that empty chrome does not look like a broken tree.
11. As an agent, I want knowledge write tools only when the user has approved the write path, so that a skill cannot mutate the vault by declaration alone.
12. As a secrets user, I want to declare a secret ref in Settings and see it injected at spawn without the value appearing in the renderer, so that I do not edit `config.json` by hand.
13. As a user rotating an Infisical secret, I want the next new session to pick it up, so that I do not keep chatting with a stale env.
14. As a user of stdio MCP, I want my declared source env to work and host secrets to stay out of the child, so that a plugin cannot steal `INFISICAL_TOKEN`.
15. As a user of the web UI, I want the PWA manifest and notification settings to stop 401/“no handler”, so that the console is not a list of known holes.
16. As a user of messaging in Docker, I want Discord to exist in the image if the UI offers Discord, so that the container matches the product.
17. As a user of Cloud Runs, I want auth that is not one shared bearer for every run, so that a leaked token is not total compromise.
18. As a Rox user, I want the window title, menu, login, and agent self-name to say Rox, so that I am not using two products at once.
19. As a Craft-era user, I want `CRAFT_*` and `craftagents://` to keep working for at least one major cycle, so that my scripts do not break on update.
20. As a developer, I want SessionManager to be a deep session module with internal seams, so that share auth, spawn, and collection fields are not one file.
21. As a developer, I want config defaults to have one source of truth, so that CI and desktop do not disagree on permission mode.
22. As a developer, I want leftover Codex MCP servers classified and then unstaged, so that release artifacts stop shipping dead binaries.
23. As a reviewer, I want pdfjs tests green or skipped with a ticket, so that “3 failures” is not the baseline.
24. As a release engineer, I want dead `marketing:*` / `docs:dev` scripts gone, so that `package.json` matches `apps/`.
25. As a legal owner, I want managed SiYuan to stay fail-closed until G2 is ACCEPTED, so that we do not ship AGPL risk.
26. As an iOS user, I want the app to say Rox and talk to the same server, so that mobile is not a frozen Craft snapshot — later, not this program’s happy path.
27. As an operator, I want a written decision on WeChat iLink, so that unofficial bot risk is accepted or removed.
28. As a user of unified shell, I want either one real inspector panel or no flag in the UI, so that experimental chrome is not a second product.
29. As a test adversary, I want every new failure path to end idle + typed + actionable, so that we do not reintroduce a spinner.
30. As a lead agent, I want file ownership and expand–contract rules before parallel work, so that two subagents do not edit SessionManager again.

## Implementation Decisions

- **Primary seam for first-run:** the existing connection + toolchain + OmpAgent startup error path. Do not invent a second onboarding wizard. Extend the seeded `rox-kimi` path so missing `~/.omp/agent/config.yml` / Rox device token produces one credential step, then a retry that can succeed.
- **Primary seam for secrets:** `runtime.secretRefs` + `getRuntimeEnvOverrides()`. Settings UI writes refs only; values never cross the renderer seam.
- **Primary seam for share residuals:** viewer Pages Functions already sit behind owner capability. Measure size in UTF-8 bytes; add `X-Content-Type-Options: nosniff`; add R2 conditional writes. Platform rate limit stays OPS.
- **Primary seam for OAuth XSS:** `generateCallbackPage` is the only HTML builder. Escape `errorDetail` and `deeplinkUrl` there; tests hit that function, not Electron.
- **Primary seam for knowledge CTAs:** the existing `action/new-session?input=&send=` route. Mount `KnowledgeAgentPanel`; do not add a new session-create channel.
- **Primary seam for identity expand:** one `getEnv(name)` / config-dir resolver. `ROX_*` wins, `CRAFT_*` remains alias. No appId change in this program.
- **Primary seam for shell:** `PanelHost` + `featureUnifiedShellAtom`. One real panel contribution (Knowledge inspector or Collection inspector) is the go/no-go evidence. Flag stays default OFF unless that panel is verified in classic and unified.
- **Prefactor before features that touch SessionManager:** extract share-capability, spawn-env, and event-complete into internal modules behind the same SessionManager interface. Callers do not change. This is expand, not a rewrite.
- **Prefactor config defaults:** bundled `config-defaults.json` is source of truth; TypeScript fallback must be generated from it or deleted. Headless without bundle uses the same JSON file from the repo.
- **Legacy MCP:** expand–contract. Stop staging binaries first; keep resolver fields until no packaged layout depends on them; then delete.
- **OMP error codes:** add the existing string codes to the protocol union so the renderer switches on a typed field, not a substring.
- **Managed kernel, appId, website repo, WeChat, design canvas, iOS APNs:** out of implementation. Decision tickets only.
- **Test seam:** prefer existing fakes (`omp-fake-cli`, viewer function tests, knowledge tool runtime, i18n gates). New seams only if a god-module extract needs an in-memory adapter.

## Testing Decisions

- Test external behavior: process exit, HTTP status/code, session idle, renderer DTO shape, env of a spawned child. Do not assert private method names.
- Good test: fails on the unfixed tree (RED evidence), passes on the fix, cannot be made green by deleting the assertion.
- Modules under test: OmpAgent startup/credential prompt, viewer share size/headers/conditional put, callback page escaping, config-defaults parity, knowledge panel mount + new-session token survival, secret ref settings RPC (no values), env resolver precedence, SessionManager extract (same public interface).
- Prior art: `omp-startup-lifecycle.test.ts`, `share-auth.test.ts`, `secrets/__tests__/chain.test.ts`, `knowledge-search` bounding tests, i18n parity suite.
- Adversary pass is mandatory for anything that claims “bounded failure”.

## Out of Scope

- Managed SiYuan distribution (G2 OPEN).
- Electron `appId` / `productName` / auto-update flip.
- Deleting remote branches (proposal only).
- Implementing `packages/ui-collections` (K-09).
- Design canvas / first-class Artifact entity.
- Cloud-gateway JWT rewrite and E2B provider.
- iOS APNs / App Store identity.
- Copying third-party code. Changing production Cloudflare/R2 beyond documented OPS steps the human runs.

## Further Notes

- Integration branch `rox-integration-remediation-7c33` (PR #5) is the required base. Do not start from stale `main` @ `5797f431` without those fixes.
- File ownership from `plans/remediation-board.md` still applies: one owner for SessionManager, protocol DTOs, and `config/storage.ts`.
- Russian is the default UI language. New user-facing strings go through `t()` into all 10 locales, ASCII-sorted keys.
- Website repo is private and was not auditable. Rox Connect contract changes need a human with access.
