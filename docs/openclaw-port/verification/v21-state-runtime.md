# V21 — State substrate under real processes (row f.10)

- Verifier: `w3-verify-4`
- Repo: `/Users/t/Projects/rox-w3-int` @ `98e1e5cc4` (branch `port/w3-int`)
- Host: macOS (darwin 27.0.0), uid 501, `bun` 1.4.2, `node` 26.8.2, sqlite 3.54.0
- Method: the **real headless server** (`bun run packages/server/src/index.ts`) booted as a real
  process against a scratch `ROX_CONFIG_DIR`, plus real second/third processes driving the real
  state modules over real JSONL files and the real `rox-state.sqlite` (WAL). No source/test/config
  in the repo was modified. Scratch under `/tmp/w3v4/` (kept for repro).

Modules under test:
`packages/server-core/src/state/{writer-lock,write-queue,state-store,sessions-projection}.ts` and
their wiring in `packages/server-core/src/{bootstrap/headless-start.ts,sessions/SessionManager.ts}`.

Reproduce (all commands run from the repo root):
```sh
# server 1 (long-lived)
ROX_CONFIG_DIR=/tmp/w3v4/cfg ROX_SERVER_TOKEN=0123456789abcdef0123456789abcdef \
  CRAFT_RPC_PORT=19123 CRAFT_DISABLE_MESSAGING=1 CRAFT_BROWSER_BACKEND=none CRAFT_HEALTH_PORT=0 \
  bun run packages/server/src/index.ts
# probes
bun run /tmp/w3v4/queue-probe.ts
bun run /tmp/w3v4/store-queue-probe.ts /tmp/w3v4/cfg3
bun run /tmp/w3v4/projection-probe.ts /tmp/w3v4/cfg /tmp/w3v4/ws <create|delete|verify-index|drop-index-rebuild>
bun run /tmp/w3v4/independent-scan.ts /tmp/w3v4/ws
bun run /tmp/w3v4/crash-orchestrator.ts /tmp/w3v4/cfg2 /tmp/w3v4/ws2
bun run /tmp/w3v4/locktype.ts
bun run /tmp/w3v4/rpc-probe.ts ws://127.0.0.1:19123 0123456789abcdef0123456789abcdef
```

---

## Summary

| # | Claim | Verdict |
|---|---|---|
| a | second real server on the same config dir fails naming the holder | **PASS** (but via the legacy `.server.lock`, see finding F1) |
| b | the failure is the typed `STATE_LOCKED` error naming the holder | **PASS** when the state lock is reached; **not reachable in the normal boot order** → finding **F1** |
| c | create + delete of sessions keeps `sessions-index.json` equal to a fresh scan | **PASS** (cross-process, while server 1 runs) |
| d | deleting the index file + rebuild restores it equivalent | **PASS** |
| e | SIGKILL mid-flush → projection rebuilds from JSONL, no wrong entries; DB is derived | **PASS** |
| f | write queue serialises same-key writers, runs disjoint keys concurrently, never wedges on reject | **PASS** |
| g | writer lock reclaims a stale lock after the holder is SIGKILLed | **PASS** |

---

## (a)+(b) cross-process single-writer lock — two real servers

Two real `packages/server/src/index.ts` processes were booted against the **same**
`ROX_CONFIG_DIR=/tmp/w3v4/cfg`. Server 1 (pid 36183) acquired both locks and listened:

```
$ cat /tmp/w3v4/cfg/state/rox-state.lock
{"pid":36183,"startedAt":1791561275508,"execName":"bun","label":"rox-server"}
$ cat /tmp/w3v4/cfg/.server.lock
{"pid":36183,"startedAt":1791561275508,"execName":"bun"}
```

**A — second server, legacy lock present** (`ROX_CONFIG_DIR=/tmp/w3v4/cfg … CRAFT_RPC_PORT=19124 … bun run packages/server/src/index.ts`):

```
exit=1
[runtime] bun 1.4.2 (node 26.3.0, sqlite 3.54.0)
…
2026-10-09T15:54:42.663Z INFO  [bootstrap] Config artifacts initialized
2026-10-09T15:54:42.664Z INFO  [bootstrap] Global config found
Another server instance is already running (PID 36183). If this is stale, delete /tmp/w3v4/cfg/.server.lock and retry. To run a parallel instance (e.g. for dev), set CRAFT_CONFIG_DIR to a different path.
```

**B — second server, legacy `.server.lock` vacated** (`rm -f /tmp/w3v4/cfg/.server.lock` first), state lock still held by pid 36183:

```
exit=1
…
2026-10-09T15:54:47.388Z INFO  [bootstrap] Config artifacts initialized
2026-10-09T15:54:47.390Z INFO  [bootstrap] Global config found
State database is locked by rox-server (PID 36183, since 2026-10-09T15:54:35.508Z). Delete /tmp/w3v4/cfg/state/rox-state.lock if that process is gone, or set ROX_CONFIG_DIR to a different path to run a parallel instance.
```

**Typed-ness of the error** (a real second process importing the real module while server 1 holds the lock):

```
$ bun run /tmp/w3v4/locktype.ts
RESULT {"name":"StateLockedError","code":"STATE_LOCKED","isStateLockedError":true,"holder":{"pid":36183,"startedAt":1791561275508,"label":"rox-server","execName":"bun"},"lockPath":"/tmp/w3v4/cfg/state/rox-state.lock"}
```

Server 1 was still listening after both refusals (`lsof -nP -iTCP:19123 -sTCP:LISTEN` → `bun 36183 … LISTEN`).

**Finding F1 (defect — ordering).** The literal claim "the second boot fails with the typed
`STATE_LOCKED` error" is **not** what a normal second boot does: it fails first on the legacy
`.server.lock`. In `bootstrap/headless-start.ts` the legacy lock is taken at **line 534**
(`acquireServerLock(platform.logger)`) *before* the state writer lock at **line 542**
(`acquireStateWriterLock(...)`), so for the same-config-dir case the `StateLockedError` at
`writer-lock.ts:181` is unreachable through the boot path and only fires when the legacy lock is
absent (proved above in test B).

- Smallest fix (pick one, both are one-line-class):
  1. Swap the order — acquire the state writer lock (and `openStateStore`) **before**
     `acquireServerLock`, so the typed `STATE_LOCKED` (which names holder + lock path + remedy)
     is the surface a duplicate boot sees; or
  2. Replace the legacy `.server.lock` with the state lock as the single source of ownership
     (the state lock already carries pid/startedAt/execName and staleness logic at
     `writer-lock.ts:140-153`).
  The state lock itself is correct (see (b) B and (g)); the defect is only which lock fires first.

**Verdict (a): PASS** — the second real server refuses and names the holder PID.
**Verdict (b): PASS for the lock module** (`name=StateLockedError`, `code=STATE_LOCKED`, holder
`rox-server` PID 36183); **the typed error is not reachable in the normal boot order** → F1.

---

## (c) create + delete sessions — index equals a fresh scan (server 1 running)

While server 1 held the config dir's store, a **second real process** opened the same
`rox-state.sqlite` (WAL + 5 s busy timeout) and drove the real projector. Workspace
`/tmp/w3v4/ws`.

```
$ bun run /tmp/w3v4/projection-probe.ts /tmp/w3v4/cfg /tmp/w3v4/ws create
CREATE {"created":["261009-still-fox","261009-onyx-eagle"],"indexIds":["261009-onyx-eagle","261009-still-fox"]}

$ bun run /tmp/w3v4/projection-probe.ts /tmp/w3v4/cfg /tmp/w3v4/ws verify-index
VERIFY {"indexCount":2,"scanCount":2,"indexIds":["…onyx-eagle","…still-fox"],"scanIds":["…onyx-eagle","…still-fox"],"dbIds":["…onyx-eagle","…still-fox"],"liveIds":["…onyx-eagle","…still-fox"],"idsMatch":true,"entriesEqual":true}

$ bun run /tmp/w3v4/projection-probe.ts /tmp/w3v4/cfg /tmp/w3v4/ws delete
DELETE {"deleted":"261009-onyx-eagle","before":["261009-onyx-eagle","261009-still-fox"],"after":["261009-still-fox"],"scan":["261009-still-fox"]}

$ bun run /tmp/w3v4/projection-probe.ts /tmp/w3v4/cfg /tmp/w3v4/ws create      # +2 more
CREATE {"created":["261009-airy-flower","261009-quiet-hill"],"indexIds":[…3 ids…]}
VERIFY {"indexCount":3,"scanCount":3,…,"dbIds":[…],"liveIds":[…],"idsMatch":true,"entriesEqual":true}
```

Independent check that does **not** use the projection module (reads `sessions/*/session.jsonl`
first lines + `sessions-index.json` directly):

```
$ bun run /tmp/w3v4/independent-scan.ts /tmp/w3v4/ws
INDEPENDENT {"dirsWithHeader":3,"indexCount":3,"truthIds":["261009-airy-flower","261009-quiet-hill","261009-still-fox"],"indexIds":[…same…],"setsEqual":true,"countEqual":true,"namesMatch":true}
```

