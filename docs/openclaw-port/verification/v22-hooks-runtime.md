# V22 — hooks ingress over real HTTP (port row f.8)

- Repo: `/Users/t/Projects/rox-w3-int` (branch `port/w3-int`)
- HEAD verified: `4407bc340` (`fix(openclaw-port): pass the buffered node body as an ArrayBuffer to Request`)
- Platform: darwin 27.0.0 arm64 · bun 1.4.2
- Targets: `packages/server-core/src/scheduler/{hooks-http.ts,hooks-node.ts}` + the bootstrap wiring in `packages/server-core/src/bootstrap/headless-start.ts`
- Date: 2026-10-09
- Verdict: **PASS — every ticket claim verified against real processes, real HTTP, real WS RPC and a real session store; no FAIL defects.**

> Revision note: this file was checked against `98e1e5cc4` at the start and re-run in full
> against `4407bc340` after a peer landed `4407bc340` (a 7-line `toWebRequest` body-type fix in
> `hooks-node.ts`). **All evidence below is from `4407bc340`** (uncommitted source tree matched
> HEAD throughout: `git status --porcelain` showed only untracked verification docs).

## Method

Two independent, real drivers (no unit tests):

1. **Bootstrap driver** (`/tmp/v22/driver.ts`, scratch — not in the repo). Calls the real
   `bootstrapServer()` from `headless-start.ts` on **port 0**, with a real `SessionManager`
   (`@rox/server-core/sessions`), the real `WebUI` handler (`createWebuiHandler` +
   `nodeHttpAdapter` on fixture HTML), and a token passed through `options.hooksToken`. This is
   the exact wiring `packages/server/src/index.ts` assembles. It registers a real hook listener
   via `instance.scheduler.hooks.on('deploy', …)`, creates a **real session** via
   `sessionManager.createSession()` and reads the persisted transcript from disk
   (`loadSession()`). Every console line is captured to prove the token never reaches a log.

   ```sh
   cd /Users/t/Projects/rox-w3-int
   ROX_CONFIG_DIR=/tmp/v22/config CRAFT_CONFIG_DIR=/tmp/v22/config \
   CRAFT_BROWSER_BACKEND=none CRAFT_IS_PACKAGED=false V22_HTTP_HANDLER=webui \
   V22_SERVER_TOKEN=v22-server-token-0123456789abcdef \
   HOOKS_TOKEN=v22-hooks-token-0123456789abcdef \
   bun /tmp/v22/driver.ts                       # -> 13/13 PASS
   ```
   No-token variant (route must not exist):
   ```sh
   ROX_CONFIG_DIR=/tmp/v22/config2 CRAFT_CONFIG_DIR=/tmp/v22/config2 \
   CRAFT_BROWSER_BACKEND=none CRAFT_IS_PACKAGED=false V22_HTTP_HANDLER=none \
   V22_SERVER_TOKEN=v22-server-token-0123456789abcdef \
   bun /tmp/v22/driver.ts                       # -> 12 + 12b PASS
   ```

2. **Real standalone binary** (`packages/server/src/index.ts`) spawned cross-process with a
   fixture WebUI dir and a fresh config profile, then driven with **`curl`** (script
   `/tmp/v22/real-final.sh`). The binary calls `bootstrapServer` without `options.hooksToken`,
   so the token comes from `getEnv('HOOKS_TOKEN')` → **`ROX_HOOKS_TOKEN`** (or the legacy
   `CRAFT_HOOKS_TOKEN`). NB: the un-prefixed `HOOKS_TOKEN` env var is **not** read.

   ```sh
   ROX_CONFIG_DIR=/tmp/v22/rf ROX_SERVER_TOKEN=v22-server-token-0123456789abcdef \
   ROX_HOOKS_TOKEN=v22-hooks-token-0123456789abcdef \
   CRAFT_RPC_PORT=64130 CRAFT_RPC_HOST=127.0.0.1 CRAFT_HEALTH_PORT=0 \
   CRAFT_WEBUI_DIR=/tmp/v22/rf/webui CRAFT_BROWSER_BACKEND=none CRAFT_IS_PACKAGED=false \
   bun packages/server/src/index.ts
   ```

## (1) Registered event + bearer → 200 `{invoked}` and the listener gets the exact JSON body

**PASS.** Driver request body `{"branch":"main","sha":"abc123","nested":{"n":[1,2,3]}}`:

