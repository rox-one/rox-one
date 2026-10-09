# V15 — media tickets over real HTTP (signed `/media/...?ticket=` capability)

Rows: **b1.5** (CSP / security headers + signed media ticket).
Fix exercised: **port/w2-media** (`388067a39`, `W2-9 media ticket` in `docs/openclaw-port/STATUS.md:40`).
Verifier: `w2-verify-7`. Date: 2026-10-09. Tree: `main` @ `cfb1f1b8df0efc42621e9bf2cd5a356f4becfb50`.

Targets driven:

- `packages/server-core/src/webui/media-ticket.ts` — HMAC ticket mint/verify (`createMediaTicket`
  `:99`, `verifyMediaTicket` `:130`, constant-time compare `:151-158`, derived key `:68`).
- `packages/server-core/src/webui/http-server.ts` — `POST /media/ticket` (`:578-611`), `GET /media/*`
  (`:618-641`), CSP wiring (`:1020`).
- `packages/server-core/src/webui/static-file.ts` — path containment (`:14-28`).
- `packages/server-core/src/webui/csp.ts` — `connect-src` builder (`:95-102`, `:65-79`).

## Surface driven (real processes / real TCP / real files)

The **real standalone HTTP host** `startWebuiHttpServer()` (`http-server.ts:1041`) → `Bun.serve`
(bun 1.4.2), listening on an ephemeral `127.0.0.1` port, with a **real injected logger** that records
every `info/warn/error/debug` line. Real sessions are created by a real `POST /api/auth` login and the
returned `craft_session` JWT cookie; every media/mint call is a real `fetch` over TCP.

Isolated state: temp dirs under `/tmp/w7-media/` (`webui/` shell, `media/pic.png` + `media/note.txt`,
`state/` bound to `ROX_CONFIG_DIR`). No repo files touched. Harness: `/tmp/w7-media/harness.ts`
(throwaway); transcript: `/tmp/w7-media/out.txt`.

```
$ cd /Users/t/Projects/rox-one-port && git rev-parse HEAD
cfb1f1b8df0efc42621e9bf2cd5a356f4becfb50
$ ROX_CONFIG_DIR=/tmp/w7-media/state timeout 180 bun /tmp/w7-media/harness.ts
server A listening on http://127.0.0.1:56553
...                                                                      # exit 0, 4.3s
```

Two real hosts were started on ephemeral ports (server A = default config; server B = configured
cross-origin WS endpoints), then both `stop()`ped. No process was left bound (ports ephemeral; the
harness exits after `serverA.stop()/serverB.stop()`).

---

## (a) authenticated, same-origin mint + real session auth — **PASS**

```
=== 1. real login POST /api/auth ===
POST /api/auth -> 200 {"ok":true}
set-cookie: craft_session=eyJhbGciOiJIUzI1NiJ9.eyJzd... (cookie len 145)

=== 2. authenticated same-origin POST /media/ticket ===
POST /media/ticket -> 200 {"url":"/media/pic.png?ticket=v1.eyJwYXRoIjoiL21lZGlhL3BpYy5wbmciLCJleHAiOjE3OTE...
ticket: v1.eyJwYXRoIjoiL21lZGlhL... len=177
POST /media/ticket without cookie -> 401 {"error":"Unauthorized"}
POST /media/ticket cross-origin -> 403 {"error":"Cross-origin request rejected"}
POST /media/ticket path=/api/config -> 400 {"error":"Invalid media path"}
```

The mint requires a valid session cookie (`validateSession`, `http-server.ts:579-582`), a same-origin
request (`:583-586`) and a `/media/…` path that resolves inside `mediaDir` (`:593-595`). The three
negative controls (no cookie → 401, cross-origin `Origin: http://evil.example` → 403, non-media path →
400) show each gate is live, not implicit. Verdict: **PASS**.

## (b) one ticket serves several requests within TTL — **PASS**

```
=== 3. repeated GET /media/pic.png?ticket=... (media element re-requests) ===
GET #1 -> 200 content-type=image/png cache-control=private, no-store bytes=12 matches=true
GET #2 -> 200 content-type=image/png cache-control=private, no-store bytes=12 matches=true
GET #3 -> 200 content-type=image/png cache-control=private, no-store bytes=12 matches=true
GET Range bytes=0-3 -> 206 content-range=bytes 0-3/12 bytes=4
```

Three identical GETs plus a `Range` probe all succeed with one ticket, exactly the multi-request
pattern a `<img>`/`<video>` element produces. The returned bytes equal `media/pic.png`
(`89 50 4E 47 0D 0A 1A 0A 00 01 02 03`); `Cache-Control: private, no-store`. Verdict: **PASS** (single
ticket is reusable within TTL).

## (c) UNIFORM 403 for every failure mode; body leaks nothing — **PASS**

```
=== 4. rejection matrix (uniform 403) ===
[expired]            HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}
[tampered-signature] HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}
[cross-session]      HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}
[path-mismatch]      HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}
[no-cookie]          HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}
[malformed-0]        HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}   # v1.garbage.garbage
[malformed-1]        HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}   # garbage
[malformed-2]        HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}   # v1.only-two
[malformed-3]        HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}   # v1..
[malformed-4]        HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}   # v2.aaa.bbb (bad version)
[missing-ticket-param] HTTP 403 cache-control=no-store body={"error":"Media ticket rejected"}
UNIFORM 403 + identical body: true
any rejection body contains ticket material: false
control valid ticket -> 200
```

