# Plan 001: Decide LOCAL_ONLY from server-verified state, not a client-declared capability

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4418fca40..HEAD -- packages/server-core/src/transport/server.ts packages/server-core/src/transport/__tests__/error-codes.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (a security gate changes; the only behavior removed is the capability bypass — see Scope)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4418fca40`, 2026-10-09

## Why this matters

The transport's `LOCAL_ONLY` gate is a security boundary: it decides whether a
connected client may call desktop-only RPCs such as `shell:exec`, which runs an
arbitrary command with the **server's** environment and filesystem access
(`packages/server-core/src/handlers/rpc/system.ts:406-431`). Today the gate trusts a
value the **client itself declares** in the handshake: if the client advertises the
capability `client:openFileDialog`, the gate is skipped. On any `requireAuth` server,
if the client is not an Electron-bound desktop client, it can therefore declare this
capability and reach `shell:exec` → arbitrary command execution. This is exploitable
on a headless deployment, where the `requireAuth` handshake branch deliberately
leaves `principal`/`workspaceSession` null. After this plan, the gate is decided only
by server-verified state (an Electron-main binding, the web-appearance path, or an
explicit test-only escape), and the matching test is re-pointed at that contract.

## Current state

The relevant files, each with one line on its role:

- `packages/server-core/src/transport/server.ts` — the WebSocket RPC server: handshake, client state, and the `LOCAL_ONLY` dispatch gate.
- `packages/server-core/src/transport/capabilities.ts` — where `CLIENT_OPEN_FILE_DIALOG` is defined (line 23). **Not modified by this plan.**
- `packages/server-core/src/transport/__tests__/error-codes.test.ts` — transport test file that currently asserts the capability bypass is allowed.
- `packages/shared/src/protocol/routing.ts` — `LOCAL_ONLY_CHANNELS` (lines 17-494) and `isLocalOnly()` (lines 1132-1134). **Not modified by this plan.**
- `packages/server-core/src/handlers/rpc/system.ts` — the `shell:exec` handler (lines 406-431). **Not modified by this plan.**
- `packages/server-core/src/bootstrap/headless-start.ts` — the headless wiring that sets `requireAuth: true` (line 505). **Not modified by this plan.**

### The bypass, end to end (excerpts verified at commit `4418fca40`)

Capabilities come from the client envelope whenever there is no authenticated
principal/workspace session — `packages/server-core/src/transport/server.ts:1054`:

```ts
          webUiAuthenticated,
          capabilities: new Set(principal || workspaceSession ? [] : envelope.clientCapabilities ?? []),
```

The `requireAuth` handshake branch validates the bearer token but leaves both
`principal` and `workspaceSession` null — `packages/server-core/src/transport/server.ts:850-864`:

```ts
        } else if (this.requireAuth) {
          let authenticated = false
          if (envelope.token && this.validateToken) {
            authenticated = await this.validateToken(envelope.token)
          }
          if (!authenticated && this.validateSessionCookie && upgradeRequestCookie) {
            authenticated = await this.validateSessionCookie(upgradeRequestCookie)
            webUiAuthenticated = authenticated && !!this.webUiAppearanceWorkspaceId
          }
          if (!authenticated) {
            this.sendError(ws, envelope.id, 'AUTH_FAILED', 'Authentication required')
            ws.close(4005, 'Auth failed')
            return
          }
        }
```

The fence itself consults the client-declared capability set —
`packages/server-core/src/transport/server.ts:1193-1212`:

```ts
    // LOCAL_ONLY is a desktop-process gate, not a second handshake
    // capability. Electron-main proof (`localBinding`) already means
    // this client is the trusted desktop. `openFileDialog` remains a
    // fallback for tests that only advertise that capability.
    if (
      isLocalOnly(channel)
      && this.shouldEnforceLocalOnly()
      && client.localBinding === null
      && !client.capabilities.has(CLIENT_OPEN_FILE_DIALOG)
      && !webAppearance
    ) {
      this.sendResponseError(
        client.ws,
        id,
        channel,
        'LOCAL_ONLY_DENIED',
        'Channel is only available to the local desktop client',
      )
      return
    }
```

`shouldEnforceLocalOnly()` is true whenever `requireAuth` is set —
`packages/server-core/src/transport/server.ts:1139-1143`:

```ts
  private shouldEnforceLocalOnly(): boolean {
    if (this.requireAuth) return true
    const host = this.host
    return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1'
  }
