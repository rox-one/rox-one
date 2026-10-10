# V12 — node/device registry runtime verification (f.9: registry + presence + pending invokes)

Targets: `packages/server-core/src/nodes/registry.ts`, `.../presence.ts`, `.../pending-invokes.ts`,
`packages/server-core/src/handlers/rpc/nodes.ts`.
Claims: (1) a declared-but-not-allowlisted command is refused **before dispatch** (nothing reaches the
node); (2) presence expires by TTL and a reconnect/heartbeat refreshes it; (3) pending invokes resolve
with typed terminal results (`ok`/`timeout`/refused/`offline`) and the store stays bounded under >N
concurrent invokes; (4) `nodes:*` channels are `REMOTE_ELIGIBLE` yet an unauthenticated context is refused.
Verifier: `w2-verify-4`. Date: 2026-10-09. Tree: `main` @ `cfb1f1b8d`.

## Surface driven (real processes / real WS RPC / real registry)

The production headless entry (`bun run server:start`, `packages/server/src/index.ts`) **does not** compose
a `NodeRegistry`: `createHandlerDeps` (`index.ts:272-300`) returns no `nodes` field, and
`registerCoreRpcHandlers` registers the node handlers only `if (deps.nodes)` (`handlers/rpc/index.ts:196`).
Verified live — the production server answers `nodes:list` with `CHANNEL_NOT_FOUND` (see observation O1).

So the surface is bound exactly as a device-owning host would (`deps.nodes = new NodeRegistry()`), onto the
**real transport** and through the **real registration function**:

- **Server**: real `WsRpcServer` (`packages/server-core/src/transport/server.ts`), bearer-auth on, listening
  on `ws://127.0.0.1:19012`; real `registerNodeHandlers(server, { nodes: registry })` — the same function
  `registerCoreRpcHandlers` calls (`handlers/rpc/index.ts:196`).
- **Registry**: the real `NodeRegistry`. Injected options (constructor params, not faked internals):
  `presenceTtlMs: 2000` (default `30_000`), `maxPendingPerNode: 4` (default `16`), `invokeTimeoutMs: 5000`.
  Tuned down only so real wall-clock expiry and the queue bound are observable in seconds.
- **Client / fake node transport**: the real `WsRpcClient` (`transport/client.ts`); it subscribes to the
  `nodes:invoke` push channel and answers via a real `nodes:invokeResult` RPC — i.e. it *is* the node.
  Harness: `/tmp/nodes-verify/server.ts`, `/tmp/nodes-verify/client.ts`; transcript
  `/tmp/nodes-verify/result.json`.

```
$ cd /Users/t/Projects/rox-one-port
$ nohup bun run /tmp/nodes-verify/server.ts > /tmp/nodes-verify/server.log 2>&1 & disown
$ tail -1 /tmp/nodes-verify/server.log
V12_NODES_SERVER_LISTENING ws://127.0.0.1:19012

$ timeout 120 bun run /tmp/nodes-verify/client.ts      # exit 0; full transcript at /tmp/nodes-verify/result.json
$ pkill -f nodes-verify/server.ts                      # afterwards: lsof -iTCP:19012 empty
```

Server-side allowlist pre-seeded for node `n1`: `commands: ['sys.echo','sys.slow','sys.secret']`
(default allowlist empty). The node declares `sys.echo`, `sys.slow`, `danger.exec`.

---

## (1) declared-but-not-allowlisted is refused BEFORE dispatch — **PASS**

`registry.invoke` authorizes before it creates any pending record (`registry.ts:236-261`); `authorize`
checks allowlist then declaration (`registry.ts:297-303`). Over real RPC:

```json
### s1:register
{ "nodeId":"n1", "declaredCaps":["camera","microphone"],
  "declaredCommands":["sys.echo","sys.slow","danger.exec"],
  "online":true, "authorizedCommands":["sys.echo","sys.slow"], "pendingInvokes":0 }

### claim1:declared-not-allowlisted
{ "result": { "result":"resolved", "r": { "status":"error", "invokeId":"", "nodeId":"n1",
      "command":"danger.exec",
      "error": { "code":"NOT_ALLOWLISTED", "message":"command danger.exec is not allowlisted for node n1" } } },
  "invokePushesForRefusal": [], "totalInvokePushes": 0 }
```

