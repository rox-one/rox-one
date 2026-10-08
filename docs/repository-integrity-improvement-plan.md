# Repository integrity and application integration improvement plan

**Status:** proposed  
**Audit date:** 2026-08-20  
**Scope:** desktop Electron, WebUI, viewer, headless server, identity and credentials,
workspace/session data, RPC/WebSocket transport, agent backends (including OMP), CI,
security, observability, and release engineering.

## 1. Executive summary

The repository has strong local building blocks: type-safe navigation, a shared Electron/Web
renderer, protocol negotiation, bounded transport handshakes, encrypted credential storage,
atomic identity writes, explicit OMP lifecycle timeouts, and many focused unit tests. The
application is integrated in design, but its end-to-end guarantees are weaker than the sum of
those parts.

No statically proven P0 defect was found. Release confidence should nevertheless be treated as
**red** until the P1 items below are closed:

1. The full monorepo typecheck is currently failing.
2. Server integration smoke coverage is not a functioning release gate.
3. Identity connect/disconnect and the main config store can expose inconsistent or lost state.
4. A server bearer token is printed in full, and insecure-bind validation occurs after bootstrap.
5. The main CI/release paths do not consistently prove auth → workspace → session → agent flows.

The recommended program is not a broad rewrite. It is a sequence of contract, transaction,
capability, and observability improvements around the architecture already present.

## 2. Audit method and confidence

This plan combines static trace review, test/build command execution, existing design documents,
and three independent reviews of: (a) authentication/data, (b) user flows/views, and (c)
runtime/CI/security. Findings are classified as:

- **P0:** known exploit or data-loss path requiring an immediate stop.
- **P1:** release blocker; breaks a core flow, security boundary, or integrity guarantee.
- **P2:** material reliability, UX, performance, or maintainability risk.
- **P3:** hygiene or future-scale risk.

Static evidence is not proof that a flow works. A finding stays open until an executable contract
test demonstrates the desired behavior on a supported deployment profile.

## 3. System flow map

### 3.1 Boot, authentication, and onboarding

1. Electron enters an application state machine covering loading, onboarding, reauthentication,
   workspace selection, and ready state (`apps/electron/src/renderer/App.tsx`).
2. Setup needs select a provider and connection path; onboarding persists an LLM connection and
   then chooses a workspace (`apps/electron/src/renderer/hooks/useOnboarding.ts`).
3. WebUI posts credentials to `/api/auth`; the server verifies Argon2id material and issues a
   24-hour HS256 JWT in an HttpOnly, SameSite=Strict cookie
   (`packages/server-core/src/webui/auth.ts`, `packages/server-core/src/webui/http-server.ts`).
4. WebUI fetches authenticated config, resolves a workspace, installs the web ElectronAPI
   adapter, creates a WebSocket client, and mounts the same renderer as Electron
   (`apps/webui/src/App.tsx`, `apps/webui/src/adapter/web-api.ts`).
5. Source OAuth stores state, PKCE, owner, workspace, and source in an in-memory five-minute flow;
   RPC completion verifies ownership while the public HTTP callback treats state as its bearer
   capability (`packages/server-core/src/handlers/rpc/oauth.ts`,
   `packages/shared/src/auth/oauth-flow-store.ts`).

### 3.2 Workspace, navigation, and views

1. Typed route builders define the intended navigation contract
   (`apps/electron/src/shared/routes.ts`).
2. NavigationContext treats URL state as authoritative and represents workspace, route, panels,
   focus, and sidebar state.
3. Workspace switching changes the server workspace, updates local state, and clears dependent
   caches for sessions, permissions, credentials, drafts, sources, and skills.
4. WebUI overlays desktop-only ElectronAPI operations. Some are currently no-ops rather than
   explicit unsupported capabilities.
5. Viewer loads a public shared session or accepts a local JSON upload and renders the common
   readonly session view (`apps/viewer/src/App.tsx`).