```

The constant and the channel membership:

- `packages/server-core/src/transport/capabilities.ts:23`:
  ```ts
  export const CLIENT_OPEN_FILE_DIALOG = 'client:openFileDialog'
  ```
- `packages/shared/src/protocol/routing.ts:17` opens `export const LOCAL_ONLY_CHANNELS = new Set<string>([`, and line 113 is `RPC_CHANNELS.shell.EXEC,` inside it (the set closes at line 494). `isLocalOnly()` (lines 1132-1134) is `LOCAL_ONLY_CHANNELS.has(channel)`.

The reachable sink — `packages/server-core/src/handlers/rpc/system.ts:420-425`:

```ts
      const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-lc', command], {
        cwd,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      })
      return { ok: true, stdout, stderr }
```

`shell:exec`'s own guard does **not** stop this: `assertLocalWorkspace` only rejects
*remote* workspaces, and with no workspace it falls through to `homedir()` —
`packages/server-core/src/handlers/rpc/system.ts:154-160`:

```ts
/** Guard: reject filesystem-path actions on remote workspaces where local paths are meaningless. */
function assertLocalWorkspace(ctx: { workspaceId: string | null }, action: string): void {
  const ws = getWorkspaceByNameOrId(ctx.workspaceId ?? '')
  if (ws?.remoteServer) {
    throw new Error(`${action} is not available for remote workspaces`)
  }
}
```

So once the fence is bypassed, an unbound client reaches the command execution with the
server's environment — which is why this plan does not touch `system.ts`: the correct
fix is to keep the fence from being bypassed, not to duplicate the gate downstream.

The headless deployment uses exactly the vulnerable handshake branch —
`packages/server-core/src/bootstrap/headless-start.ts:502-505` and `:526`:

```ts
  const wsServer = new WsRpcServer({
    host: rpcHost,
    port: rpcPort,
    requireAuth: true,
```
```ts
    validateToken: async (t) => secureTokenCompare(t, serverToken),
```

### The existing test that encodes the bypass

`packages/server-core/src/transport/__tests__/error-codes.test.ts:177-204` — this is
the regression surface. The test at lines 193-197 asserts the capability exception is
**allowed**:

```ts
describe('Transport — LOCAL_ONLY enforcement', () => {
  const localOnlyChannel = RPC_CHANNELS.file.READ_USER_ATTACHMENT

  it('denies LOCAL_ONLY channels when auth is required and the client is not the desktop', async () => {
    const { server, client } = await startPair()
    server.handle(localOnlyChannel, async () => ({ ok: true }))

    let caught: unknown
    try {
      await client.invoke(localOnlyChannel)
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('LOCAL_ONLY_DENIED')
  })

  it('allows LOCAL_ONLY channels when the desktop advertises openFileDialog', async () => {
    const { server, client } = await startPair({ clientCapabilities: [CLIENT_OPEN_FILE_DIALOG] })
    server.handle(localOnlyChannel, async () => ({ ok: true }))
    await expect(client.invoke(localOnlyChannel)).resolves.toEqual({ ok: true })
  })

  it('does not enforce LOCAL_ONLY on loopback without requireAuth', async () => {
    const { server, client } = await startPair({ requireAuth: false })
    server.handle(localOnlyChannel, async () => ({ ok: true }))
    await expect(client.invoke(localOnlyChannel)).resolves.toEqual({ ok: true })
  })
})
```

`localOnlyChannel` is `RPC_CHANNELS.file.READ_USER_ATTACHMENT`, which is inside
`LOCAL_ONLY_CHANNELS` (`packages/shared/src/protocol/routing.ts:92`). The file's test
helper `startPair` (lines 28-77) constructs the server and client and already exposes a
`requireAuth` pass-through option — the plan extends it.

### Repo conventions that apply

- Test files use `bun:test` (`import { describe, it, expect, afterEach } from 'bun:test'`) and spin up a real `WsRpcServer` + `WsRpcClient`. Match `error-codes.test.ts` exactly — do not invent a new harness.
- Constructor options are declared on the exported `WsRpcServerOptions` interface (`packages/server-core/src/transport/server.ts:121-189`) with a JSDoc line, assigned in the constructor (`:245-288`), and stored in a `private readonly` field (`:215-237`). Follow that pattern for the new flag.
- Commit messages use conventional commits (e.g. `test(shell): ...`, `docs(plan): ...` in `git log`). Example: `test(shell): re-anchor the sash geometry pin to the shipped tokens`.

## Commands you will need

| Purpose               | Command                                                                              | Expected on success |
|-----------------------|--------------------------------------------------------------------------------------|---------------------|
| Baseline test run     | `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts`           | `9 pass, 0 fail` BEFORE your edits |
| Test run (after edits)| `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts`           | `11 pass, 0 fail`   |
| Regression (startup)  | `bun test packages/server-core/src/handlers/rpc/__tests__/native-startup-runtime.test.ts` | all pass        |
| Regression (profile)  | `bun test packages/server-core/src/handlers/rpc/__tests__/native-self-profile.test.ts`    | all pass        |
| Typecheck server-core | `cd packages/server-core && bun run tsc --noEmit`                                     | exit 0              |
| Typecheck electron    | `bun run typecheck:electron`                                                          | exit 0              |
| Typecheck shared      | `bun run typecheck:shared`                                                            | exit 0              |

All commands run from the repo root unless shown with `cd`.

## Scope

**In scope** (the only files you may modify):

- `packages/server-core/src/transport/server.ts`
- `packages/server-core/src/transport/__tests__/error-codes.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `packages/server-core/src/handlers/rpc/system.ts` — the `shell:exec` handler's own
  behavior (its `assertLocalWorkspace` check, `cwd` validation, `env: process.env`) is
  **unchanged**. This plan only fixes the transport gate that runs *before* it.
- `packages/shared/src/protocol/routing.ts` — `LOCAL_ONLY_CHANNELS` membership is
  correct and must not change.
- `packages/server-core/src/transport/capabilities.ts` — `CLIENT_OPEN_FILE_DIALOG` and
  `LOCAL_CLIENT_CAPABILITIES` are still advertised by real Electron clients and still
  used for capability introspection / `invokeClient` routing. Do NOT remove them.
- Any `workspaceAuthority`, ACL, or native-authority code, and the `webAppearance`
  branch of the fence — keep it intact.
- `packages/server-core/src/bootstrap/headless-start.ts` — no wiring change is needed.

## Git workflow

- Branch: `advisor/001-local-only-fence` (or the repo's branch-naming convention).
- One commit is fine: `fix(transport): decide LOCAL_ONLY from server state, not client capability`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record the baseline

Run the baseline test command and confirm `9 pass, 0 fail`. If it is not 9, STOP
(the file has drifted).

**Verify**: `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts` → `9 pass, 0 fail`

### Step 2: Add the server-granted test-only flag to `WsRpcServerOptions`

In `packages/server-core/src/transport/server.ts`, add to the
`WsRpcServerOptions` interface (right after the `requireAuth?: boolean` entry at
line 127):

```ts
  /**
   * TEST ONLY. When true, `LOCAL_ONLY` enforcement is skipped entirely so
   * transport tests can exercise LOCAL_ONLY-gated handlers without an
   * Electron-main binding. Never set this in production wiring.
   */
  allowLocalOnlyForTests?: boolean
```

Add the backing field next to the other readonly fields (near line 216, alongside
`private readonly requireAuth: boolean`):

```ts
  private readonly allowLocalOnlyForTests: boolean
```

Assign it in the constructor (near line 257, alongside
`this.requireAuth = ...`):

```ts
    this.allowLocalOnlyForTests = opts?.allowLocalOnlyForTests ?? false
```

**Verify**: `cd packages/server-core && bun run tsc --noEmit` → exit 0

### Step 3: Remove the client-capability exception from the fence

In `packages/server-core/src/transport/server.ts`:

1. Delete the now-unused import at line 31:
   ```ts
   import { CLIENT_OPEN_FILE_DIALOG } from './capabilities'
   ```
   (Confirm it has no other use in this file first: `grep -n CLIENT_OPEN_FILE_DIALOG packages/server-core/src/transport/server.ts` should return only the comment line you are about to rewrite and the fence line you are about to change.)

2. Replace the comment and condition at lines 1193-1203 with:

```ts
    // LOCAL_ONLY is a desktop-process gate decided only by server-verified
    // state: an Electron-main binding (`localBinding`) or a server-granted
    // test escape. A client-declared capability (`clientCapabilities`) is
    // NEVER trusted here — the handshake envelope is attacker-controlled.
    if (
      isLocalOnly(channel)
      && this.shouldEnforceLocalOnly()
      && !this.allowLocalOnlyForTests
      && client.localBinding === null
      && !webAppearance
    ) {
```

Leave the body of the `if` (the `sendResponseError(..., 'LOCAL_ONLY_DENIED', ...)`
block at lines 1204-1211) exactly as it is.

**Verify**: `grep -n "CLIENT_OPEN_FILE_DIALOG\|allowLocalOnlyForTests" packages/server-core/src/transport/server.ts` → the only `CLIENT_OPEN_FILE_DIALOG` hit is none (import removed); `allowLocalOnlyForTests` appears 3 times (interface, field, constructor) plus the fence use.

**Verify**: `cd packages/server-core && bun run tsc --noEmit` → exit 0

### Step 4: Extend the test helper with the test-only flag

In `packages/server-core/src/transport/__tests__/error-codes.test.ts`, add
`allowLocalOnlyForTests?: boolean` to the `startPair` options type (lines 28-40) and
pass it through to the constructor (lines 41-48):

```ts
async function startPair(opts?: {
  clientCapabilities?: string[]
  workspaceId?: string
  requireAuth?: boolean
  allowLocalOnlyForTests?: boolean
  webContentsId?: number
  localClientProof?: string
  resolveLocalClientBinding?: (candidate: {
    workspaceId: string | null
    webContentsId: number | null
    localClientProof: string | null
  }) => { workspaceId: string; webContentsId: number } | null
  configureServer?: (server: WsRpcServer) => void
}) {
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: opts?.requireAuth ?? true,
    validateToken: async (t) => t === TEST_TOKEN,
    serverId: 'test',
    allowLocalOnlyForTests: opts?.allowLocalOnlyForTests,
    resolveLocalClientBinding: opts?.resolveLocalClientBinding,
  })
```

Leave the rest of `startPair` unchanged.

**Verify**: `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts` → still `9 pass, 0 fail` (the helper change alone must not break anything).

### Step 5: Re-point the capability test and add the exploit cases

In the same file, replace the single test at lines 193-197
(`it('allows LOCAL_ONLY channels when the desktop advertises openFileDialog', ...)`)
with the following three tests, keeping them inside the
`describe('Transport — LOCAL_ONLY enforcement', ...)` block:

```ts
  it('denies LOCAL_ONLY channels when a non-desktop client advertises openFileDialog', async () => {
    const { server, client } = await startPair({ clientCapabilities: [CLIENT_OPEN_FILE_DIALOG] })
    server.handle(localOnlyChannel, async () => ({ ok: true }))

    let caught: unknown
    try {
      await client.invoke(localOnlyChannel)
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('LOCAL_ONLY_DENIED')
  })

  it('denies shell:exec to a capability-only non-desktop client', async () => {
    const { server, client } = await startPair({ clientCapabilities: [CLIENT_OPEN_FILE_DIALOG] })
    server.handle(RPC_CHANNELS.shell.EXEC, async () => ({ ok: true }))

    let caught: unknown
    try {
      await client.invoke(RPC_CHANNELS.shell.EXEC, { command: 'echo pwned' })
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('LOCAL_ONLY_DENIED')
  })

  it('allows LOCAL_ONLY channels when the server grants local-only for tests', async () => {
    const { server, client } = await startPair({ allowLocalOnlyForTests: true })
    server.handle(localOnlyChannel, async () => ({ ok: true }))
    await expect(client.invoke(localOnlyChannel)).resolves.toEqual({ ok: true })
  })
```

Notes:

- The capability-only client in the first two tests has no `localClientProof`, so
  `localBinding` stays null and `requireAuth` defaults to true in `startPair` — the
  exact exploitable state. The first uses the existing `localOnlyChannel`
  (`file:readUserAttachment`); the second is a second `LOCAL_ONLY` channel
  (`shell:exec`), the actual sink, with a stub handler so no command ever runs.
- Do NOT delete the "denies LOCAL_ONLY channels when auth is required..." test
  (lines 180-191) or the "does not enforce LOCAL_ONLY on loopback without requireAuth"
  test (lines 199-203) — they stay as coverage for the other two branches.
- The intent of the old test (a test harness needing a `LOCAL_ONLY` channel without a
  desktop binding) is preserved by the third test, now via the explicit
  server-granted `allowLocalOnlyForTests` flag instead of a client claim.

**Verify**: `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts` → `11 pass, 0 fail`

### Step 6: Confirm no regression in the capability-advertising tests

Two other tests advertise `client:openFileDialog`; confirm they still pass (they do not
depend on the fault the fence had — they either carry a native principal, whose
capabilities are ignored, or expect denial):

- `bun test packages/server-core/src/handlers/rpc/__tests__/native-startup-runtime.test.ts`
- `bun test packages/server-core/src/handlers/rpc/__tests__/native-self-profile.test.ts`

(The channel exercised there, `llmConnections:getStartupSummary`, is **not** in
`LOCAL_ONLY_CHANNELS` — that set ends at `packages/shared/src/protocol/routing.ts:494`.)

**Verify**: both commands → all pass, 0 fail

### Step 7: Full typechecks

**Verify**: `bun run typecheck:electron` → exit 0
**Verify**: `bun run typecheck:shared` → exit 0

## Test plan

- File: `packages/server-core/src/transport/__tests__/error-codes.test.ts` (existing file, existing harness).
- Structural pattern: reuse the file's own `describe('Transport — LOCAL_ONLY enforcement')` and the surrounding `it(...)` shape — no new harness.
- Cases covered by the new/changed tests:
  1. Capability-only non-desktop client on `file:readUserAttachment` → `LOCAL_ONLY_DENIED` (the regression this plan fixes).
  2. Capability-only non-desktop client on `shell:exec` → `LOCAL_ONLY_DENIED` (the concrete sink, second `LOCAL_ONLY` channel).
  3. Server-granted `allowLocalOnlyForTests: true` → the same channel resolves (the preserved test-harness intent).
  4. Unchanged: no-capability denial (lines 180-191) and loopback-without-`requireAuth` allowance (lines 199-203).
- Verification: `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts` → `11 pass, 0 fail` (was 9; the one old capability-allow test is replaced by three).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test packages/server-core/src/transport/__tests__/error-codes.test.ts` → `11 pass, 0 fail`
- [ ] `bun test packages/server-core/src/handlers/rpc/__tests__/native-startup-runtime.test.ts` → 0 fail
- [ ] `bun test packages/server-core/src/handlers/rpc/__tests__/native-self-profile.test.ts` → 0 fail
- [ ] `cd packages/server-core && bun run tsc --noEmit` → exit 0
- [ ] `bun run typecheck:electron` → exit 0; `bun run typecheck:shared` → exit 0
- [ ] `grep -n "CLIENT_OPEN_FILE_DIALOG" packages/server-core/src/transport/server.ts` → no matches
- [ ] `grep -n "client.capabilities.has" packages/server-core/src/transport/server.ts` → no matches
- [ ] `grep -rn "allowLocalOnlyForTests" packages/ apps/ services/ | grep -v "__tests__" | grep -v "transport/server.ts"` → no matches (the flag is not wired into any production path)
- [ ] `git status --porcelain` shows only `packages/server-core/src/transport/server.ts` and `packages/server-core/src/transport/__tests__/error-codes.test.ts` modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited lines does not match the "Current state" excerpts (the codebase has drifted since this plan was written).
- Removing the capability exception makes any test **other than** the intended `error-codes.test.ts` change fail (that would mean a production path relied on the bypass — report it, do not "fix" the other test).
- `localOnlyChannel` is no longer in `LOCAL_ONLY_CHANNELS`, or `RPC_CHANNELS.shell.EXEC` is no longer a registered channel constant.
- You conclude the fix requires touching `capabilities.ts`, `system.ts`, `routing.ts`, the ACL/authority code, or the `webAppearance` branch.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- The invariant now enforced: **`LOCAL_ONLY` is decided only by server-verified state**
  (`localBinding`, the `webAppearance` path, or the test-only `allowLocalOnlyForTests`
  flag). If a future change reintroduces a handshake-envelope value into that
  condition, the bypass returns — review any diff touching the fence with that in mind.
- `allowLocalOnlyForTests` is deliberately test-only and unrestricted at runtime; it
  exists because the transport tests need a `LOCAL_ONLY` channel without an Electron
  binding. The done-criteria grep guards against it leaking into production wiring. If
  you ever add a constructor guard (e.g. throw when `requireAuth` is also true), update
  the test helper accordingly.
- Residual, **not** addressed here (deliberately out of scope): `envelope.clientCapabilities`
  is still trusted for capability introspection and server→client `invokeClient`
  routing when there is no principal (`server.ts:1054`). That is a server-initiated
  direction and a separate design question; this plan only closes the inbound
  authority escalation. Raise it as its own finding if it becomes exploitable.
- Reviewer should scrutinize: (1) the fence condition now reads only
  `isLocalOnly` / `shouldEnforceLocalOnly` / `allowLocalOnlyForTests` / `localBinding` /
  `webAppearance`; (2) the `shell:exec` handler in `system.ts` is byte-identical before
  and after; (3) `CLIENT_OPEN_FILE_DIALOG` and `LOCAL_CLIENT_CAPABILITIES` are still
  exported and still advertised by real Electron clients (`apps/electron/src/preload/bootstrap.ts`).