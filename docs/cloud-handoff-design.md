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
1. User clicks «В облако» (visible only if flag on).
2. Renderer → `cloudHandoff:start {sessionId}` (LOCAL_ONLY channel, `access: localElectron`).
3. Server (desktop server-core): requires signed-in Rox ID (`sign_in_required`), resolves key, collects files,
   runs `runCloudHandoff` in background; renderer polls `cloudHandoff:status` every 1.5 s.
4. Orchestrator: per-owner quota → create sandbox (labels, auto-stop/delete) → start → resolve public URL →
   stream files → manifest + `server.env` → `rox-handoff-start` → poll `rox-handoff-health` → **ready**.
5. UI swaps the button for «Открыть в браузере» (https only) → browser hits sandbox web UI → id.rox.one OIDC →
   only the owner `sub` is admitted → user continues the chat.
Phases: `resolving_key → packaging → creating_sandbox → uploading (n/N) → starting → waiting_ready → ready | failed | cancelled`.
Cancel button aborts and deletes the sandbox.

## 3. Data packaging
- Session folder (`getSessionPath(workspace.rootPath, id)`) recursively → `bundle/session/**`
  (session.jsonl messages, attachments, plans, …).
- Workspace files the transcript references (absolute paths under the session `workingDirectory`, max 500),
  realpath-contained → `bundle/workspace/**`. Whole repos are **not** copied (decision: cost + secret risk).
- Symlinks never followed; `..`/absolute/backslash paths rejected.
- Secrets excluded by path (`.env*`, `*.pem|key|p12…`, `id_*`, `.npmrc/.netrc/.git-credentials`,
  `credentials*/secrets*/service-account*.json|yaml`, `cloud-runs.env`, `credentials.enc`, `.git/ node_modules/ .ssh/ .aws/ .kube/ .gnupg/ .docker/`)
  and by content (private keys, AKIA, sk-/sk-ant-, gh*_ , github_pat_, xox*, dtn_, AIza, plus the active Daytona key).
  Exclusions are listed in `manifest.json` (path + reason) and counted in the UI status.
- Limits: 25 MiB/file (skipped), 200 MiB total and 2 000 files (refuse whole handoff: `too_large`), sizes re-checked on real bytes.
- Format: plain files under `/home/daytona/rox-handoff/bundle/`, `manifest.json` (`version:1`, sha256 per file), streamed one file at a time.

## 4. Daytona usage
- Existing REST `HttpDaytonaClient` (no new dependency; the official `@daytonaio/sdk` maps 1:1 —
  `create({snapshot, env, public, autoStopInterval, autoDeleteInterval, labels})`, `fs.uploadFile`,
  `process.executeCommand`, `getPreviewLink(port)`; switch is possible later, tests use the mock either way).
- Snapshot/image: `rox-session-server-v1` (config `cloudHandoff.daytonaSnapshot`). **Must be built**: headless Rox
  server + web UI listening on 9100, plus two scripts:
  - `rox-handoff-start <root>`: read `server.env`, generate the web-UI JWT secret locally (`openssl rand`), import
    `bundle/` as a workspace + session, start the server with OIDC env, password login disabled, detach.
  - `rox-handoff-health <root>`: exit 0 when `http://127.0.0.1:9100/api/health` is OK.
- Labels: `rox.cloud-handoff=1`, `rox.cloud-handoff.owner=<sha256(sub) prefix>` (no raw identity), `rox.cloud-handoff.id`.

## 5. URL scheme
- Sandbox is **always private** (`public:false`): a public Daytona sandbox exposes every port, including the
  web terminal on 22222.
- With web host (`cloudHandoff.webHost` / `ROX_CLOUD_HANDOFF_WEB_HOST`, e.g. `https://cloud.rox.one`):
  `https://cloud.rox.one/s/<handoffId>/`; our proxy forwards to the sandbox with Daytona auth.
- Without: a **signed, port-scoped** Daytona preview URL for port 9100
  (`/ports/9100/signed-preview-url?expiresInSeconds=(autoStop+autoDelete)`), `https://9100-<token>.<proxy-domain>/`.
- Behind either, the in-app id.rox.one OIDC owner gate is mandatory (`sso_not_configured` otherwise).
- Only https URLs are accepted/opened.

## 6. SSO / ownership
- OIDC issuer `https://id.rox.one` (override `cloudHandoff.ssoIssuer`), public PKCE client
  (`cloudHandoff.ssoClientId` / `ROX_CLOUD_HANDOFF_OIDC_CLIENT_ID`), redirect `<publicUrl>/api/auth/callback`.
- Owner = desktop Rox ID account `user.id` (assumed equal to id.rox.one `sub`) → `ROX_WEBUI_OIDC_ALLOWED_SUBS`.
- No tokens leave the desktop. The sandbox mints its own session cookie after OIDC. Billing owner of the sandbox
  = owner of the Daytona key (user's org or Rox's org for the default key).

## 7. Key resolution
1. User key — encrypted credential store (`service_oauth::global::daytona-cloud-handoff`, AES-GCM file / OS-backed);
   set/clear only, never readable from renderer; validation is shape-only.
2. Server default — `ROX_CLOUD_HANDOFF_DAYTONA_API_KEY` in the **server process env** only; never returned by any RPC
   (`getConfig` exposes booleans). Can be forbidden with `cloudHandoff.allowServerDefaultKey=false`.
3. Unreadable store ⇒ `no_key` (never silently bill the shared key). Neither ⇒ `no_key` → key dialog.
Keys are scrubbed from every error string.

## 8. Errors (UI copy in ru/en)
`disabled, no_key, sign_in_required, sso_not_configured, too_large, quota_exceeded, provider_error, start_timeout, cancelled`.

## 9. Cleanup / TTL / cost safety
- `autoStopInterval` 30 min idle, `autoDeleteInterval` 24 h after stop.
- Any failure/cancel after creation deletes the sandbox.
- Quota: max 2 live handoff sandboxes per owner (label query) before creating.
- One in-flight handoff per app (non-atomic quota), dedupe per chat. Status kept in memory 1 h.
- Flag default off.

## 10. Open items needing Mark
- Default key env name `ROX_CLOUD_HANDOFF_DAYTONA_API_KEY` + where it lives: in a desktop build server-core runs on
  the user's machine, so a “server default” there would be on the client. Production needs a Rox-hosted broker
  (`cloud.rox.one`) that creates sandboxes with our key on behalf of an id.rox.one-authenticated user.
- id.rox.one OIDC client registration (public PKCE client id, allowed redirect `https://cloud.rox.one/s/*/api/auth/callback`
  or wildcard preview domain).
- Web host for sessions (`cloud.rox.one`?) + the proxy.
- Building/publishing the `rox-session-server-v1` Daytona snapshot with the two scripts.
- Confirm Rox account `user.id` == id.rox.one `sub`.