### 3.3 Identity, credentials, and durable data

1. Identity Center aggregates owned identities plus knowledge and LLM reflections
   (`packages/server-core/src/handlers/rpc/identity.ts`).
2. Identity metadata is stored in versioned JSON using temp-write/rename semantics
   (`packages/core/src/platform/identity/store.ts`).
3. CredentialManager persists one encrypted snapshot with AES-256-GCM and a machine-derived key,
   plus repair/quarantine and legacy migration paths
   (`packages/shared/src/credentials/backends/secure-storage.ts`).
4. The main `config.json` contains workspace registry, active IDs, LLM metadata, runtime refs, and
   preferences (`packages/shared/src/config/storage.ts`). Its writes are not yet atomic.
5. Sessions and OMP transcripts intentionally have separate stores; the Craft transcript remains
   the resume source of truth.

### 3.4 Runtime and transport

1. Headless transport negotiates protocol major version, authenticates, applies a handshake
   timeout, and maintains heartbeat/replay state
   (`packages/server-core/src/transport/server.ts`).
2. OMP runs as an RPC child, receives host tool definitions, maps permissions, streams thinking,
   and supports branching and skill sync (`packages/shared/src/agent/omp-agent.ts`).
3. Electron and WebUI reach the same server handlers through platform adapters, which is the
   right convergence boundary. Parity is not yet enforced as a contract.

## 4. Findings and remediation backlog

### P1 — release blockers

#### P1.1 Restore a truthful CI and release gate

The root defines full validation, but not every active CI/deploy path runs it; server lifecycle
smoke remains a placeholder in `.github/workflows/validate-server.yml`. A green change can
therefore miss broken renderer, auth, transport, migration, or server startup behavior.

**Required work**

- Make frozen install → full typecheck → tests (including isolated tests) → lint/i18n → build
  the mandatory PR sequence.
- Replace placeholder server smoke with a real process boot, authenticated config/WS handshake,
  session create/send/resume, logout/expiry, and graceful SIGTERM test.
- Build once, promote the tested artifact, and make deployment depend on its provenance.
- Add required status checks and prohibit bypass for production deploy branches.
- Clarify `typecheck`: either make it full or rename it to `typecheck:shared`.

**Acceptance:** a seeded defect in any supported surface makes CI red; deploy consumes the exact
tested artifact.

#### P1.2 Fix the WebUI session deep-link contract — closed

The web adapter previously opened `?session=<id>`, while the renderer reads `sessionId`, breaking a
core cross-window user flow. The adapter now uses the canonical `sessionId` parameter through a
dedicated URL builder with regression coverage for encoding and the legacy-key mismatch.

**Follow-up:** move the query builder into the shared route contract and add a mounted test covering
new-window creation through session focus.

#### P1.3 Separate startup failure from first-run onboarding

An exception while reading workspace/setup state can be interpreted as a new user. Transport,
authorization, or storage failure must not send an existing user into a setup path.

**Required work:** add `boot-error`/`offline` states with typed reason, retry, diagnostics, and safe
exit; enter onboarding only after a successful authoritative `needsSetup=true` response.

#### P1.4 Make identity operations transactional

Connect writes connected metadata before the secret. Disconnect drops metadata/ref before a
fail-soft secret deletion. These orderings can produce false-connected identities or orphaned
secrets.

**Required work:** implement an idempotent saga/outbox. Store a pending operation, perform the
credential mutation, commit metadata, and compensate or retry after failure. Preserve a tombstone
until cleanup is verified. Expose repair state rather than pretending success.

#### P1.5 Make the authoritative config durable

`config.json` is written directly, unlike identity and credential stores. Interruption can truncate
the workspace/config registry.

**Required work:** create one reusable durable writer: unique temp file, restrictive permissions,
file fsync, atomic rename, directory fsync, validated backup, revision/CAS, corruption quarantine,
and deterministic restore. Never seed defaults over an existing corrupt file.

