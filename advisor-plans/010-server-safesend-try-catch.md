# Plan 010: Contain a synchronous `ws.send` failure in the server's `safeSend`

> **Executor instructions**: Follow this plan step by step. Every step is a file
> edit; you do NOT run tests, linters, or formatters — the reviewer/orchestrator
> runs the verification gates at the end. If anything in the "STOP conditions"
> section matches what you see on disk, stop and report — do not improvise.
> When done, report the edited/created files back to whoever dispatched you; do
> not touch `advisor-plans/README.md` unless a reviewer explicitly told you to
> maintain it.
>
> **Drift check (run first)**: `git diff --stat 3114264ee..HEAD -- packages/server-core/src/transport/server.ts packages/server-core/src/transport/__tests__/server-safe-send.test.ts`
> If `server.ts` changed since this plan was written, compare the "Current
> state" excerpt against the live file before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Revision**: `3114264ee` (branch `e01-decisions`)
- **Finding**: CORRECTNESS-03 (audit card `/tmp/improve-full.md:63-78`)
- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Confidence**: MED (the code asymmetry is HIGH-confidence fact; the probability of a synchronous `ws.send` throw with a checked `readyState` is low, but nonzero)
- **Depends on**: none
- **Category**: bug

## Why this matters

`WsRpcServer.safeSend` (`packages/server-core/src/transport/server.ts:1525`)
guards with `readyState === OPEN` and then calls `ws.send(data)` **without a
try/catch**, while the client's analogous helper `trySendEnvelope`
(`client.ts:954`) catches and returns a boolean. The asymmetry matters on the
reconnect path: during a reconnect the server sends `handshake_ack` and then
replays buffered events in a loop (`server.ts:990`, `993-995`), and only
**after** the replay does it register the client
(`server.ts:1026-1027`, inside `clients.set(...)`). A synchronous throw from
`ws.send` on any replayed frame propagates out of the whole message handler:
the replay loop is abandoned, the `clients.set(...)` registration never runs,
and the client — which already received `handshake_ack` and believes it is
connected — is left "half-connected". Every later request from it then fails
`Unknown client` (close code 4006, `server.ts:1106`), forcing a reconnect and
leaving a window of silently missing state. The only visible symptom today is
an `unhandledRejection`. Wrapping the send in a try/catch that logs and closes
the socket makes the failure explicit and lets the client reconnect cleanly
instead of being stranded.

## Current state

All facts verified at `3114264ee`.

### Files

- `packages/server-core/src/transport/server.ts` — the WebSocket RPC server;
  contains the unguarded `safeSend` (line 1525) and the replay/registration
  sequence (lines 990-1027).
- `packages/server-core/src/transport/client.ts` — the client counterpart with
  the *correct* guard (`trySendEnvelope`, line 954); read for the pattern.
- `packages/server-core/src/transport/__tests__/` — existing transport tests
  (real-socket harness, e.g. `acknowledged-workspace.test.ts`,
  `server-lifecycle.test.ts`). The new unit test goes here.

### The bug (verbatim, `server.ts:1525-1529`)

```ts
  private safeSend(ws: WebSocket, data: string): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(data)
    }
  }
```

### The client analogue that already does it right (`client.ts:954-964`)

```ts
  /** Best-effort send that skips closing/closed sockets and swallows send races. */
  private trySendEnvelope(ws: WebSocket | null, envelope: MessageEnvelope): boolean {
    if (!ws || ws.readyState !== ws.OPEN) return false

    try {
      ws.send(serializeEnvelope(envelope))
      return true
    } catch {
      return false
    }
  }
```

### The call sites that make the throw dangerous (`server.ts`)

```ts
              if (canReplay) {
                const replayEvents = prevClient.eventBuffer.filter(e => e.seq > lastSeq)

                const ack: MessageEnvelope = { /* … handshake_ack … */ }
                this.safeSend(ws, serializeEnvelope(ack))            // :990

                // Replay missed events in order
                for (const event of replayEvents) {
                  this.safeSend(ws, event.data)                      // :994
                }
                /* … */
              }
```

and the registration that runs only if the block above does not throw:

```ts
              this.disconnectedClients.delete(envelope.reconnectClientId)   // :1026
              this.clients.set(prevClient.id, prevClient)                   // :1027
```

