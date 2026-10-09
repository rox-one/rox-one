# V1 — multi-user runtime verification (slice S1 attribution/visibility + S2 presence)

Rows: **a1.1** (actor kinds + creator attribution), **a1.3** (creator/owner/participants + `sessions:assignOwner`),
**a1.4** (presence map / TTL).
Fixes exercised: **port/fix-s1-access** (`086fcec34`), **port/fix-s2-presence** (`7c85640a2`).
Verifier: `w1-verify-1`. Date: 2026-10-09. Tree: `port/openclaw-features` @ `cdcd4c50f` (contains the merged port).

## Surface driven (real processes / real WS RPC / real files)

- **Server**: the real entry point `bun run server:start` (`packages/server/src/index.ts` →
  `bootstrapServer` → real `WsRpcServer`), listening on `ws://127.0.0.1:19011`.
- **Client**: the real transport client `WsRpcClient` (`packages/server-core/src/transport/client.ts`)
  over a real TCP WebSocket with the real bearer handshake (`CRAFT_SERVER_TOKEN`).
- **State dir (isolated)**: `ROX_CONFIG_DIR=/tmp/v1-state` (its `config.json` seeds one personal
  workspace `11111111-2222-3333-4444-555555555555` rooted at `/tmp/v1-ws`); persisted session records
  read back from `/tmp/v1-ws/sessions/<id>/session.jsonl`. No repo files touched; harness is
  `/tmp/v1-client.ts`.
- Messaging disabled (`CRAFT_DISABLE_MESSAGING=true`), browser backend `none`. One client connection;
  the actor id the server compares for a token-authenticated local caller is `installation`
  (`LOCAL_ROX_CALLER.subject`, `packages/shared/src/auth/rox-account-authority.ts`).

```
$ ROX_CONFIG_DIR=/tmp/v1-state CRAFT_SERVER_TOKEN=v1-token-0123456789abcdef0123456789abcdef \
  CRAFT_RPC_PORT=19011 CRAFT_RPC_HOST=127.0.0.1 CRAFT_DISABLE_MESSAGING=true \
  CRAFT_BROWSER_BACKEND=none CRAFT_PRINT_TOKEN=1 CRAFT_VERSION=0.0.0-v1 \
  timeout 300 bun run server:start > /tmp/v1-server.log 2>&1 &
...
INFO  Rox server listening on ws://127.0.0.1:19011
CRAFT_SERVER_URL=ws://127.0.0.1:19011

$ timeout 150 bun /tmp/v1-client.ts        # exit 0; full JSON transcript at /tmp/v1-result.json
$ pkill -f "packages/server/src/index.ts"  # afterwards: lsof -iTCP:19011 empty, 0 matching processes
```

Because a token-authenticated caller has `principal = null`, all RPC calls run the **no-principal
branch** (`assertNativeWorkspace`/`assertNativeSession` no-op, `sessionActorIdFor` → `installation`).
To reach the other-actor enforcement path, the owner of a session was set to a distinct account
(`other-actor`) via the real `sessions:assignOwner` RPC — the same id the server compares.

---

## (a) creator is write-once — **PASS**

`sessions:create` captured the creator once (`SessionManager.createSession`,
`packages/server-core/src/sessions/SessionManager.ts:4155-4165`); `sessions:assignOwner` mutates only
`owner` (`SessionManager.ts:9530-9554`).

`create:return` (id `261009-crisp-channel`):

```json
"creator": { "accountId": "installation", "displayName": "Local", "kind": "profile" }
```

After `sessions:assignOwner <id> {"kind":"account","id":"other-actor","displayName":"Other Actor"}`
(re-read through `sessions:get` **and** the persisted record):

```json
"creator":  { "accountId": "installation", ... },           // unchanged
"owner":    { "kind":"account","id":"other-actor","assignedAt":1791527492956,"assignedBy":"installation" },
"participants": [ {"accountId":"installation",...}, {"accountId":"other-actor",...} ]
```

Persisted `session.jsonl` header (first line) of `/tmp/v1-ws/sessions/261009-crisp-channel`:

```json
{"id":"261009-crisp-channel","creator":{"accountId":"installation","displayName":"Local","kind":"profile"},
 "owner":{"kind":"account","id":"other-actor",...},
 "participants":[{"accountId":"installation",...},{"accountId":"other-actor",...}], ...}
```

No RPC mutates `creator`; the only ownership mutation left it intact across the wire and on disk.
Verdict: **PASS**.

## (b) `assignOwner` from a non-privileged actor is REFUSED (fix-s1 self-assignment escalation) — **PASS**

Setup (all via real RPC on session `261009-smart-clay`): `setVisibility draft` while the caller is the
creator/owner → ALLOWED; then `assignOwner other-actor` while the caller is still the owner → ALLOWED.
The caller (`installation`) is now a **non-owner** of a `draft` session. Self-assignment attempt:

```json
$ sessions:assignOwner 261009-smart-clay {"kind":"account","id":"installation","displayName":"Self"}
{ "code": "SESSION_OWNER_ONLY",
  "message": "Session is a private draft owned by another actor" }
```