#### P1.6 Eliminate cross-process lost updates

Credential and identity stores cache whole snapshots. Multiple writers may overwrite one another.

**Required work:** prefer one storage-owner service over RPC; otherwise use file locking plus
monotonic revisions/CAS and cache invalidation. Exercise two real processes performing at least
1,000 interleaved mutations without lost IDs.

#### P1.7 Fail closed before server bootstrap and protect secrets

Startup emits the bearer token in full, and unsafe remote cleartext bind validation happens after
runtime/listener initialization.

**Required work:** validate bind/TLS/token policy before bootstrap, never print an existing token,
return generated credentials only for an explicit command or protected file, redact logs and
diagnostics, and add a secret scanning snapshot test.

#### P1.8 Restore a green baseline

The audited full typecheck contains baseline failures across workspace packages. These are not
future roadmap items and should be fixed in dependency order so each package regains a clean gate.

**Required work:** fix the compile errors, run the complete validation suite after a frozen install,
and record known platform skips explicitly. No feature work should lower the baseline further.

### P2 — reliability, security, and integration

#### P2.1 Introduce explicit platform capabilities

Web-only adapter methods sometimes return success without doing work; web attachment selection
returns names rather than a usable byte/path contract.

- Negotiate typed capabilities during handshake.
- Hide or disable unsupported actions with localized explanations.
- Return a typed `UnsupportedCapability` error if invoked anyway.
- Define attachment input as bytes/blob/upload handle, not an Electron path assumption.
- Add parity tests generated from the ElectronAPI/channel registry.

#### P2.2 Make workspace switching a transaction

Server switch and local cache resets can interleave or leave mixed workspace state.

- Add a WorkspaceCoordinator with a transition generation/mutex.
- Freeze workspace-bound writes during transition.
- Switch server, fetch a coherent snapshot, atomically publish local state, then restore navigation.
- Abort stale transitions; retry or roll back on failure.
- Test rapid A→B→A switching, offline interruption, permission/source cache isolation, and URL back.

#### P2.3 Wait for transport readiness

WebUI mounts the renderer immediately after calling `connect()`. Define an awaited connected and
capabilities-ready barrier, plus reconnect/degraded states. Classify startup fetches into critical
and noncritical work and use `Promise.allSettled` for the latter.

#### P2.4 Canonicalize and version URL state

Consolidate legacy query parsing and NavigationContext under one versioned schema. Provide pure
parse/serialize/migrate functions and mounted tests for reload, back/forward, multi-panel focus,
workspace change, malformed IDs, and old links.

#### P2.5 Harden viewer ingestion

Replace shallow casting with a shared versioned StoredSession schema. Enforce maximum bytes,
messages, nesting, and attachments; parse off the hot rendering path; surface localized validation
errors. Add malformed/fuzz/oversize/XSS tests and remove reliance on a hard-coded remote dev fixture.

#### P2.6 Improve Web auth lifecycle

- Scope password verifier and limiter to the handler instance.
- Count failures, reset a successful IP, return Retry-After, and bound limiter memory.
- Add JWT `iss`, `aud`, `jti`, key ID/session version, rotation, and revocation strategy.
- Use constant-time token comparison.
- Test proxy/secure-cookie behavior, IPv4/IPv6 normalization, logout revocation, expiry, and
  HTTP-cookie-to-WebSocket authentication.
- Rename destructive RPC logout/reset behavior so it cannot be confused with browser logout.

#### P2.7 Make OAuth consumption atomic

Consume state into `in_progress` before exchange, cache an idempotent outcome, and reject concurrent
replay. Retain owner/workspace checks on RPC completion. For public callback endpoints add
`Referrer-Policy: no-referrer`, no-store caching, a restrictive CSP, and redacted URL logging.

#### P2.8 Separate configured from authenticated health