**Verdict: PASS.** The DB rows, the index file, the module scan, and an independent raw scan all
agree after create/delete, with server 1 holding the store.

**Not proven here:** the delete/create were driven through the projector functions the wiring
calls (`sessions-projection.ts` `recordSession`/`removeSession`), **not** through
`SessionManager.createSession`/`deleteSession` over the wire — see Limitations.

---

## (d) delete the index file → rebuild

```
$ cp /tmp/w3v4/ws/sessions/sessions-index.json /tmp/w3v4/index-before.json
$ bun run /tmp/w3v4/projection-probe.ts /tmp/w3v4/cfg /tmp/w3v4/ws drop-index-rebuild
DROP {"exists":false}
REBUILD {"rebuiltIds":[…3…],"afterIds":[…3…],"scanIds":[…3…],"equivalent":true,"countMatches":true,"maxMtimeMatches":true,"entriesEqual":true}
$ bun run /tmp/w3v4/independent-scan.ts /tmp/w3v4/ws
INDEPENDENT {"dirsWithHeader":3,"indexCount":3,…,"setsEqual":true,"countEqual":true,"namesMatch":true}
$ bun -e '…compare index-before.json vs rebuilt…'
{"versionEqual":true,"countEqual":true,"maxMtimeEqual":true,"entriesEqual":true}
```

**Verdict: PASS.** Rebuild reproduces `version`, `count`, `maxHeaderMtimeMs`, and the full
`entries` array exactly. The file is **content-equivalent, not byte-identical**: `generatedAt`
is a fresh timestamp (`sessions-projection.ts:148-154`), so raw bytes differ by that one field.

---

## (e) SIGKILL mid-flush → rebuild from the JSONL source of truth

`/tmp/w3v4/crash-orchestrator.ts` spawns a real writer burst (`projection-probe.ts midflush`,
creating sessions and projecting each), then **SIGKILLs** it mid-flush, then corrupts the derived
stores with a phantom entry and rebuilds.

```
CRASH {"killedAfterWrote":50,"exitCode":137,"killedBySignal":true}
POST-KILL {"diskCount":52,"indexCount":51,"indexPathExists":true}
CORRUPTED {"indexCount":52,"dbCount":52,"indexHasPhantom":true,"dbHasPhantom":true}
REBUILT {"rebuiltCount":52,"diskCount":52,"rebuiltEqualsDisk":true,"indexEqualsDisk":true,"dbEqualsDisk":true,"phantomGoneFromIndex":true,"phantomGoneFromDb":true}
DB-DERIVED {"rebuiltEqualsDisk":true,"dbEqualsDisk":true,"count":52}
```

Reading: after SIGKILL the JSONL truth was 52 sessions while the index still showed 51 (the
derived store lagged — expected mid-flush). After injecting a non-existent `phantom-9999` into
both the index file and `session_index`, `rebuildWorkspace` (`sessions-projection.ts:242-252`,
`reconcileRows:167-171`) rewrote both to exactly the 52 on-disk sessions and purged the phantom.
Finally the whole `rox-state.sqlite` (+`-wal`/`-shm`) was deleted and a fresh store rebuilt the
same 52 entries from JSONL alone.

**Verdict: PASS.** JSONL is authoritative; the DB is derived and fully rebuildable; no wrong
(phantom) entries survive a rebuild.

---

## (f) write queue semantics (real processes)

Raw queue (`write-queue.ts`):

```
$ bun run /tmp/w3v4/queue-probe.ts
A sameKeys {"a":"w1","b":"w2","maxInflight":1,"order":["w1:enter","w1:exit","w2:enter","w2:exit"]}
B disjointKeys {"a":"d1","b":"d2","maxInflight":2}
C rejectingWriter {"settled":["rejected:boom","g1","g2"],"ran":["g1","g2"]}
D fifo {"seq":["slow","slow:done","mid","late"]}
E exclusiveVsKeyed {"maxInflight":1}
```

Real store (`StateStore.run` over the actual `rox-state.sqlite`):

```
$ bun run /tmp/w3v4/store-queue-probe.ts /tmp/w3v4/cfg3
STORE sameKey {"a":"a","b":"b","maxInflight":1}
STORE disjointKeys {"a":"a","b":"b","maxInflight":2}
STORE sharedTableKey {"a":"a","b":"b","maxInflight":1}
STORE rejectingWriter {"settled":["rejected:boom","good"],"ran":["good"]}
STORE kvRoundTrip {"got":"rv","maxInflight":1}
```