`safeSend` is also called on the normal push/response/error paths
(`server.ts:558, 914, 1014, 1084, 1293, 1403, 1484, 1494`); the fix applies to
all of them uniformly.

### Logger convention

The file's logger is `const transportLog = createLogger('ws-rpc-server')`
(`server.ts:196`); the existing WARN style is `transportLog.warn('<message>', { …fields })`
(e.g. `server.ts:744`). Match it.

## Scope

**In scope** (the only files you may modify):

- `packages/server-core/src/transport/server.ts` — wrap the send in `safeSend`.
- `packages/server-core/src/transport/__tests__/server-safe-send.test.ts` — **create**.

**Out of scope** (do NOT touch, even though they look related):

- `client.ts` — its `trySendEnvelope` is already correct; do not change it.
- Any other `safeSend` caller — the fix is inside `safeSend` only; do not add
  per-call try/catch blocks.
- `src/transport/push.ts`, `codec.ts`, `types.ts` — unrelated.
- Formatting/reordering of untouched lines; do not reformat the file.

## Executor steps

### Step 1: Guard the send in `safeSend` and close a dead socket

In `packages/server-core/src/transport/server.ts`, replace the whole
`safeSend` method (currently lines 1525-1529, excerpt above) with exactly:

```ts
  private safeSend(ws: WebSocket, data: string): void {
    if (ws.readyState !== ws.OPEN) return
    try {
      ws.send(data)
    } catch (err) {
      // A synchronous send failure means this socket is unusable. Drop it so
      // the client reconnects instead of being left half-connected: a bare
      // throw here would abort the replay loop (server.ts:993-995) before the
      // client is registered (server.ts:1026-1027), stranding the connection.
      transportLog.warn('WebSocket send failed; closing connection', {
        error: err instanceof Error ? err.message : String(err),
      })
      try {
        ws.close(1011, 'send failed')
      } catch { /* Socket already closing/closed. */ }
    }
  }
```

Notes:
- Keep the method `private` and its `(ws: WebSocket, data: string): void`
  signature — no caller changes.
- `ws.close` is itself wrapped so a throw from `close` (already-closing socket)
  cannot re-introduce the same escape.
- Do not change any of the existing `safeSend` call sites.

### Step 2: Create the regression unit test

Create `packages/server-core/src/transport/__tests__/server-safe-send.test.ts`
with exactly this content:

```ts
import { describe, it, expect } from 'bun:test'
import type { WebSocket } from 'ws'
import { WsRpcServer } from '../server'

function makeServer(): WsRpcServer {
  return new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
}

// `safeSend` is private; reach it the way other tests reach private members
// (see packages/server-core/src/sessions/adopt-task-draft.test.ts).
function safeSend(server: WsRpcServer, ws: WebSocket, data: string): void {
  ;(server as unknown as { safeSend(ws: WebSocket, data: string): void }).safeSend(ws, data)
}

describe('WsRpcServer.safeSend', () => {
  it('a synchronously-throwing send is contained and the socket is closed', () => {
    const server = makeServer()
    const closed: Array<{ code?: number; reason?: string }> = []
    let sends = 0
    const socket = {
      readyState: 1,
      OPEN: 1,
      send() { sends += 1; throw new Error('send exploded') },
      close(code?: number, reason?: string) { closed.push({ code, reason }); socket.readyState = 2 },
    }
    const ws = socket as unknown as WebSocket

    // Three frames, as the reconnect replay loop (server.ts:993-995) would send
    // them. Without try/catch the first throw escapes and aborts the loop and
    // the registration after it; with the guard, all calls return and only the
    // first send is attempted (the socket is CLOSING after close()).
    expect(() => {
      safeSend(server, ws, 'frame-1')
      safeSend(server, ws, 'frame-2')
      safeSend(server, ws, 'frame-3')
    }).not.toThrow()
    expect(sends).toBe(1)
    expect(closed).toEqual([{ code: 1011, reason: 'send failed' }])

    server.close()
  })

  it('does not attempt a send when the socket is not OPEN', () => {
    const server = makeServer()
    let sends = 0
    const ws = {
      readyState: 3,
      OPEN: 1,
      send() { sends += 1 },
      close() {},
    } as unknown as WebSocket

    safeSend(server, ws, 'frame-1')
    expect(sends).toBe(0)
    server.close()
  })
})
```