LLM config rows must not automatically appear connected. Model `configured`, `checking`,
`connected`, `expired`, `missing_secret`, and `error`, with `lastCheckedAt` and stable error codes.
Provider probes need bounded timeout/retry and offline-aware UX.

#### P2.9 Harden the WebSocket admission boundary

Account for pending unauthenticated sockets, add global/per-IP admission limits, set `maxPayload`,
make compression policy explicit, and bound pre-auth parsing. Test slow handshakes, oversized frames,
connection churn, and reverse-proxy forwarded identity policy.

#### P2.10 Make OMP host tools deterministic and cancellable

- Fingerprint stable canonical JSON of full tool definitions, not concatenated names.
- Treat essential `set_host_tools` failure as explicit degraded/not-ready state with retry/backoff.
- Pass AbortSignal through tool execution; clear timers; define idempotency keys so timed-out side
  effects cannot be duplicated by retries.
- Cap one-shot stdout/stderr bytes and terminate on overflow.
- Define an allowlist/redaction policy for environment inherited by child runtimes.
- Add malformed NDJSON, child crash, permission timeout, MCP timeout, abort, branch, and replay tests.

#### P2.11 Make storage parsing explicit

Split config load into parse → validate → migrate → integrity audit → commit → apply. Reads must not
create directories or persist defaults. Unknown future versions must be rejected, not coerced.
Identity/config corruption must be quarantined with observable StorageHealth, matching credential
repair behavior.

### P3 — scale and maintainability

- Split the renderer's large orchestration component into BootCoordinator, WorkspaceCoordinator,
  SessionCoordinator, and thin presentation gates.
- Replace deprecated browser command APIs and surface clipboard failures.
- Move every viewer/server-controlled user-facing string through shared i18n; maintain ten-locale
  parity and sorting.
- Define an encryption threat model: machine-bound recovery is intentional, while same-user local
  compromise is not prevented by a machine-derived key. Consider Keychain/DPAPI/libsecret or an
  injected headless secret for DEK wrapping.
- Add JSON logs and trace/request/client/workspace/session/turn/tool correlation IDs.
- Add accessibility coverage for keyboard traversal, focus restoration, screen readers, contrast,
  reduced motion, and compact/mobile layouts.
- Validate signed packaged artifacts on macOS, Windows, and Linux; generate SBOMs and run dependency,
  license, and secret scans.

## 5. Target architecture and invariants

### 5.1 Non-negotiable invariants

1. No plaintext secret in config, identity metadata, RPC events, diagnostics, or logs.
2. Every credential reference resolves, is explicitly pending, or has a repairable tombstone.
3. Every stored secret has an owner or a cleanup tombstone.
4. Authoritative writes are atomic, durable, revisioned, and recoverable.
5. A schema version is accepted, migrated, or rejected—never silently guessed.
6. Workspace-bound state from two workspaces is never simultaneously observable.
7. UI success means the operation completed; unsupported actions are never success no-ops.
8. Onboarding is entered only from a successful setup-needs decision.
9. An agent turn cannot execute an unadvertised or stale host-tool schema.
10. A release artifact is deployable only if the same artifact passed integration tests.

### 5.2 Recommended ownership boundaries

- **BootCoordinator:** auth/setup/transport/workspace readiness statechart.
- **StorageService:** single writer for config, identity, credentials, migrations, and health.
- **WorkspaceCoordinator:** transactional switch and coherent snapshot publication.
- **CapabilityRegistry:** one negotiated Desktop/Web/headless feature contract.
- **SessionContract:** shared schema across storage, export, viewer, server, and clients.
- **AgentRuntimeHealth:** provider/tool readiness, degradation reasons, retry policy, and telemetry.

## 6. Delivery roadmap

### Phase 0 — baseline and release stop (days 1–3)

- Fix current typecheck and real server-start smoke failures.
- Fix `session`/`sessionId` and add its regression test.
- Stop secret output and move insecure-bind validation before bootstrap.
- Make the full validation workflow blocking; gate deploy on tested artifacts.
- Freeze new schema additions until store invariants and ownership are documented.

