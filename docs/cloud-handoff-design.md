# Cloud handoff «В облако» → Daytona cloud session

Status: implemented behind `cloudHandoff.enabled` (default **off**). Branch `feat/cloud-handoff-daytona`.

## 1. What exists today (main 3adaf11ca)
- There is **no** literal «В облако» button on main: the chat composer only has the Cloud Runs chip
  (`CloudRunsChip`, label «Облако», research runs, unrelated to moving a chat). This feature adds a new
  **«В облако»** button in the same row above the composer (`InputContainer`).
- `@rox/cloud-runner` already ships an injectable `DaytonaClient` (`HttpDaytonaClient` REST + `MemoryDaytonaClient`),
  key redaction, and a Cloud Runs provider. Reused here; extended with `env`, `public`, `autoStopInterval` on create
  and `getPreviewUrl()` (`GET /sandbox/{id}/ports/{port}/preview-url`).
- Conation `SessionApply` (`packages/core/src/platform/session-apply`) is an operator HTTP stub, flag-gated, no Daytona
  calls — not used.
- Web UI (`server-core/src/webui`) already supports OIDC (Pocket ID / Rox ID): auth-code + PKCE, nonce, JWKS,
  configured by `ROX_WEBUI_OIDC_ISSUER / _CLIENT_ID / _PUBLIC_URL`. Gap: **any** verified IdP user could log in.
  Added `ROX_WEBUI_OIDC_ALLOWED_SUBS` owner pinning (403 for other subjects).
- Desktop Rox ID account: `RoxAccountAuthority.state(LOCAL_ROX_CALLER).account.user.id`.

## 2. Flow
1. User clicks «В облако» (visible only if flag on). With no personal key and no broker the button reads
   «Добавить ключ Daytona» and opens the key dialog.
2. Renderer → `cloudHandoff:start {sessionId}` (LOCAL_ONLY, `access: localElectron`).
3. Desktop: Rox ID access token → `GET id.rox.one/userinfo` → OIDC `sub` (owner). Then client selection:
   personal key → Daytona directly; otherwise → Rox broker with the id.rox.one token; neither → `no_key`.
4. If the chat already has a live cloud session it is deleted first (one cloud session per chat).
5. Orchestrator: live-only quota → create private sandbox → start → link base → stream files → manifest +
   `server.env` → `rox-handoff-start` → poll `rox-handoff-health` → **ready**.
6. UI shows «Открыть в браузере» + «Завершить». Opening fetches a **fresh** link via `cloudHandoff:status`;
   the link is never kept in renderer state or stored on the server. «Завершить» → `cloudHandoff:end` deletes the sandbox.
7. Browser → session web UI → id.rox.one OIDC → only the pinned `sub` is admitted (403 otherwise).
Phases: `resolving_key → packaging → creating_sandbox → uploading (n/N) → starting → waiting_ready → ready | failed | cancelled`.
Rejected starts (flag off, another handoff running) are reported but never replace the chat's live session.

## 3. Data packaging
- Session folder recursively → `bundle/session/**`; workspace files the transcript references (absolute paths under the
  session `workingDirectory`, max 500) → `bundle/workspace/**`. Whole repos are not copied.
- Symlinks never followed; containment uses `relative()` with `isAbsolute(rel) || rel === '..' || rel.startsWith('..'+sep)`;
  each file is re-`lstat`ed (and workspace files re-`realpath`ed) at read time (TOCTOU).
- Secrets excluded by path (`.env*`, key/cert files, `id_*`, `.npmrc/.netrc/.git-credentials`, `credentials*/secrets*/service-account*`,
  `cloud-runs.env`, `credentials.enc`, `.git/ node_modules/ .ssh/ .aws/ .kube/ .gnupg/ .docker/`) and by content
  (private keys, AKIA, sk-/sk-ant-, gh*_ , github_pat_, xox*, dtn_, AIza, plus the active personal Daytona key).
- **Scan limits (best effort):** content scanning reads only the first 2 MiB of a file and skips files with a NUL byte
  in the first 8 KiB (treated as binary). A secret placed after 2 MiB or inside a binary file is not detected; path
  rules still apply.
- Limits: 25 MiB/file (skipped), 200 MiB total and 2 000 files (refuse whole handoff), sizes re-checked on real bytes.
- Format: plain files under `/home/daytona/rox-handoff/bundle/`, `manifest.json` (`version:1`, sha256, exclusions).