The node declares `danger.exec`; the server allowlist lacks it; the result resolves immediately with
`NOT_ALLOWLISTED` and **zero** `nodes:invoke` pushes reached the transport (`invokePushesForRefusal: []`,
and the running push count was still 0). The mirror direction is also enforced — allowlisted but undeclared:

```json
### claim1:allowlisted-not-declared
{ "status":"error", "invokeId":"", "command":"sys.secret",
  "error": { "code":"NOT_DECLARED", "message":"node n1 did not declare command sys.secret" } }
```

`declaredCaps` are stored as claims only (`registry.ts:149`, surfaced in `NodeView`, never consulted by
`authorize`) — a declaration cannot widen a node's own authority. Verdict: **PASS**.

## (2) presence expires by TTL; heartbeat/reconnect refreshes it — **PASS**

TTL is real wall-clock (`PresenceTracker.isOnline`, `presence.ts:55-58`; default `DEFAULT_PRESENCE_TTL_MS = 30_000`,
`presence.ts:15`). Same node, read through `nodes:list`:

```json
### claim2:ttl-expiry
"whileOnline": { "online": true,  "authorizedCommands": ["sys.echo","sys.slow"], "lastSeenAt": 1791552993800 }
"afterTtl":    { "online": false, "authorizedCommands": [],                      "lastSeenAt": 1791552993800 }
```

After the tuned 2000 ms TTL elapsed (query at +2300 ms), the node is `online:false` and its authorized
command set is empty (`NodeView`, `registry.ts:307-326`). Heartbeat (`nodes:presence` → `registry.touch`)
and reconnect (`nodes:register` → `registerNode` → `presence.touch`, `registry.ts:158`) both revive it:

```json
### claim2:heartbeat-refresh
"heartbeat": { "nodeId":"n1", "lastSeenAt":1791552997625, "online":true }
"afterHeartbeat": { "online": true, "authorizedCommands": ["sys.echo","sys.slow"] }

### claim2:reconnect-refresh
"afterTtlAgain":  { "online": false, "lastSeenAt": 1791552997625 }
"reconnectReturn": { "online": true, "lastSeenAt": 1791552999928,
                     "authorizedCommands": ["sys.echo","sys.slow"] }
```

Verdict: **PASS** (expiry, heartbeat refresh, and re-registration refresh all observed end-to-end).

## (3) typed terminal results + bounded store under >N concurrent invokes — **PASS**

`PendingInvokeTracker.create` refuses at the per-node ceiling (`pending-invokes.ts:117-120`) and every
settle path is typed and exactly-once (`TerminalInvokeResult`, `pending-invokes.ts:36-39`; `settle`
deletes-then-resolves, `pending-invokes.ts:186-193`). Observed over real RPC:

```json
### claim3a:ok
{ "status":"ok", "invokeId":"ni_1", "command":"sys.echo",
  "payload": { "echo": { "mode":"echo","n":1 }, "command":"sys.echo" } }

### claim3b:timeout
{ "status":"timeout", "invokeId":"ni_2", "command":"sys.slow" }        // no reply before deadline

### claim3d:offline
{ "status":"error", "invokeId":"", "command":"sys.echo",
  "error": { "code":"NODE_OFFLINE", "message":"node n1 is offline" } }   // after presence TTL elapsed
```

- `ok` — the node transport echoed via `nodes:invokeResult` (real RPC), the blocked `nodes:invoke` resolved `ok`.
- `timeout` — `nodes:invoke` with `timeoutMs: 400` and no reply; the registry timer settled `timeout`.
- `offline` — an invoke after presence expiry: `authorize` refuses `NODE_OFFLINE` (`registry.ts:294-296`).
- refused — `NOT_ALLOWLISTED`/`NOT_DECLARED` (claim 1).

**Bounded under >N (N = `maxPendingPerNode` = 4)** — six concurrent `nodes:invoke` fired, node transport
delayed 300 ms so mid-flight state is observable:

```json
### claim3c:bounded
{ "maxPendingPerNode": 4, "midflightPending": 4,
  "settled": [
    { "status":"ok",    "invokeId":"ni_3" }, { "status":"ok", "invokeId":"ni_4" },
    { "status":"ok",    "invokeId":"ni_5" }, { "status":"ok", "invokeId":"ni_6" },
    { "status":"error", "invokeId":"", "errorCode":"QUEUE_FULL" },
    { "status":"error", "invokeId":"", "errorCode":"QUEUE_FULL" } ],
  "acceptedOk": 4, "refusedQueueFull": 2, "pendingAfterSettle": 0 }
```