**Exit gate:** clean frozen install; typecheck, lint, tests, smoke, and builds green; no known P1
secret exposure or broken core deep-link.

### Phase 1 — integrity and recoverability (week 1)

- Durable config writer and StorageHealth startup audit.
- Config/identity quarantine and backup restore preview.
- Identity connect/disconnect saga with fault-injection tests.
- Web startup error state and awaited transport handshake.
- Viewer schema, resource limits, and i18n.

**Exit gate:** crash-point matrix recovers; referential scan has zero unexplained orphan/missing refs;
startup failure never enters onboarding.

### Phase 2 — integration contracts (weeks 2–3)

- Capability negotiation and Web adapter parity.
- Transactional workspace coordinator.
- Versioned URL contract.
- Atomic OAuth consume and improved Web auth lifecycle.
- Desktop/Web/headless contract matrix for auth, reconnect, workspace, session, permissions,
  credentials, OMP tools, abort, and branching.

**Exit gate:** the same golden user journeys pass against Electron-local, WebUI-headless, and
supported remote profiles.

### Phase 3 — runtime hardening (weeks 4–6)

- WebSocket admission and payload controls.
- OMP tool schema hashing, cancellation, output caps, readiness, and environment policy.
- Single-writer storage or locks+CAS and multiprocess stress tests.
- Provider health probes and recovery center UX.

**Exit gate:** fault injection and load tests meet SLOs with no lost writes, duplicate side effects,
or mixed-workspace state.

### Phase 4 — observability and performance (weeks 7–10)

- Structured logs/traces/metrics and dashboards.
- Instrument login, config loaded, WS connected, workspace ready, sessions ready, first interactive,
  first token, turn complete, tool timeout/retry, reconnect/replay, and OMP respawn.
- Establish bundle, startup, memory, list-render, transcript, and 50-client load budgets.
- Profile before changing; prioritize code splitting, virtualization, and reducing duplicate startup
  fetches only where measurements justify them.

### Phase 5 — release maturity (weeks 11–12 and continuous)

- Cross-platform packaged artifact smoke and signing verification.
- SBOM, dependency/license/secret scans, canary deploy, health check, automated rollback.
- Accessibility/browser matrix and migration golden fixtures for every supported historical version.
- Quarterly chaos/security review and monthly recovery drill.

## 7. Golden user journeys

Each journey must assert UI result, server state, durable state, telemetry, restart behavior, and that
no secret appears in captured logs.

1. Fresh install → onboarding → Rox/OMP connection → workspace → first turn → restart → resume.
2. Existing Web user → login → cookie config → WS → workspace → create/send/resume → logout → expiry.
3. Source OAuth success, cancel, denial, timeout, concurrent callback, restart mid-flow, and revoke.
4. Identity connect → refresh → restart → disconnect, with injected credential and metadata failures.
5. Rapid workspace A→B→A while sessions/sources/skills load and browser back/forward is used.
6. Open session in a new Web tab and restore a legacy deep link.
7. Add an attachment on Desktop and Web, including unsupported/oversize/offline cases.
8. OMP turn → thinking → host tool → permission → timeout/abort → retry → branch → resume.
9. Export/share → viewer fetch/upload → validation → readonly render with hostile/malformed inputs.
10. Corrupt/interrupted config, identity, and credential writes → quarantine → preview → restore.

## 8. Test pyramid and release checks

### Unit and schema

- Route parse/serialize/migrate round trips.
- Auth claims, limiter semantics, token comparison, OAuth atomic consume.
- Durable writer crash points, migration idempotence, unknown-version rejection.
- Shared session DTO fuzzing and limits.
- OMP canonical tool fingerprints and cancellation.

### Contract and integration

