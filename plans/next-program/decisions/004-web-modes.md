# 004 — Web version modes (R16)

Ticket R16 (`docs/plans/2026-10-09-platform-program.md:50`): «Веб-версия: 2 режима
(быстрый чат / облачная ВМ), доступна сразу, кнопки «Продолжить в веб» /
«Перейти в приложение»».

**Status:** ACCEPTED — shipped slice. The web auth question is answered and this
record fixes the shipped landing and its honest states. The remaining R16 work
(the cloud-VM backend and the website buttons) lives outside this repository and
is **not scheduled** by this record. A follow-up slice (see *Slice 2* below)
fixed three honest gaps in the same files: the ignored mode choice, a `?mode=`
deep link, and an operator switch for the landing.

**Owner:** product (pzd). An agent must not invent a cloud-VM backend or website
changes from this note.

## Context

Before R16 the web UI had a WebSocket surface but no modes and no per-user
identity: access was a single shared password (with the cloud gateway behind a
shared bearer — see [`003-cloud-runs-auth.md`](./003-cloud-runs-auth.md)). The
R16 ticket carried the open question «решение по auth».

## Shipped auth decision (answers the R16 auth question)

**Per-user Rox ID sessions (Pocket ID OIDC) replace the shared
password/bearer for the web surface.** The shared-password path is retained only
as a deliberate operator opt-in, not as the default.

- OIDC login (discovery, JWKS, PKCE S256, RS256 `id_token` verification with
  `iss`/`aud`/`exp`/`nonce`/`sub`) and the session cookie (HS256) live in
  `packages/server-core/src/webui/auth.ts`; the HTTP routes are in
  `packages/server-core/src/webui/http-server.ts` (`GET /api/auth/login` →
  `GET /api/auth/callback`).
- Config is by environment: `ROX_WEBUI_OIDC_ISSUER`, `ROX_WEBUI_OIDC_CLIENT_ID`,
  `ROX_WEBUI_OIDC_CLIENT_SECRET`, `ROX_WEBUI_PUBLIC_URL`. With OIDC enabled,
  `POST /api/auth` returns 404 unless `ROX_WEBUI_PASSWORD_LOGIN=1`.
- The web surface renders the Electron renderer through the cookie-auth adapter
  `apps/webui/src/adapter/web-api.ts` (no bearer token; the browser session
  cookie rides the WebSocket upgrade).
- `GET /api/auth/me` reports `authMode` (`oidc` | `password`) and the signed-in
  user; `GET /api/config` advertises `authMode` in OIDC mode.

Evidence: `packages/server-core/src/webui/auth.ts`,
`packages/server-core/src/webui/http-server.ts`, `apps/webui/src/login.html`,
`apps/webui/src/adapter/web-api.ts`, and the wave-4 gate record in
`docs/plans/2026-10-09-platform-program.md:216-223`.

## What this slice ships

A **web-only two-mode landing** in `apps/webui` (new files, no desktop renderer
changes):

- `apps/webui/src/web-modes.ts` — pure mode-resolution logic:
  `resolveCloudVmState` / `probeCloudVmState` / `cloudVmStateMessageKey` /
  `isWebSession`. No React/DOM imports, unit-tested in isolation.
- `apps/webui/src/web-modes-landing.tsx` — the landing component: «Быстрый чат»
  (always available → chat surface) and «Облачная ВМ» (availability-aware).
- `apps/webui/src/App.tsx` — the gate: after the authenticated transport is
  ready the entry confirms the web session and shows the landing before mounting
  the shared renderer.
- `apps/webui/src/__tests__/web-modes.test.ts` — available / unavailable / error
  paths plus the wiring guard.

**Gate (strictly web sessions).** The landing is offered only when
`GET /api/auth/me` answers with a recognized `authMode`. An unconfirmed or
unrecognized session, and any `?sessionId=` deep link («Продолжить в веб»),
bypass the landing and mount the renderer exactly as before. The desktop app
never imports `apps/webui`, so the desktop renderer is unchanged by construction.

**Availability signal (honest states).** The cloud-VM tile reads the real host
status through the existing `cloudRuns.getCloudRunsConfig` RPC (the same signal
`apps/electron/src/renderer/components/cloud-runs/CloudRunsChip.tsx` uses). The
resolution is:

- `available` — `enabled === true` and a cloud provider (`daytona` | `native`)
  with `tokenConfigured === true` → an enabled «Открыть облако» button.
- `unavailable` — a concrete reason: `runs-disabled` (host disabled cloud runs),
  `local-provider` (host is on the local provider — not a cloud VM),
  `provider-key-missing` (names the provider), or `host-unavailable` (no status
  reported). Only a retry is offered, never a dead button or a fake success.
- `error` — the RPC rejected or the payload was not the documented shape
  (`probe-failed`), offered with a retry.

The button label and every state string are i18n keys added to all 12 locales
(`webui.modes.*`, 15 keys); `scripts/check-i18n-parity.ts` passes.

## Slice 2 (2026-10-10) — three honest fixes, no new backend