Exactly 4 accepted (`ok`), 2 refused with a typed `QUEUE_FULL` terminal error (never silently dropped),
mid-flight `pendingInvokes` capped at 4, and the store drains to 0 after settlement (`nodes:list`
`pendingInvokes`). Verdict: **PASS**.

## (4) `nodes:*` are REMOTE_ELIGIBLE yet an unauthenticated context is refused — **PASS**

Real predicates (`routing.ts` `isRemoteEligible`/`isLocalOnly`, lists at `routing.ts:1254-1260`,
`:1263`, `:1269-1275`):

```json
### claim4:routing-inventory
"remoteEligible": [ ["nodes:register",true,true], ["nodes:list",true,true], ["nodes:presence",true,true],
                    ["nodes:invoke",true,true], ["nodes:invokeResult",true,true],
                    ["nodes:invokeCancel",true,true], ["nodes:changed",true,true] ],
"localOnly": [ ["nodes:register",false], ... ["nodes:changed",false] ],
"allRemote": true
```

All seven `nodes:*` channels are in `REMOTE_ELIGIBLE_CHANNELS` and none is `LOCAL_ONLY`. Yet a remote
context without credentials is refused by the transport before any handler dispatch
(`server.ts:994-1007`; `requireAuth`):

```json
### claim4:unauth-handshake-refused
{ "events": [ { "id":"h1", "type":"error",
     "error": { "code":"AUTH_FAILED", "message":"Authentication required" } } ],
  "close": { "code": 4005, "reason": "Auth failed" } }

### claim4:unauth-request-before-handshake
{ "events": [], "close": { "code": 4003, "reason": "Expected handshake" } }
```

A raw WS client sending a handshake with no token gets an `AUTH_FAILED` error frame and close `4005`; a
client that sends a `nodes:list` request before completing a handshake is closed `4003` with the request
never dispatched (`server.ts:914-917`). Verdict: **PASS**.

---

## Observations

- **O1 — production headless server does not expose `nodes:*`.** Against the real entry (`bun run server:start`,
  `ws://127.0.0.1:19013`, bearer token), the token-authenticated client reaches the sessions surface but:

  ```json
  { "sessionsReachable": true, "sessionsCount": 3,
    "nodesList":   { "error": { "code":"CHANNEL_NOT_FOUND", "message":"No handler for: nodes:list" } },
    "nodesInvoke": { "error": { "code":"CHANNEL_NOT_FOUND", "message":"No handler for: nodes:invoke" } },
    "serverAdvertisedNodesList": false }
  ```

  This is by design (`handlers/rpc/index.ts:193-196`: hosts without device connectivity must not advertise
  dead node channels) and is why the four claims above were driven with `deps.nodes` bound to a real
  registry on a real transport. Repro: `nohup env ROX_CONFIG_DIR=/tmp/v1-state … CRAFT_RPC_PORT=19013
  bun run server:start &` then `bun /tmp/nodes-verify/probe.ts`.

## unproven

- **In-flight invoke failure when a node goes offline at runtime** (`registry.sweep` → `failForNode(..., 'DISCONNECTED')`,
  `registry.ts:220-227`, `pending-invokes.ts:178-184`) was **not** reachable through the RPC surface: no
  `nodes:*` handler calls `registry.sweep()`, and there is no node-unregister channel, so presence expiry
  only affects *new* invokes (`NODE_OFFLINE`), never an already-pending one. The `DISCONNECTED` terminal
  path needs a host-driven periodic sweep that is not wired anywhere in this revision (searched
  `new NodeRegistry`/`.sweep(` across `packages apps services cloud`). Whether that wiring is required is a
  host-composition question, not a defect in the modules verified here.
- **Cancel path** (`nodes:invokeCancel` → `registry.cancelInvoke` → `error/CANCELLED`,
  `handlers/rpc/nodes.ts:136-140`, `pending-invokes.ts:154-156`) was not exercised; the four terminal types
  the ticket names (`ok`/`timeout`/refused/`offline`) were.