- ElectronAPI registry versus Web capability adapter.
- HTTP cookie to WebSocket auth and reconnect/replay.
- Identity/credential saga with injected storage failures.
- Two-process storage concurrency.
- Real server entry lifecycle and graceful shutdown.
- OMP fake child plus real MCP proxy for tool, permission, abort, and malformed protocol cases.

### End-to-end and non-functional

- Playwright desktop/Web happy paths plus failure recovery.
- Packaged artifacts on all supported operating systems.
- Accessibility scan plus manual keyboard/screen-reader journeys.
- 50-client load, large transcript, large tool schema, connection churn, and memory soak.
- Secret/log snapshots, dependency/SBOM scan, and restore drill.

## 9. SLOs and program scorecard

Initial targets should be measured for one release before becoming blocking:

- Authenticated boot success ≥ 99.5%; workspace ready p95 ≤ 3 s on reference hardware.
- Session open p95 ≤ 500 ms when metadata is cached; zero wrong-workspace renders.
- Transport reconnect success ≥ 99.9% within 10 s; replay gap rate zero.
- Durable mutation loss rate zero across crash and concurrency suites.
- Agent turn infrastructure success ≥ 99.5%, excluding provider-declared failures.
- Tool timeout duplicate-side-effect rate zero.
- Migration success ≥ 99.9% with automatic rollback/repair for every supported prior version.
- Zero plaintext secrets in automated log/serialization scans.
- Critical user journeys pass on 100% of release platforms.

Track weekly: open P1/P2 count and age, flaky test rate, CI duration, escaped defects, startup p50/p95,
first-token latency, reconnects, orphan refs, repair events, OMP restarts, tool timeout/retry rate,
viewer validation failures, and rollback frequency.

## 10. Prioritized implementation board

| ID | Priority | Deliverable | Primary owners | Depends on |
|---|---|---|---|---|
| RI-01 | P1 | Green full typecheck and real server smoke | Core + Server | — |
| RI-02 | P1 | Blocking CI and artifact-gated deploy | Release | RI-01 |
| RI-03 | P1 | Canonical Web session deep link | UI | — |
| RI-04 | P1 | Pre-bootstrap security validation and redaction | Server/Security | — |
| RI-05 | P1 | Durable config writer and StorageHealth | Data | — |
| RI-06 | P1 | Transactional identity connect/disconnect | Identity | RI-05 |
| RI-07 | P1 | Single-writer or lock+CAS storage | Data | RI-05 |
| RI-08 | P1 | Explicit boot error/offline states | UI/Platform | — |
| RI-09 | P2 | Transport readiness and capability registry | Platform | RI-08 |
| RI-10 | P2 | Transactional workspace coordinator | UI/Server | RI-09 |
| RI-11 | P2 | OAuth consume + Web auth lifecycle | Security | RI-05 |
| RI-12 | P2 | Viewer schema/limits/i18n | Viewer | — |
| RI-13 | P2 | WS admission hardening | Server/Security | RI-01 |
| RI-14 | P2 | OMP readiness/hash/cancel/output/env | Agent Runtime | RI-01 |
| RI-15 | P2 | Cross-surface golden journey suite | Quality | RI-03–RI-14 |
| RI-16 | P3 | Structured telemetry and SLO dashboards | Platform/SRE | RI-15 |
| RI-17 | P3 | Cross-platform packaged release gates | Release | RI-02, RI-15 |

## 11. Definition of done

A work item is complete only when:

1. Its invariant and failure semantics are documented.
2. Unit plus boundary-level tests cover success, denial, timeout, retry, restart, and concurrency where
   applicable.
3. User-visible errors are actionable and localized in all ten locales.
4. Logs/telemetry are structured, correlated, and redacted.
5. Migration and backward compatibility behavior are explicit.
6. The real supported artifact—not only a mock—passes its golden journey.
7. Rollback/repair has been exercised.
8. CI enforces the acceptance criteria without an unexplained skip.

This sequence turns the current collection of well-designed subsystems into a product whose
integration is continuously executable, observable, recoverable, and safe to release.