The slice-1 landing carried three gaps, all fixed inside the same
`apps/webui`/`server-core` files. No web-mode backend was added and the desktop
renderer is still untouched.

**W1 — the chosen mode is no longer discarded.** `WebModesLanding.onEnter(mode)`
was called with the mode but `App.tsx` ignored the argument. The entry now keeps
the selection in `entryMode` (`'chat' | 'cloud-vm' | null`) and uses it to pick
the branch. A `cloud-vm` entry is only ever reached through the availability
gate: the landing button is rendered solely in the `available` state, and the
deep link (below) probes before entering. When the probe cannot confirm a usable
provider the honest `web-modes.ts` state (the concrete reason) is what the user
sees — never a fabricated success or a dead entry. A dedicated cloud-VM surface
is still out of repository (see *Remaining R16*), so an entered `cloud-vm` mode
mounts the same shared workspace, where the existing cloud-runs entry point
lives; the record stays honest about that.

**W2 — `?mode=` deep link.** `parseWebEntryMode` validates the raw value beside
the rest of `web-modes.ts`; only `chat` and `cloud-vm` are accepted and anything
else (missing, `CHAT`, `cloud`, a trailing space) is ignored, keeping the
default entry flow. `?mode=chat` enters the chat surface synchronously.
`?mode=cloud-vm` runs the same `probeCloudVmState` gate as the tile: it enters
once the host reports an available provider and otherwise falls back to the
landing (which shows the honest reason). A `?sessionId=` deep link still wins and
mounts its session directly.

**W3 — operator landing switch.** `ROX_WEBUI_MODES_LANDING` (default **on**;
`0`/`false`, case-insensitive, turns it off) is read by `readModesLandingFromEnv`
in `packages/server-core/src/webui/http-server.ts`, overridable by the
`modesLanding` handler option, and published as `modesLanding` by
`GET /api/config` in **both** auth modes (the `authMode` field stays OIDC-only).
With the flag off the web entry skips the landing and enters the chat surface
directly — the pre-R16 behaviour. The client reads it through
`isModesLandingEnabled`, whose fallback is the documented default: an unreadable,
non-object, or field-less `/api/config` response keeps the landing **enabled**,
so a config hiccup cannot silently change the entry flow and only an explicit
`false` disables it.

Tests: `apps/webui/src/__tests__/web-modes.test.ts` (deep-link validation, the
cloud gate, the flag reader, and the wiring guards) and
`packages/server-core/src/webui/__tests__/http-server.test.ts` (env reader plus a
`/api/config` integration check for both flag states).

## Remaining R16 work (not scheduled)

1. **Cloud-VM backend / surface.** The actual cloud-VM web application source
   lives outside this repository — only in `rox-one/old` (`apps/web`) per
   `docs/plans/2026-10-09-platform-program.md:209`. Until it is restored here,
   «available» opens the chat surface where the existing cloud-runs entry point
   lives; a dedicated cloud-VM surface is not implemented.
2. **Website buttons.** «Продолжить в веб» / «Перейти в приложение» live in the
   website repository (the `rox-one-website` programme), not in this monorepo.
   Slice 2 still only supports the two web-side deep links: the `?sessionId=`
   session link and (since slice 2) `?mode=chat|cloud-vm`.
3. **Provider coverage.** `daytona` and `native` are treated as cloud providers;
   `local` is deliberately the chat mode. Extending the set is a code change in
   `apps/webui/src/web-modes.ts` plus its tests.

## What would flip this

A ticket that lands the cloud-VM backend inside this repository (a real start /
open action, not a navigation) and/or a website change for the R16 buttons.
Until then, keep the landing honest: no fabricated success, no dead buttons.

## Evidence

- R16 requirement: `docs/plans/2026-10-09-platform-program.md:50`.
- Cloud-runs auth binding: `plans/next-program/decisions/003-cloud-runs-auth.md`.
- Web auth code: `packages/server-core/src/webui/{auth,http-server}.ts`,
  `apps/webui/src/{login.html,adapter/web-api.ts}`.
- Cloud web-app source location: `docs/plans/2026-10-09-platform-program.md:209`.
- Availability RPC: `packages/server-core/src/handlers/rpc/cloud-runs.ts`
  (`RPC_CHANNELS.cloudRuns.GET_CONFIG`), consumed via
  `apps/electron/src/transport/channel-map.ts` and typed in
  `apps/electron/src/shared/types.ts`.
- This slice: `apps/webui/src/{web-modes.ts,web-modes-landing.tsx,App.tsx}`,
  `apps/webui/src/__tests__/web-modes.test.ts`, and the `webui.modes.*` keys in
  `packages/shared/src/i18n/locales/*.json`.
- Slice 2: `apps/webui/src/{App.tsx,web-modes.ts}`,
  `apps/webui/src/__tests__/web-modes.test.ts`,
  `packages/server-core/src/webui/http-server.ts`
  (`readModesLandingFromEnv`, `modesLanding`, `/api/config`),
  `packages/server-core/src/webui/__tests__/http-server.test.ts`.