- Same key: `maxInflight=1` and strict `w1 → w2` order (FIFO).
- Disjoint keys (`row:k1`/`row:k2`): `maxInflight=2` → real concurrency.
- Sharing a table key (`['state_kv','k1']` vs `['state_kv','k2']`) correctly serialises
  (`maxInflight=1`) — key sets overlap on `state_kv`.
- Whole-store exclusive (no keys) blocks a concurrent keyed writer (`maxInflight=1`).
- A rejecting writer settles as `rejected:boom` and the **next** same-key writer
  (`good`/`g1`+`g2`) still runs — the lane is not wedged (`write-queue.ts:138-144`).

**Verdict: PASS.**

---

## (g) stale-lock reclaim after SIGKILL of the holder

`kill -9 36183` (the server that held both locks) leaves the state lock on disk with a dead PID:

```
$ ps -p 36183 -o pid=  → PID 36183 DEAD
$ cat /tmp/w3v4/cfg/state/rox-state.lock
{"pid":36183,"startedAt":1791561275508,"execName":"bun","label":"rox-server"}
```

A fresh real server booted against the same config dir; it reclaimed the stale lock and served:

```
$ ROX_CONFIG_DIR=/tmp/w3v4/cfg … CRAFT_RPC_PORT=19125 timeout 25 bun run packages/server/src/index.ts
… 2026-10-09T15:58:21.844Z INFO  Rox server listening on ws://127.0.0.1:19125
exit=124   # 124 = still up when timeout fired
$ cat /tmp/w3v4/cfg/state/rox-state.lock   → No such file (released on clean SIGTERM)
```

**Verdict: PASS** (`writer-lock.ts:140-153`: a dead holder PID is stale and is reclaimed).

---

## WS RPC surface (context, partial)

The real transport handshake works against the running server (real `WsRpcClient`,
`transport/client.ts`, token auth):

```
$ bun run /tmp/w3v4/rpc-probe.ts ws://127.0.0.1:19123 0123…cdef
GET_WORKSPACES []
RPC_ERROR Error: Channel is only available to the local desktop client
```

`server:getWorkspaces` answered (empty roster), but `workspaces:create` (and therefore a
server-side session create) is gated to the local desktop client (`workspace.ts` registers it
without a remote `access` grant), so a token-only client cannot drive
`SessionManager.createSession` over the wire in this build.

---

## Findings / defects

- **F1 (ordering, low–medium).** `bootstrap/headless-start.ts:534` takes the legacy
  `.server.lock` before `:542` takes the state writer lock, so a duplicate boot reports the
  generic "Another server instance is already running (PID …)" instead of the typed
  `STATE_LOCKED` error naming the holder and the lock path. The state lock is reachable only
  when the legacy lock is absent. Minimal fix in **(b)** above (swap order, or make the state
  lock the single ownership surface).
- No other defects found. `write-queue`, `sessions-projection`, and `writer-lock` behaved as
  documented under real processes.

## Limitations (not proven)

- **SessionManager wiring not driven end-to-end.** `SessionManager.ts:3219`
  (`recordSession` on `flushSession`) and `:7582` (`removeSession` on `deleteSession`) were not
  exercised through a live server session lifecycle: the session-mutating RPC channels are
  local-desktop-gated, so only the projector functions those call sites invoke were driven
  (cross-process, over real JSONL + real SQLite). The call sites themselves were read, not run.
- **`generatedAt` difference.** Index rebuild is content-equivalent, not byte-identical (a fresh
  `generatedAt` timestamp is written every time).
- **Cross-process write serialisation is SQLite-level.** Two *independent processes* each get
  their own in-memory write queue (`state-store.ts:267`), so cross-process writers rely on
  SQLite WAL + `busy_timeout`, not on the queue; only the single-server + one external writer
  case was exercised. The queue's serialization was proven within one process.
- **Windows/macOS-only.** `writeIndexFile`'s win32 rename fallback
  (`sessions-projection.ts:159-164`) and `writer-lock.ts`'s `tasklist`/`/proc` branches were not
  executed on this host.
- Only the config-dir/workspace scenarios above were run; no full workspace-wide gate was run.

## Revision verified

`git rev-parse --short HEAD` = `98e1e5cc4` on `port/w3-int`. Working tree had unrelated peer
edits (`M packages/server-core/src/scheduler/hooks-node.ts`, untracked v18–v23 verification
docs); no source file was modified by this verification. Scratch kept at `/tmp/w3v4/` for repro.