- **expired**: a ticket minted with a **real 150 ms TTL** and presented **400 ms later** (real
  wall-clock) → 403. Expiry is `payload.exp < now` in `verifyMediaTicket` (`media-ticket.ts:173`); TTL
  clamped to `1..15 min` at mint (`:108`).
- **tampered signature**: last base64url char of the real signature flipped → 403 (HMAC mismatch,
  `:146-158`).
- **cross-session**: ticket minted for session A's cookie fingerprint, presented with session B's
  cookie → 403 (`payload.sid !== params.sessionFingerprint`, `:176`).
- **path-mismatch / no-cookie / malformed / missing param**: all collapse to the same `null` →
  single `403 {"error":"Media ticket rejected"}` (`http-server.ts:619-622`).

Every rejection returns the **identical status + body + `Cache-Control: no-store`**; the body never
contains the presented ticket (no echo). Verdict: **PASS** (no failure-mode discrimination, no leak).

## (d) cross-session reuse refused in both directions — **PASS**

```
=== 5. cross-session with a second real session (session B) ===
second login -> 200; cookieB !== cookieA: true
ticket A + cookie B -> 403 {"error":"Media ticket rejected"}
ticket B + cookie A -> 403 {"error":"Media ticket rejected"}
ticket B + cookie B -> 200 (control)
```

Two **distinct real logins** (1.1 s apart so the signed JWTs differ) each mint a ticket; each ticket
is refused under the *other* session's cookie and accepted under its own. Binding is by SHA-256 of the
cookie token (`mediaSessionFingerprint`, `media-ticket.ts:76-80`). Verdict: **PASS**.

## (e) CSP stays hardened; `connect-src` never a bare scheme — **PASS**

Identical `Content-Security-Policy` on the media `200`, the media `403`, `GET /` (302) and `GET /login`:

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'self';
form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; media-src 'self' data: blob:;
connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'
```

Server A (no configured origins): **`connect-src 'self'`** — no bare `ws:`/`wss:` at all.

Server B (`publicWsUrl: wss://rt.example.com:9000`, `allowedWebUiOrigins: ['http://other.example:8443',
'https://secure.example', 'ftp://nope']`):

```
[B media-200] 200 CSP: ... connect-src 'self' wss://rt.example.com:9000 ws://other.example:8443 wss://secure.example; ...
```

Token analysis of both directives:

```
default tokens: ["'self'"] | bare-scheme present: False
B       tokens: ["'self'", 'wss://rt.example.com:9000', 'ws://other.example:8443', 'wss://secure.example']
        bare-scheme present: False | ftp://nope dropped: True
```

Every non-self source is an **explicit host origin** (`toConnectSrcOrigin`, `csp.ts:65-79`); `http`→`ws`
and `https`→`wss` as documented. No token equals `ws:` or `wss:`, and the non-http(s) `ftp://nope`
entry is silently dropped. `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` present on every response.

Note: at the older tree `cdcd4c50f` (V2, `v2-webui-runtime.md`) the header carried the bare
`connect-src 'self' ws: wss:`; the current tip emits neither bare scheme. This is the hardened form
required by the row. Verdict: **PASS**.

## (f) ticket material never appears in logs — **PASS**

All handler diagnostics go through the injected logger. Full captured media-related log surface for
the entire run (23 lines total; the media/mint-relevant ones shown):

```
captured log lines: 23
| INFO [webui] Media ticket minted
| WARN [webui] Rejected cross-origin media ticket mint request
| WARN [webui] Media request rejected          (x12)
| INFO [webui] Media ticket minted             (x2 more)
ticket material present in logs: false
```

Neither the minted ticket, the expired ticket, nor the tampered ticket string occurs in any log line;
only the fixed messages `[webui] Media ticket minted` (`http-server.ts:605`) and
`[webui] Media request rejected` (`:620`) are emitted. Verdict: **PASS**.

---

## Verdicts

| Claim | Verdict |
|---|---|
| Real host + real session auth + authenticated same-origin `POST /media/ticket` mint | **PASS** |
| One ticket serves several GETs (+ Range probe) within TTL | **PASS** |
| Uniform 403 (expired / tampered / cross-session / path-mismatch / no-cookie / malformed), body leaks nothing | **PASS** |
| Cross-session reuse refused in both directions | **PASS** |
| CSP hardened; `connect-src` limited to `'self'` + explicit configured origins, no bare `ws:`/`wss:` | **PASS** |
| Ticket material never present in logs | **PASS** |

No FAILs, so no defect/fix entries.

## Non-claims / unproven

- Expiry was exercised with a **real short TTL** (150 ms) rather than a multi-minute wall-clock wait;
  the clock-shift branch (`now` in the past) is the same `payload.exp < now` comparison and was not
  separately driven over HTTP.
- TTL clamping to the 15-minute maximum and the module-level behaviour for a wrong-secret signature
  are covered by `__tests__/media-ticket.test.ts`; this run only drove them through the HTTP surface
  where reachable.
- The `Range` request returned `206` with a correct `Content-Range` (Bun's `Bun.file` Response
  handling); it is reported as observed, not as a port requirement.