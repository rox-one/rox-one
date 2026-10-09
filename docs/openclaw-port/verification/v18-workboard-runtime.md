# V18 — workboard CAS + live path (rows b2.1, b2.2)

- Repo: `/Users/t/Projects/rox-w3-int` (branch `port/w3-int`, real installed `node_modules`)
- HEAD: `98e1e5cc4` (`git rev-parse --short HEAD`)
- Platform: darwin 27.0.0 arm64 · bun (repo-pinned)
- Date: 2026-10-09
- Verdict: **PASS** for the WS CAS path and the coalescer, **with one code-surface divergence**
  on the read-only-actor denial (denied as required, but with `AUTH_FAILED` at the
  transport fence, not the domain `FORBIDDEN` — see (e)).

## Method

All evidence is from **real processes**: a real `WsRpcServer` with the real handler
registration, an authenticated `WsRpcClient` over a real WebSocket, real
`NativeAuthority` credentials, and the real on-disk `state.json`. The coalescer was
driven through its real `createBoardLiveRefresh` export with an injected fake clock
and stub `read()`. Unit tests were not used as evidence.

Scratch scripts (throwaway, `/tmp`): `/tmp/w3v18/run.ts` (WS) and
`/tmp/w3v18/coalesce.ts` (coalescer). Both execute from the repo root via
`bun -e "$(cat …)"` so relative specifiers resolve against the repo. No repo source
was modified.

```sh
# WS CAS + live push (isolated config dir so the authority/config are fresh)
D=$(mktemp -d /tmp/w3v18-cfg-XXXX)
ROX_CONFIG_DIR=$D CRAFT_CONFIG_DIR=$D bun -e "$(cat /tmp/w3v18/run.ts)"   # cwd = repo root

# coalescer (fake clock, stub read)
bun -e "$(cat /tmp/w3v18/coalesce.ts)"                                     # cwd = repo root
```

The WS harness enrolls two principals against the real authority: `Author`
(`read,write,delete,subscribe` on workspace `a`) and `Reader` (`read`); a third
`Writer` (`read,write`) is enrolled for the editor-rule case. The server is started
with `requireAuth: true`, `nativeEventChannels = { workboard:changed }`; the client
registers `workboard:changed` in the `# CHANGED` push stream.

## (a) read → create (workspace-work surface) → move with correct expectedRevision — PASS

`workboard:read` projects `revision:0` / 0 cards; the task is created through the
**workspace-work** RPC (`workspaceWork:write`, `kind:'createTask'`), which bumps the
canonical revision to 1; the board then projects one `todo` card. `workboard:move`
with `expectedRevision:1` returns revision 2 / column `in-progress`, and the
`workboard:changed` push carrying `{revision:2}` is observed on the client's event
stream:

```
EVIDENCE {"step":"read-empty","revision":0,"cards":0}
EVIDENCE {"step":"ws-write-create","revision":1,"taskId":"task_6980cd8a-…","receiptRevision":1,"sha256":"c5630f65…"}
EVIDENCE {"step":"read-after-create","revision":1,"cards":[{"taskId":"task_6980cd8a-…","column":"todo","title":"Bridge card","revision":1}]}
EVIDENCE {"step":"move-ok","revision":2,"task":{"column":"in-progress","revision":2}}
EVIDENCE {"step":"changed-push","pushes":[{"revision":2}]}
```

The push handler is `packages/server-core/src/handlers/rpc/workboard.ts:31-32`
(`changed()` → `pushTyped(server, CHANGED, {to:'workspace', workspaceId}, {revision})`),
emitted at `:42` after the move commits. Exactly one push arrived.

## (b) Replay of the SAME expectedRevision — PASS

Re-issuing the already-applied `expectedRevision:1` for a *second* move returns
`REVISION_CONFLICT`, and the on-disk `state.json` sha256 is **byte-identical** before
and after the rejected call (no partial write, no lost update):

```
EVIDENCE {"step":"replay-same-revision","conflict":{"name":"Error","code":"REVISION_CONFLICT","message":"Request failed"},
 "diskBefore":"b18297a3b9ee6fdf321542da83dbd57dbdfdd1bb2f81c80ad94a21feee8f0200",
 "diskAfter":"b18297a3b9ee6fdf321542da83dbd57dbdfdd1bb2f81c80ad94a21feee8f0200",
 "byteIdentical":true}
```

The CAS lives in `packages/server-core/src/workspace-work/store.ts:66`
(`if (draft.revision !== expectedRevision) throw new CodedError('REVISION_CONFLICT', …)`),
inside the SQLite write-lease transaction; the failed commit never calls `renameSync`
(`store.ts:77`), so the file is untouched. The wire message is the transport's generic
`"Request failed"` (`server.ts:1327`) but the typed code is preserved.

## (c) Two racing movers — PASS

Two `workboard:move` calls issued concurrently with the same `expectedRevision:2`:

```
EVIDENCE {"step":"racing-movers",
 "race":[{"status":"fulfilled","revision":3,"column":"done"},
         {"status":"rejected","name":"Error","code":"REVISION_CONFLICT","message":"Request failed"}],
 "finalRevision":3,"finalColumn":"done"}
```

Exactly one wins (`done`, revision 3); the loser is `REVISION_CONFLICT`. Final on-disk
state `revision:3`, status `done` — no lost update.

## (d) read-only actor — PASS (denied) · code divergence noted

`Reader` (granted only `read` on the workspace) invoking `workboard:move`:

```
EVIDENCE {"step":"readonly-actor","error":{"name":"Error","code":"AUTH_FAILED","message":"Workspace permission denied"}}
EVIDENCE {"step":"readonly-can-read","revision":3,"cards":1}
```

The read-only principal is denied for the move, but the denial is **`AUTH_FAILED`**
raised by the transport permission fence (`packages/server-core/src/transport/server.ts:1383`,
`requestPermissionFence` → `authorize(principal, workspaceId, 'write')`) **before** the
handler runs — not the domain `FORBIDDEN`. The same principal *can* read the board
(`read` grant), so the denial is write-specific, not a blanket rejection.

The workboard handler's own `FORBIDDEN` path is exercised through RPC by a principal
granted `write` but who is neither author, assignee, nor manager of the task — the
editor rule at `packages/server-core/src/workboard/service.ts:79`
(`if (!actor.canManage && actor.actorId !== task.authorId && actor.actorId !== task.assigneeId) forbidden()`):

```
EVIDENCE {"step":"non-editor-writer","error":{"name":"Error","code":"FORBIDDEN","message":"Request failed"}}
```

**Divergence vs the ticket wording ("a read-only actor (FORBIDDEN)").** For a *remote
principal* the transport's action fence answers first, so the code observed is
`AUTH_FAILED`; the domain `FORBIDDEN` at `service.ts:76`
(`if (!actor.canWrite) forbidden()`) is only reachable when the request clears the
transport fence (in-process/local actor, or a `write`-granted actor failing the editor
rule). This is the intended security layering — the fence is channel-wide and cannot be
relaxed without weakening every write handler — so **no fix is recommended**: the
read-only actor is denied as required; only the reported code differs. If the ticket
literally requires `FORBIDDEN` on the wire, the smallest (but not advisable) change
would be to stop gating `workboard:move` on `nativeAction: 'write'` at
`handlers/rpc/workboard.ts:44`, which would remove the transport pre-check and let the
handler's `service.ts:76` produce `FORBIDDEN`; that is a net security regression and
should not be done.

## (e) Coalescer `/apps/electron/src/renderer/.../kanban/board-live-refresh.ts` — PASS

Driven with a fake clock and a stub `read()`; raw output:

```
EVIDENCE {"case":"A-coalesce","readCalls":1,"readArgs":[{"sinceRevision":0,"epoch":0}],
 "reloads":[{"epoch":0,"revision":2,"full":false}],"appliedRevision":2,"pending":false}
EVIDENCE {"case":"B-regression","readCalls":1,"readArgs":[{"epoch":1}],"sinceRevisionDropped":true,
 "reloads":[{"epoch":1,"revision":7,"full":true}],"epoch":1,"appliedRevision":7}
EVIDENCE {"case":"C1-write-defer-endWrite","afterFlush":{"readCalls":0,"pending":true,"timers":1},
 "afterEndWrite":{"readCalls":1,"readArgs":[{"sinceRevision":0,"epoch":0}],"timers":0}}
EVIDENCE {"case":"C2-write-stuck-retry","afterFlush":{"readCalls":0,"pending":true,"timers":1},
 "afterRetry":{"readCalls":1,"readArgs":[{"sinceRevision":0,"epoch":0}]}}
EVIDENCE {"case":"D-hidden-defer","whileHidden":{"readCalls":0,"timers":0,"pending":true},
 "afterVisible":{"readCalls":1,"readArgs":[{"sinceRevision":0,"epoch":0}],"listeners":1}}
EVIDENCE {"case":"E-normalise","malformedReadCalls":0,"pending":false,"normalise":[null,null,null,null,2,4]}
```

- **Two rapid `changed` events → one reload (A):** `notify({1}) ; notify({2})` before
  the flush timer fires ⇒ a single `read({sinceRevision:0, epoch:0})`; the second event
  is coalesced into the pending revision (`board-live-refresh.ts:183-191`, `:136-173`).
- **Regression forces a full reload (B):** with `appliedRevision:5`, `notify({2})` sets
  `pendingRegressed` (`:188`), and the read is issued with **no `sinceRevision`** and a
  bumped `epoch:1`; `onReloaded.full === true` (`:145-147`).
- **In-flight write defers then retries (C1/C2):** with `isWriteInFlight()===true` the
  flush is deferred and one retry timer armed (`:139-142`, `:126-134`);
  `endWrite()` cancels the timer and reads immediately (C1), and a *stuck* write is
  force-retried once after `retryDelayMs` (C2, `attempt(true)` bypasses the guard at
  `:139`).
- **`document.hidden` defers until `visibilitychange` (D):** while hidden, `armFlush`
  returns early with no timer armed (`:119`); setting `hidden=false` and firing the
  registered `visibilitychange` listener re-arms the flush and triggers the read
  (`:175-179`).
- **Bonus (E):** malformed payload revisions (`null`, `undefined`, `NaN`, string) are
  ignored and arm no read; `normaliseWorkboardRevision` truncates a fractional revision
  to an integer (`2.9 → 2`).

## Unproven / not tested

- The multi-process *desktop/Electron* wiring of `board-live-refresh.ts` (the actual
  renderer subscribing to the real push and calling the real `workboard:read`) was not
  exercised as one integrated app; the coalescer was verified in isolation with an
  injected clock/stub, and the WS push was verified on the server/client transport, not
  through the renderer.
- `revision` semantics for optimistic card writes (`isWriteInFlight`/`endWrite`) were
  verified with a stubbed flag, not a real renderer drag.
- No fix was made for the (d) code-surface divergence (reported, not patched).