```
[fetch] POST /hooks/deploy -> 200 body={"invoked":1,"failures":0}
status=200 body={"invoked":1,"failures":0} listener=[{"branch":"main","sha":"abc123","nested":{"n":[1,2,3]}}]
```

`JSON.stringify(listener[0]) === JSON.stringify(requestBody)` — the listener received the payload
byte-for-byte. A second delivery via the `X-Rox-Hook-Token` header also returned
`{"invoked":1,"failures":0}`.

Against the **standalone binary** the same request returns `404 {"error":"unknown hook event"}`,
because the stock server registers no hook listeners (see *Unproven*); the 200-dispatch path is
proven through the real bootstrap + a real registered listener above.

## (2) Missing / wrong token → 401

**PASS.**

```
[fetch] POST /hooks/deploy -> 401 body={"error":"unauthorized"}     (no Authorization)
[fetch] POST /hooks/deploy -> 401 body={"error":"unauthorized"}     (Bearer wrong-token-xxxx)
```
Standalone binary: `POST /hooks/deploy no-token -> 401 {"error":"unauthorized"}`,
`POST /hooks/deploy wrong -> 401 {"error":"unauthorized"}`.

## (3) `?token=…` → 400

**PASS.** Rejected before anything else (`hooks-http.ts:287-289`):

```
[fetch] POST /hooks/deploy?token=[redacted] -> 400 body={"error":"token must not be sent in the query string"}
```
Standalone binary: `code=400 body={"error":"token must not be sent in the query string"}`.

## (4) GET → 405 with `Allow: POST`

**PASS** (`hooks-http.ts:292-294`):

```
[fetch] GET /hooks/deploy -> 405 allow=POST body={"error":"method not allowed"}
```
Standalone binary: `GET /hooks/deploy -> code=405 allow=POST body={"error":"method not allowed"}`.

## (5) Unregistered event → 404 **without reading the body**

**PASS.** The ingress checks `hooks.listenerCount(subpath) === 0` (`hooks-http.ts:324-326`) before
`readBoundedBody`, so the 256 KiB cap never runs and no 413 is possible. Sent 4 MiB with a
`Content-Length` and 4 MiB streamed with no `Content-Length` (chunked `duplex:'half'`):

```
[fetch] POST /hooks/unknown-event    -> 404 body={"error":"unknown hook event"}   (4 MiB body)
[fetch] POST /hooks/unregistered-streamed -> 404 body={"error":"unknown hook event"} (4 MiB streamed, no Content-Length)
```
Both returned 404, never 413 — the oversized body was not buffered.

## (6) Over-limit body → 413

**PASS.** Default limit is 256 KiB (`hooks-http.ts:105`). 300 KiB to a **registered** event:

```
[fetch] POST /hooks/deploy -> 413 body={"error":"payload too large"}
```

## (7) Bad JSON → 400

**PASS** (`hooks-http.ts:334-338`):

```
[fetch] POST /hooks/deploy -> 400 body={"error":"invalid JSON body"}     (body "{not json")
```

## (8) >20 auth failures in a minute → 429 with `Retry-After`

**PASS** (`FailureThrottle`, `hooks-http.ts:137-182`, `THROTTLE_MAX_FAILURES = 20`). 21 failures
from `X-Forwarded-For: 198.51.100.9`; first 20 → 401, the 21st → 429:

```
... 20 × [fetch] POST /hooks/deploy -> 401 body={"error":"unauthorized"}
[fetch] POST /hooks/deploy -> 429 retry-after=60 body={"error":"too many failed attempts"}
```
`Retry-After: 60` was present. A correct token still succeeds while throttled (success clears the
per-IP entry, `hooks-http.ts:311`). Snapshot: `{"throttled":1, ...}`.

## (9) `/hooks/wake` lands in a real session (asserted through the session store)

**PASS.** A real session was created with `sessionManager.createSession(workspaceId, …)` on a real
workspace; the wake target's transcript was then read back **from the persisted session file**:

```
[fetch] POST /hooks/wake -> 200 body={"ok":true}
status=200 body={"ok":true} sessionId=261009-brave-sage persistedMessages=[{"content":"WAKE-FROM-HOOKS-v22"},{"content":"ROX_TRUSTED_ACCOUNT_REQUIRED"}]
```
The first persisted message is exactly `WAKE-FROM-HOOKS-v22`. The dispatcher is
`createHooksWakeDispatcher(sessionManager)` (`headless-start.ts:231-241`), which calls the real
`SessionManager.sendMessage` — no second delivery path.

