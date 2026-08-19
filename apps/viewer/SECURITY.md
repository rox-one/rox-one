# Viewer Share API — Threat Model & Capability Design

Scope: `apps/viewer/functions/s/api.ts` (`POST /s/api`) and
`apps/viewer/functions/s/api/[id].ts` (`GET/PUT/DELETE /s/api/:id`), backed by the
R2 bucket `craft-session-shares`, fronted by Cloudflare Pages at `https://agents.rox.one`.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Share content integrity | A share URL is public; injected content (HTML/JS via the viewer's markdown pipeline) runs on `agents.rox.one` visitors. |
| Share availability | Only the owner may overwrite or delete their share. |
| R2 storage & bandwidth | Unauthenticated create endpoint is an abuse vector for storage/bandwidth cost. |
| Origin reputation | `agents.rox.one` hosts user content; abuse damages trust in the domain. |
| Owner capability secret (`ownerKey`) | Compromise = full mutation control over the share. |

## 2. Actors

- **Owner** — a Craft Agents desktop user who created the share ("Share Online").
- **Public reader** — anyone on the internet holding the share URL (intended: read-only).
- **Attacker** — unauthenticated internet user; may know a victim share id (e.g. from a
  forwarded link, logs, or a share they legitimately read) and wants to mutate it;
  may also flood the create endpoint.

## 3. Capability model

The core security invariant of this design:

> **Public read capability ≠ owner mutation capability.**

Two independent, unguessable tokens:

| Capability | Token | Entropy | Conferred power |
|---|---|---|---|
| Read | `shareId` (21 chars, 128-bit random) | ~2^128 | `GET /s/api/:id` — public by design |
| Owner mutation | `ownerKey` (base64url, 256-bit random) | 2^256 | `PUT`/`DELETE /s/api/:id` |

- The `ownerKey` is **independent of the share id**: knowing/reading a share yields zero
  information about its mutation capability.
- The server stores **only a SHA-256 hash** of the `ownerKey` in R2 object custom metadata
  (`ownerkeyhash`). A data-layer read of the bucket (listing/metadata dump) does not yield
  usable mutation capability. The raw key is returned exactly once, in the `POST /s/api`
  response, to the creating client.
- On the desktop, the `ownerKey` is persisted in the local `session.jsonl` header
  (`sharedOwnerKey`) — a user-owned file holding content at least as sensitive. It is sent
  only over TLS as `Authorization: Bearer <ownerKey>` and is **never exposed to renderer
  windows**: it is stripped from both the renderer `Session` DTO (`managedToSession`) and
  list `SessionMetadata` (`headerToMetadata`), and it is never logged.

## 4. Trust boundaries

1. **Internet ↔ Pages Functions** — unauthenticated, `Access-Control-Allow-Origin: *`.
2. **Pages Functions ↔ R2** — privileged; R2 is the single source of truth for shares
   and owner-key hashes.
3. **Desktop main process ↔ Pages API** — carries the `ownerKey` bearer token (TLS).
4. **Renderer ↔ main process** — the `ownerKey` does not cross this boundary.

## 5. Threats & mitigations

| # | Threat | Pre-fix | Mitigation (this change) |
|---|---|---|---|
| T1 | Share-id guessing/enumeration for reads | Read is public by design; id space is 128-bit | Acceptable residual; reads are intended public. |
| T2 | **Unauthorized overwrite / content injection** — `PUT /s/api/:id` was unauthenticated; attacker replaces a victim's share with hostile content rendered by the public viewer | Fully exploitable | `PUT` requires `ownerKey` (401 `SHARE_OWNER_KEY_REQUIRED` / 403 `SHARE_OWNER_KEY_INVALID`); hash compared in constant time. |
| T3 | **Unauthorized delete** — `DELETE /s/api/:id` was unauthenticated | Fully exploitable | Same owner-capability gate as T2. |
| T4 | Unauthenticated spam upload via `POST /s/api` | Open (by design — desktop has no account) | 25 MiB hard cap + best-effort per-IP in-isolate rate limit (429 `RATE_LIMITED`); recommend a Cloudflare **Rate Limiting rule** as the durable layer (see §7). |
| T5 | Oversized payload / memory DoS | Cap checked only after full body parse; post-parse used `String.length` (UTF-16 code units), so a payload under 25 MiB in UTF-16 but over in UTF-8 bytes was accepted | Early `Content-Length` check → 413 before reading the body; post-parse re-check uses UTF-8 byte length (`TextEncoder`). |
| T6 | CORS abuse (`*` origin lets any website call the API from a victim's browser) | Site could mutate any known share from any browser | Mutation now requires the `ownerKey`, which never enters a browser context (desktop main process only). A malicious site can still *create* shares (bounded by T4 mitigations) and *read* shares it already knows (public anyway). Therefore `*` origin is acceptable **only because mutation is capability-gated**; allow-listed methods/headers are kept to the exact set used (`GET, POST, PUT, DELETE, OPTIONS` / `Content-Type, Authorization, X-Share-Owner-Key`). |
| T7 | `ownerKey` theft at rest / in transit | n/a (no key existed) | SHA-256 hash at rest in R2; TLS in transit; desktop persistence is local-only and renderer-invisible; constant-time comparison (T8). |
| T8 | Timing side-channel on key check | n/a | SHA-256 digests compared with a fixed-length XOR-accumulator loop (no early exit). |
| T9 | Replay of a captured bearer token | n/a | All-or-nothing capability, TLS-only transport. No per-request signing — accepted for this scale. |
| T10 | Lost-update races on concurrent `PUT` | `head` → check owner → `put` with no precondition | `PUT` writes with R2 `onlyIf: { etagMatches }` from the `head` etag; failed precondition → 409 `SHARE_CONFLICT`. Client retries against the latest object. |
| T11 | MIME sniffing of share JSON as HTML/script | GET (and other responses) omitted `X-Content-Type-Options` | `nosniff` on all share API responses (CORS/JSON helpers and GET). |

## 6. Error taxonomy

All errors are JSON: `{ "error": "<human message>", "code": "<MACHINE_CODE>" }`.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_JSON` / `INVALID_SESSION_PAYLOAD` | Malformed body. |
| 401 | `SHARE_OWNER_KEY_REQUIRED` | Mutation attempted without `Authorization: Bearer` / `X-Share-Owner-Key`. Sent with `WWW-Authenticate: Bearer`. |
| 403 | `SHARE_OWNER_KEY_INVALID` | Key present but does not match the stored hash. |
| 403 | `LEGACY_SHARE_IMMUTABLE` | Share predates owner keys; mutation is permanently rejected (see §7). |
| 404 | `SHARE_NOT_FOUND` | Unknown (or already-deleted) share id — same response whether the id never existed or was revoked, so deletion is not distinguishable. |
| 409 | `SHARE_CONFLICT` | Conditional `PUT` lost the R2 etag race; retry. |
| 413 | `SHARE_TOO_LARGE` | Payload exceeds 25 MiB UTF-8 bytes (checked on `Content-Length` pre-read and on the parsed body). |
| 429 | `RATE_LIMITED` | Best-effort per-IP limit exceeded. |
| 503 | `SHARE_STORAGE_NOT_CONFIGURED` | R2 binding missing. |

## 7. Backward compatibility

- **Existing (legacy) shares in R2 have no `ownerkeyhash` metadata.** Policy: they remain
  **publicly readable forever**; **all mutations are rejected** with `403
  LEGACY_SHARE_IMMUTABLE` — never silently allowed. Rationale: any unauthenticated
  overwrite path is a live content-injection hole, and we cannot distinguish "original
  owner" from "attacker who knows the id" without a capability.
  - *Accepted trade-off:* owners of legacy shares cannot update or revoke them through the
    API. Cleanup path: bucket lifecycle rules / admin deletion (recommended follow-up:
    attach an R2 object expiration or run an operator cleanup for legacy objects).
  - The desktop client surfaces a typed error so the UI can tell the user to create a new
    share instead.
- **Old desktop clients** (pre-key) talking to the new API: `POST` still works and returns
  an extra `ownerKey` field they ignore — their shares become immutable-but-public (same
  posture as legacy). Their `PUT`/`DELETE` calls receive `401 SHARE_OWNER_KEY_REQUIRED`.
  This is the intended hardening: the unauthenticated mutation path is closed.
- **New desktop clients** talking to an old server: no `ownerKey` in the create response,
  so nothing is persisted; update/revoke send no header and behave as before.

## 8. Rate limiting & platform constraints

Cloudflare Pages Functions have **no durable per-request state**: module-level memory is
per-isolate, ephemeral, and not globally consistent. We implement a **best-effort**
in-memory sliding-window limiter (per `CF-Connecting-IP`, separate budgets for creates and
mutations). It caps abuse from single sources hitting a warm isolate but is not a
distributed guarantee.

**Required production follow-up (outside code):** configure a Cloudflare Rate Limiting
rule on `agents.rox.one/s/api*`, e.g. POST ≤ 30/min and PUT/DELETE ≤ 60/min per IP, plus
an optional managed challenge for repeated 429s. Also consider R2 object expiration for
legacy shares (see §7).

## 9. Key hygiene checklist (enforced in code)

- `ownerKey`: 32 bytes from `crypto.getRandomValues`, base64url-encoded (43 chars).
- Server stores SHA-256 hex of the key only; the raw key is never written to R2.
- Constant-time digest comparison.
- Desktop: persisted in the session file header only; stripped from renderer DTOs and
  session-list metadata; never logged; cleared on revoke and on session fork.