## 4. Daytona usage
- REST via `HttpDaytonaClient` (personal key) or `BrokerDaytonaClient` (default key via broker); same `DaytonaClient`
  interface, so the orchestrator is identical and fully mock-tested.
- Snapshot `rox-session-server-v1`, built from `cloud/handoff-image/Dockerfile` on top of `Dockerfile.server`, with
  `rox-handoff-start` and `rox-handoff-health` in `/usr/local/bin`.
  - start: strict allow-listed `server.env` parse, refuses unless `ROX_WEBUI_PASSWORD_LOGIN=0` and an owner sub is set,
    generates the JWT secret in-sandbox (`openssl rand`, never on disk), lays out the workspace, starts the server.
  - health: `/health` 200 **and** `POST /api/auth` → 404 (no password route) **and** `/api/auth/login` → 302 to the issuer.
- Labels: `rox.cloud-handoff=1`, `rox.cloud-handoff.owner=<sha256(sub) prefix>`, `rox.cloud-handoff.id`.

## 5. Links
- Sandbox is **always private** (`public:false`; a public sandbox exposes every port incl. the web terminal 22222).
- **Production = web host mode only** (`cloudHandoff.webHost` / `ROX_CLOUD_HANDOFF_WEB_HOST`, i.e. `cloud.rox.one`):
  stable `https://<host>/s/<handoffId>/`. Without a web host the handoff fails with `web_host_required` before any
  sandbox is created. No wildcard Daytona redirect is registered at id.rox.one (a `9100-*.<daytona proxy>` redirect
  would be hostable by any Daytona customer).
- **Dev only** — signed mode, only with `ROX_CLOUD_HANDOFF_DEV_SIGNED_LINKS=1` (desktop; the broker needs the same flag
  to serve `signed-preview-url`, else 403): Daytona signed preview URL for port 9100 with **1 h TTL** (`linkTtlSec`), clamped to Daytona's documented
  max 86 400 s; re-issued on every `cloudHandoff:status` read, never stored. Because each signed link has a different host,
  the sandbox gets `ROX_WEBUI_PUBLIC_HOST_PATTERN=9100-[a-z0-9-]+\.<proxy-domain>`: the web UI uses the request host as
  OIDC redirect base only if it matches (else 400), and the token exchange reuses the exact redirect_uri from login.