The escalation is closed: enforcement is in `assertSessionWriteAccess` at the top of the
`sessions:ASSIGN_OWNER` handler (`packages/server-core/src/handlers/rpc/sessions.ts:805-808`) and in the
`SESSION_WRITE_COMMANDS` gate for `sessions:command` (`sessions.ts:581-583`). Control (same caller,
`shared` session `261009-still-thunder`): `rename` → `ALLOWED`, so the gate is not a blanket deny.
Verdict: **PASS**.

## (c) visibility enforced SERVER-side, channel reachable — **PASS for writes / REFUTED for reads**

The client holds a live, authenticated channel (`sessions:get` succeeds) yet every write to the
restricted session is rejected server-side before the switch:

```json
$ sessions:command 261009-smart-clay {"type":"rename","name":"nope"}
{ "code":"SESSION_OWNER_ONLY","message":"Session is a private draft owned by another actor" }
$ sessions:command 261009-smart-clay {"type":"setVisibility","visibility":"shared"}
{ "code":"SESSION_OWNER_ONLY","message":"Session is a private draft owned by another actor" }
```

That is the a2.5 write gate (`evaluateSessionWriteAccess`, `SessionManager.ts:1279-1291`; hoisted in
`sessions.ts:581-583`). Enforcement is **server-side**, not a rendered menu state → **PASS**.

**But the read side is not visibility-filtered.** The same restricted `draft` session owned by
`other-actor` is still returned by `sessions:get` and fully readable via `sessions:getMessages`:

```json
$ sessions:get           -> returnedCount: 3 (includes 261009-smart-clay)
$ sessions:getMessages 261009-smart-clay -> { "result":"RETURNED", "id":"261009-smart-clay" }
```

`sessions:GET` (`sessions.ts:330-359`) returns `sessionManager.getSessions(workspaceId)` with no
visibility/participant filter; `sessions:GET_MESSAGES` (`sessions.ts:376-385`) has no visibility check
either. So a literal claim that a session "whose visibility excludes a viewer is **not returned** to
that viewer" is **REFUTED** — visibility gates *writes*, not *reads*. If read exclusion is intended, it
is unimplemented (suspected files: `packages/server-core/src/handlers/rpc/sessions.ts:330`, `:376`;
`SessionManager.getSessions`).

## (d) `sessions:bulkUpdate` cannot bypass visibility — **PASS**

```json
$ sessions:bulkUpdate { "workspaceId":"<ws>", "ids":["261009-smart-clay"], "patch":{"isArchived":true} }
{ "code":"SESSION_OWNER_ONLY","message":"Session is a private draft owned by another actor" }
```

The per-target check runs before the mutation (`sessions.ts:838-845`). Control on the shared session:

```json
$ sessions:bulkUpdate { "workspaceId":"<ws>", "ids":["261009-still-thunder"], "patch":{"isFlagged":true} }
{ "result":"ALLOWED", "r": { "ok":["261009-still-thunder"], "failed":[] } }
```

Verdict: **PASS** (no bypass).

## (e) presence/typing emits over the real event stream and expires by TTL — **PASS**

Over the real `session:event` push channel, from `SessionActivityTracker`
(`packages/server-core/src/collaboration/session-activity-tracker.ts`) driven by the real
`sessions:command` `setTyping`/`watchSession`:

```json
[event] session_typing {"type":"session_typing","sessionId":"261009-still-thunder",
  "actors":[{"accountId":"installation","displayName":"Local","expiresAt":1791527553006}]}
[event] session_presence {"type":"session_presence","sessionId":"261009-still-thunder",
  "viewers":[{"accountId":"installation","displayName":"Local","username":"installation",
              "role":"editor","status":"online","joinedAt":1791527493007}]}
```

After the real typing TTL (`SESSION_TYPING_TTL_MS = 60_000`) elapsed and the real 15 s sweep ran, the
tracker emitted the cleared state on the same stream:

```json
[event] session_typing {"type":"session_typing","sessionId":"261009-still-thunder","actors":[]}
```

TTL is real wall-clock (no clock faked in product code); the ignore-mid-typing heartbeat and the
`removeClient` teardown are in the same module. Verdict: **PASS** (typing TTL observed end-to-end).

### unproven

- **Viewer-presence expiry** (`SESSION_VIEWER_TTL_MS = 5 * 60_000`) was **not** observed: the 5-minute
  wait was outside the item budget. The same `sweep()`/`expireGroup` path reaps both maps
  (`session-activity-tracker.ts:150-163`), and typing expiry was observed, so the mechanism is shared —
  but viewer expiry itself is **unproven by direct observation**. Probe to settle it: call
  `setTyping`/`watchSession`, wait >300 s, assert a `session_presence` with `viewers: []`.
- Two-actor isolation was simulated by assigning a foreign owner id (one local token client). A true
  two-credential test (two distinct `Principal`s via native/cloud auth) was not driven; the compared
  actor id is exactly `sessionActorIdFor(ctx)`, which for a principal caller is `principal.subject`.

_Note:_ the server log shows an unrelated `pydantic-core==2.33.2` build failure from the `codegraph`
MCP source provisioner; it does not affect the sessions RPC surface or any verdict above.