## Verification gates (orchestrator)

Run from the worktree root (`cd /Users/t/Projects/archive/rox-one-e01-wt`).
These are the orchestrator's gates, not the executor's.

| # | Command | Expected |
|---|---------|----------|
| G1 | `cd /Users/t/Projects/archive/rox-one-e01-wt && bun test packages/server-core/src/transport/__tests__/server-safe-send.test.ts` | `2 pass, 0 fail` |
| G2 | `cd /Users/t/Projects/archive/rox-one-e01-wt && bun test packages/server-core/src/transport/` | all pass, 0 fail (the existing transport suites are unchanged) |
| G3 | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "transportLog.warn('WebSocket send failed" packages/server-core/src/transport/server.ts` | `1` |
| G4 (negative) | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -n "ws.send(data)" packages/server-core/src/transport/server.ts` | exactly one hit, and it is inside a `try {` |
| G5 | `cd /Users/t/Projects/archive/rox-one-e01-wt && cd packages/server-core && bun run tsc --noEmit` | exit 0, no new errors |
| G6 | `cd /Users/t/Projects/archive/rox-one-e01-wt && git status --porcelain` | only `server.ts` modified and `server-safe-send.test.ts` added |

G4 negative interpretation: the only occurrence of `ws.send(data)` in `server.ts`
must be the one now wrapped in `try`, i.e. `grep -B1 "ws.send(data)"` shows the
preceding line is `try {`.

## Test plan

- **New tests** (in the new file, verbatim above): (a) a synchronously-throwing
  `ws.send` does not escape `safeSend`, does not abort a three-frame sequence,
  and closes the socket with `1011`/`send failed`; (b) a non-OPEN socket is not
  sent to.
- **Regression proof**: test (a) fails on the pre-fix code — the throw escapes
  `safeSend`, so `expect(() => …).not.toThrow()` throws `send exploded`.
- **Structural pattern**: `packages/server-core/src/transport/__tests__/server-lifecycle.test.ts`
  constructs `new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, … })`;
  `packages/server-core/src/sessions/adopt-task-draft.test.ts` shows the
  `(obj as any).<privateMember>` access used here to reach `safeSend`.
- **Verification**: G1 above.

## Done criteria

ALL must hold:

- [ ] `safeSend` in `server.ts` contains a `try { ws.send(data) } catch` and a
      `ws.close(1011, 'send failed')` inside its own try (G3, G4)
- [ ] `packages/server-core/src/transport/__tests__/server-safe-send.test.ts`
      exists with the two cases above (G1 → `2 pass, 0 fail`)
- [ ] existing transport suites still pass (G2)
- [ ] `bun run tsc --noEmit` in `packages/server-core` exits 0 (G5)
- [ ] `git status` shows only the two in-scope files (G6)

## STOP conditions

Stop and report (do not improvise) if:

- The `safeSend` excerpt at `server.ts:1525-1529` does not match the live file,
  or the replay block at `993-995` / registration at `1026-1027` has moved or
  changed shape.
- `safeSend` is no longer `private`, or a caller already passes a callback /
  expects a return value from it.
- The new test file cannot reach `safeSend` (e.g. the constructor rejects
  `{ host, port: 0, requireAuth: false }`).
- Any change would require touching an out-of-scope file (notably `client.ts`).
- A reviewer tells you `advisor-plans/README.md` is theirs.

## Maintenance notes

- **Uniform best-effort send.** Every outbound frame in this file now flows
  through `safeSend`. If a future send path needs to know whether the send
  landed, return a boolean from `safeSend` (like `trySendEnvelope`) rather than
  adding a second convention.
- **Close policy.** The chosen failure policy is *close + let the client
  reconnect* (matches the audit card: "обернуть send, логировать; поведение при
  сбое — close+reconnect"). Closing during replay relies on the existing
  disconnect/TTL machinery (`disconnectedClients`); if replay ordering changes,
  revisit.
- **Reviewer should check**: the method stayed private and unchanged in
  signature, the `catch` only logs (never swallows silently), and the nested
  `close` try is present.
- **Deferred (out of scope):** a *statistical* signal that `ws.send` can throw
  synchronously (metrics/alerts) is not added; the log line is the signal.