- Only https URLs are opened.
- **Waking a stopped sandbox — only on explicit open.** Passive `cloudHandoff:status` reads (button mount, polling)
  only report state: they never start a sandbox and carry no link. «Открыть в браузере» calls status with
  `open: true`; only then `ensureSessionRunning` runs: wait out transitional states (creating/stopping/…, bounded by
  the ready timeout, nothing exec'd meanwhile) → start a stopped sandbox → for an already-started one, health-check
  first (healthy ⇒ done; crashed server ⇒ continue) → `rox-handoff-start` → poll health. Then the link is returned
  (fresh signed link in dev, stable web-host URL in prod). Concurrent opens share one wake-up; on failure no link.
- **Restart safety:** `rox-handoff-start` unpacks `bundle/` into the workspace only once (marker
  `rox-workspace/.rox-handoff-unpacked`), so a restart never overwrites cloud-side messages with the desktop snapshot.
  `server.pid` is trusted only if that PID is alive **and** its `/proc/<pid>/cmdline` is the Rox server
  (`packages/server/src/index.ts`); otherwise (stale/recycled PID after a restart) it is removed and the server started.

## 6. SSO / ownership
- Issuer `https://id.rox.one`, public PKCE client (`cloudHandoff.ssoClientId` / `ROX_CLOUD_HANDOFF_OIDC_CLIENT_ID`).
- Owner = OIDC `sub` from id.rox.one **userinfo** for the user's Rox token — the same claim the sandbox gets in the
  browser id_token — pinned via `ROX_WEBUI_OIDC_ALLOWED_SUBS`. (Previously the Rox account `user.id`; replaced.)
- `ROX_WEBUI_PASSWORD_LOGIN=0` is always written to `server.env`.

## 7. Keys and the broker
- Desktop: only the **personal** key (encrypted credential store `service_oauth::global::daytona-cloud-handoff`; set/clear,
  never readable from the renderer). The desktop never reads `ROX_CLOUD_HANDOFF_DAYTONA_API_KEY`.
- Default key: `ROX_CLOUD_HANDOFF_BROKER_URL` (or `cloudHandoff.brokerUrl`) → Rox-hosted broker
  `/api/cloud-handoff/v1/*`, `Authorization: Bearer <id.rox.one token>`.
- Broker (server-core `maybeCreateCloudHandoffBroker`, mounted in `packages/server` via `extraRoutes`): active only when
  `ROX_CLOUD_HANDOFF_BROKER_ENABLED=1`, `ROX_CLOUD_HANDOFF_DAYTONA_API_KEY` is set and **not Electron**. It verifies the
  token via userinfo (60 s cache) **and its audience**: `aud`/`azp`/`client_id` must be in
  `ROX_CLOUD_HANDOFF_BROKER_ALLOWED_CLIENT_IDS` (required; the broker doesn't mount without it), token `sub`/`iss` must match.
  JWTs are trusted after userinfo accepted them; opaque tokens need RFC 7662 introspection
  (`ROX_CLOUD_HANDOFF_INTROSPECTION_CLIENT_ID/SECRET`), otherwise they're refused. Then only: list/create/get/start/stop/delete **own** sandboxes (owner label),
  write only `bundle/**`, `manifest.json`, `server.env` (paths with empty/`.`/`..` segments or backslashes rejected;
  bodies capped by Content-Length and while streaming before JSON parse), exec exactly `rox-handoff-start|health <root>`, signed link for port
  9100 only (≤ 1 h, dev flag only). Create is serialised per owner (quota check + create under a lock) and capped
  globally (`maxLiveTotal`, default 200 live sandboxes on the shared key).
  **Deployment constraint: run exactly one broker instance.** The owner lock and the global in-flight/live counters
  are in-process; with several replicas the per-owner quota race and the global cap overshoot come back. Scaling out
  needs a shared lock/counter (e.g. Redis/DB advisory lock) — not implemented. It forces snapshot, `public:false`, TTLs and labels, and rejects a `server.env` whose
  `ROX_WEBUI_OIDC_ALLOWED_SUBS` isn't the caller or whose `ROX_WEBUI_PASSWORD_LOGIN` isn't `0`. Provider errors are not echoed.

## 8. Errors (ru/en)
`disabled, no_key («Добавь свой ключ Daytona»), sign_in_required, sso_not_configured, web_host_required, too_large, quota_exceeded, provider_error, start_timeout, cancelled`.

## 9. Cleanup / TTL / cost
- auto-stop 30 min idle, auto-delete 24 h after stop; failure/cancel deletes the sandbox.
- Quota: 2 **live** (started/creating) sandboxes per owner; stopped ones don't count. Enforced on desktop (personal key)
  and in the broker (shared key).
- «Завершить» deletes now. A new handoff for the same chat deletes the previous sandbox **only after the new one is
  ready**; if the new one fails, the old session stays.
- One in-flight handoff per app. Flag default off.

## 10. Open items for Mark
- Deploy the broker on a Rox host (`ROX_CLOUD_HANDOFF_BROKER_ENABLED=1` + shared key) and give its URL.
- id.rox.one: public PKCE client for cloud sessions; redirect URI `https://cloud.rox.one/s/*/api/auth/callback` only (no
  Daytona wildcard); the desktop's client id for `ROX_CLOUD_HANDOFF_BROKER_ALLOWED_CLIENT_IDS` (+ introspection creds if
  access tokens are opaque); confirm the desktop Rox token is accepted by
  id.rox.one `userinfo` (if not, the desktop needs its own id.rox.one OIDC login).
- Web host / proxy `cloud.rox.one` (`ROX_CLOUD_HANDOFF_WEB_HOST`) — **required for production**.
- Build/publish `rox-session-server-v1` and run a real E2E. Startup import is wired: `bootstrapServer` calls
  `importCloudHandoffWorkspace` (server-core/src/bootstrap/cloud-handoff-import.ts) before the session manager
  loads, which validates `ROX_HANDOFF_WORKSPACE_DIR` (absolute, real dir, under `ROX_HANDOFF_ALLOWED_ROOT`
  default /home/daytona) and `ROX_HANDOFF_SESSION_ID`, rewrites the header's `workingDirectory` to `<ws>/project` and `sdkCwd` to the session dir,
  strips `sharedOwnerKey/sharedUrl/sharedId` (already stripped on the desktop before upload; re-done here as defence), and registers + activates the workspace idempotently
  (marker `.rox-handoff-imported`). A validation failure aborts startup, so the health check fails closed.