Standalone binary: `POST /hooks/wake {"sessionId":"nope",…} -> 500 {"error":"wake dispatch failed"}`
(the real `sendMessage` throws `Session nope not found`) and
`{"sessionId":…}`-invalid body → `400 {"error":"invalid wake payload"}`, confirming the route is
bound to the real session path.

## (10) With the WebUI handler composed, GET / still serves it

**PASS.** The ingress only claims its prefix; everything else reaches `next`
(`hooks-node.ts:91-118`). Composed real `createWebuiHandler`:

```
[fetch] GET /           -> 302 location=/login
[fetch] GET /login      -> 200 body=<!doctype html><html><body>V22-WEBUI-LOGIN</body></html>
[fetch] GET /api/config -> 401
```
Standalone binary: `GET /login -> 200 (fixture HTML)`, `GET / -> 302 /login`. The `/hooks/*`
routes did not shadow any of these.

## (11) The token never appears in the logs

**PASS.**
- Driver (all console output captured, my own request echo redacts the URL):
  `log lines captured=159 lines containing a token=0`.
- Standalone binary server log (`/tmp/v22/real-server.log`):
  `hooks-token occurrences: 0`, `server-token occurrences: 0`. The only auth-failure lines are:
  ```
  ... WARN  [hooks] rejected unauthenticated hook request from unknown
  ```
  which never include the presented secret (the token is only compared via
  `secureTokenCompare`, `headless-start.ts:202-206`).

## (12) No token configured → route does not exist (no 401 oracle)

**PASS.**
- Bootstrap driver with the default next handler (`httpHandler` absent → `notFoundHandler`,
  `hooks-node.ts:18-21`): `POST /hooks/deploy -> 404 body=Not Found`; snapshot `null`.
- Bootstrap driver with the real WebUI composed and no token: `POST /hooks/deploy -> 404`, and
  `hooksIngressSnapshot()` is `null` (`headless-start.ts:561-569` installs the ingress only when a
  token exists).
- Standalone binary with no `ROX_HOOKS_TOKEN`: `POST /hooks/deploy` and the non-hooks
  `POST /random-route` are **byte-identical** (`401 {"error":"Unauthorized"}` — the WebUI's own
  uniform gate), so the hooks path exposes no distinguishable oracle:
  ```
  POST /hooks/deploy                       code=401 body={"error":"Unauthorized"}
  POST /random-route                       code=401 body={"error":"Unauthorized"}
  GET /hooks/deploy                        code=401 body={"error":"Unauthorized"}
  GET /login                               code=200 body=<!doctype html><body>V22-REAL-LOGIN</body>
  ```

## Observations (not ticket failures, not defects in f.8)

- **`/hooks/wake` is synchronous with the turn.** `dispatchWake` awaits `sendMessage`, which runs
  the full session turn before resolving. In the driver the wake returned `200` only after the
  turn finished; in one run the turn's source provisioning (a `codegraph/graph-db` file-lock
  conflict + a `qdrant` `pydantic-core` build) pushed the response past a 20 s client timeout.
  Callers should use a generous timeout; this is by design (no second delivery path) but is worth
  knowing.
- **Startup event-loop stall.** For ~18–48 s after `Rox server listening …` is printed, HTTP
  requests to the RPC port do not get a response. Cause observed in the log: the bundled-skills
  sync runs **inline on the main thread** (`[bundled-skills] background sync finished
  {"via":"inline","durationMs":36177}`); the port answers once it completes. Not specific to the
  hooks ingress, but it delays first reachability of `/hooks`.

## Unproven / not tested

- The **200 `{invoked}` dispatch** and the **429 throttle** were proven through the real
  `bootstrapServer` + a real registered listener, **not** through the standalone binary — the
  stock binary registers no hook listeners, so `POST /hooks/<event>` there always returns
  `404 unknown hook event`. There is no external RPC to register a hook listener.
- `413` was only exercised at the default 256 KiB `bodyLimitBytes` (no custom limit).
- `?token=`, `405`, `401`, `400`, `500`, `wake` and log-leak were exercised against the standalone
  binary; `200`-dispatch, `413`, chunked `404` and the real-session wake store read were exercised
  through the bootstrap driver.
- No workspace-wide gate was run (`typecheck:all`, full `bun test`, `run-gates.sh`) — out of scope
  by instruction.