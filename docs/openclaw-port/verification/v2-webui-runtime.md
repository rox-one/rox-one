# V2 — WebUI security runtime verification (slice S3 + fix-s3-handoff)

Rows: **b1.4** (pairing handoff), **b1.5** (CSP / security headers), **g.7** (WebUI host).
Verifier: `w1-verify-2`. Date: 2026-10-09. Tree: `port/openclaw-features` @ `cdcd4c50f`.

## Surface driven

Real embedded topology (same as `packages/server/src/index.ts`): a real `WsRpcServer`
(`packages/server-core/src/transport/server.ts`) listening on `127.0.0.1:19142` with
`httpHandler = nodeHttpAdapter(createWebuiHandler(...).fetch)`, `validateSessionCookie` wired to the
real `validateSession(secret)`, `allowedWebUiOrigins: ['https://dash.example.com']`, and the real
built SPA (`apps/webui/dist`, produced by `bun run webui:build`). Real TCP sockets, real HTTP/1.1
requests and real WebSocket upgrades.

Harness: `/tmp/v2-harness.ts` (throwaway, no repo files touched).

```
$ bun run webui:build              # required to exercise the real dist (built in ~83s)
$ timeout 120 bun /tmp/v2-harness.ts > /tmp/v2-runtime.log 2>&1   # exit 0
$ lsof -nP -iTCP:19142   # empty afterwards; no process left (verified)
```

---

## (a) CSP + security headers on served HTML — **PASS**

Every response passes through `withWebuiSecurityHeaders` (`packages/server-core/src/webui/http-server.ts:645`).

Exact header for `GET /login` (200):

```
content-security-policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'self'; form-action 'self'; script-src 'self' 'sha256-eU43+B7RzrzwFaybbAuySV7Evr9jK7p0OsZGqRC+3cM='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; media-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; manifest-src 'self'
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: no-referrer
```

Exact header for `GET /handoff` (`Accept: text/html`, 200) — the SHA-256 differs because the served
document has a different inline script:

```
content-security-policy: ... script-src 'self' 'sha256-tkzi7Rbz/V8AcRuEsXDTGbM53kCDNtWtwy+fPzPQG4E='; ...
```

Exact header for the session-gated SPA index `GET /` (with cookie, 200) — no inline script, no hash:

```
content-security-policy: ... script-src 'self'; ...
```

The hashes are the true SHA-256 of the bytes actually served (verifier recomputed
`sha256(base64)` of each inline `<script>` body and asserted membership in `script-src`):
login hash `eU43…` and handoff hash `tkzi…` were both present. No `'unsafe-inline'` in `script-src`
(present only in `style-src`, documented deliberate).

**Nuance (not a failure):** `connect-src 'self' ws: wss:` uses *scheme sources*, so a script from an
allowed origin could open a `ws://`/`wss://` connection to any host, not only same-origin. This is
exactly the value mandated by the S3 brief (`docs/openclaw-port/slices/BRIEFS.md:125`), so it is
PASS against the spec as written; the scheme-wide reach is a design point worth noting, not a defect
introduced by the port.

## (b) WS upgrade origin allow-list, enforced pre-auth — **PASS**

`verifyClient` runs at the HTTP upgrade, before any WS handshake (`server.ts:685`, `allowUpgrade`
`server.ts:825-834`). Real `ws@8.21.0` client upgrades:

```
evil+cookie       = REJECTED 401     # Origin https://evil.example.com, valid craft_session cookie
same-origin+cookie= OPEN             # Origin http://127.0.0.1:19142 (host-matching)
allow-listed+cookie= OPEN            # Origin https://dash.example.com (allowedWebUiOrigins)
evil+no-cookie    = OPEN             # non-browser / no WebUI cookie → admission unchanged (by design)
```

Cross-site cookie-bearing upgrade is refused at the HTTP layer (401) before authentication; the
same-origin and explicitly allow-listed origins complete the upgrade. Fail-closed on mismatch.

## (c) Handoff mint / redeem / replay / expiry — **PASS**

```
POST /handoff/mint   (cookie + same-origin)      → 200 {"url":"http://127.0.0.1:19142/handoff#<token>","expiresAt":...}
GET  /handoff        (X-Handoff-Token: tokenA)   → 200 {"ok":true} + Set-Cookie: craft_session=…; HttpOnly; SameSite=Strict; Path=/
GET  /handoff        (X-Handoff-Token: tokenA)   → 401 {"error":"Invalid handoff token"}     # replay, single-use
[mint tokenB, sleep 3.5s > TTL 3000ms]
GET  /handoff        (X-Handoff-Token: tokenB)   → 401 {"error":"Handoff token expired"}     # expiry
GET  /handoff?handoff=<tokenA> (no header)        → 200 pairing page                          # query token NOT honoured
```

Server log corroborates: `[info] [webui] Handoff token minted`, `[info] [webui] Handoff token
redeemed`, `[warn] [webui] Handoff redemption rejected (invalid)`, `… (expired)`. Redemption is
single-shot regardless of outcome (`handoffStore.redeem` deletes the digest on first attempt,
`auth.ts:235-241`).

## (d) Credential never in a URL query / server log — **PASS**

- Minted URL carries the token in the **fragment**: `http://127.0.0.1:19142/handoff#<token>` —
  `'?' in URL = false`. Fragments are never sent to the server.
- The server's own log lines were captured and grepped for the exact token value → **not found**
  (only `Handoff token minted/redeemed/rejected` are logged, `http-server.ts:396,404,433`).
- A token supplied in the query string is ignored (served the pairing page, not redeemed) — the
  credential is read only from the `X-Handoff-Token` header (`http-server.ts:374-375`).

## (e) Pairing page self-contained — **PASS**

`GET /handoff` body: single inline `<script>`, **no `<script src=…>`**, **no `/assets/` reference**,
`Cache-Control: no-store`. Its inline script's SHA-256 is folded into that response's `script-src`,
so it runs under the strict CSP without `'unsafe-inline'` (`renderHandoffPage`, `http-server.ts:150-226`).

Contrast proving why: `GET /assets/main-xkl7GdKU.js` with no cookie → `401 {"error":"Unauthorized"}`
— the SPA bundle is session-gated, so a cookie-less pairing device could not use it; the handoff page
therefore ships its own bootstrap.

---

## Verdict summary

| Claim | Verdict |
|---|---|
| (a) CSP w/ SHA-256 hashes + `connect-src 'self' ws: wss:` on served HTML (/login, /handoff, /) | **PASS** |
| (b) WS upgrade rejected for disallowed Origin, allowed for same/allow-listed, fail-closed pre-auth | **PASS** |
| (c) handoff mint → single-use redeem → replay 401 → expired 401 | **PASS** |
| (d) no credential in URL query or server log; query token ignored | **PASS** |
| (e) pairing page self-contained (hashed inline script, no gated bundle) | **PASS** |

**Unproven / out of scope:** `fix-s3-handoff`'s fragment redemption *inside the SPA*
(`apps/webui/src/adapter/transport-bootstrap.ts`) was not driven in a real browser (no headless
browser session in this check); the server-side handoff contract it depends on (mint/redeem/expiry/
replay, fragment not in query) is verified above. No failures reproduced; nothing left unproven on
the HTTP/WS surface.