# Plan 006: Stop latching out a stop/cancel whose forward failed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md` if that file exists and a reviewer asked you to
> maintain it; otherwise report the status back to whoever dispatched you.
>
> **Drift check (run first)**: `git diff --stat 346374d43..HEAD -- apps/electron/src/main/voice/overlay-owner.ts apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts apps/electron/src/main/voice/__tests__/overlay-owner.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `346374d43`, 2026-10-09

## Why this matters

The native voice-overlay mini-window forwards its Stop/Cancel buttons to the
capture owner over IPC. The handler in `overlay-owner.ts` guards each command
with a one-shot latch (`stopSent` / `cancelSent`) so a double-click cannot send
the same command twice — but it sets the latch **before** the forward and never
clears it when the forward fails (`options.sendCommand(...)` returns `false`,
i.e. the owner's request context is no longer usable). The latch then stays set
for that `recordingId` and the surface refuses every later Stop/Cancel for the
same recording with `{ ok: false }` until the recording id changes. The user is
locked out of stopping a live recording through the overlay and must wait for
it to change state. The fix keeps the one-shot guarantee for a command that
*was* forwarded, and only releases the latch when nothing was forwarded.

## Current state

All facts verified at `346374d43`.

### Files

- `apps/electron/src/main/voice/overlay-owner.ts` — the IPC command handler and
  the `stopSent` / `cancelSent` latches (lines 18-19, 54-69); contains the bug.
- `apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts` — the real
  behavioural tests (mock `electron`, `FakeWindow`); must run in isolation.
- `apps/electron/src/main/voice/__tests__/overlay-owner.test.ts` — wrapper that
  spawns the isolated file in a child process and asserts its summary line.

### The bug (verbatim, `overlay-owner.ts:54-69`)

```ts
    if (action === 'stop') {
      if (phase !== 'recording' || stopSent || cancelSent) return { ok: false }
      stopSent = true
      return { ok: options.sendCommand(latest!.context, 'toggle', recordingId) }
    }
    if (action === 'cancel') {
      if (!['permission', 'recording', 'saving', 'transcribing', 'enhancing'].includes(phase) || cancelSent) return { ok: false }
      cancelSent = true
      return { ok: options.sendCommand(latest!.context, 'cancel', recordingId) }
    }
```

`stopSent = true` runs unconditionally, then the return value of
`options.sendCommand` becomes `{ ok }`. When the forward fails (`false`) the
response is `{ ok: false }` **and** the latch remains `true`. Both commands have
the identical shape; both are fixed.

### The other reset point (unchanged)

`publish()` at `overlay-owner.ts:83`:

```ts
      if (latest?.state.recordingId !== input.state.recordingId) { stopSent = false; cancelSent = false }
```

and `disposeSurface()` (`:28`) also clears both. These stay as-is — they only
recover on a recording-id change or surface teardown, which is exactly why the
failure is a lock-out.

### Protections that must survive

The handler's sender check (`:50`), snapshot branch (`:51`), `recordingId`
match (`:52`), the `phase` checks (`:55`, `:64`) and the single-forward
guarantee for a command that *did* forward (`stopSent`/`cancelSent` still make
a repeated successful command return `{ ok: false }`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Overlay tests (runs the isolated suite) | `bun test apps/electron/src/main/voice/__tests__/overlay-owner.test.ts` | `1 pass, 0 fail` |
| Isolated suite directly | `bun test apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts` | `3 pass, 0 fail` |

(`*.isolated.ts` files must run alone — never batch them with other files; the
wrapper exists for exactly that. This plan's executor does **not** need to run
`pnpm`/`bun run test` — the orchestrator runs the repo-wide checks.)

## Scope

**In scope** (the only files changed):

- `apps/electron/src/main/voice/overlay-owner.ts` — release the latch on a
  failed forward.
- `apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts` — one new
  case.
- `apps/electron/src/main/voice/__tests__/overlay-owner.test.ts` — bump the
  expected `N pass` count from `2` to `3`.

**Out of scope** (do NOT touch):

- `overlay-owner.ts`'s sender/owner/recordingId/phase guards and the
  `publish()` / `disposeSurface()` reset logic — they are correct as-is.
- The overlay renderer (`voice-overlay-preload.cjs`, `voice-overlay.html`) and
  anything under `apps/electron/src/renderer/`.
- `apps/electron/src/main/index.ts` (the `sendCommand` implementation) — this
  plan does not change *why* the forward can fail, only the consequence.
- Any other test file, and any formatting/reordering of untouched lines.

## Git workflow

- Branch: `advisor/006-voice-overlay-stop-latch`.
- Commit message style matches the repo (Conventional Commits):
  `fix(voice): do not latch out a stop whose forward failed`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Release the latch when the forward fails

In `overlay-owner.ts`, replace the two `return { ok: options.sendCommand(...) }`
lines so the latch is cleared when the forward returns `false`. Target shape
(already the as-built code at `346374d43`):

```ts
    if (action === 'stop') {
      if (phase !== 'recording' || stopSent || cancelSent) return { ok: false }
      stopSent = true
      // A forward that never lands must not latch the command out: the surface
      // is still showing this recording, so a later stop for it must be allowed.
      const sent = options.sendCommand(latest!.context, 'toggle', recordingId)
      if (!sent) stopSent = false
      return { ok: sent }
    }
    if (action === 'cancel') {
      if (!['permission', 'recording', 'saving', 'transcribing', 'enhancing'].includes(phase) || cancelSent) return { ok: false }
      cancelSent = true
      const sent = options.sendCommand(latest!.context, 'cancel', recordingId)
      if (!sent) cancelSent = false
      return { ok: sent }
    }
```

A successful forward keeps the latch set, so a repeated successful command is
still refused; a failed forward releases it, so the same recording can be
commanded again.

**Verify**: `grep -c 'if (!sent) stopSent = false' apps/electron/src/main/voice/overlay-owner.ts`
→ `1`, and `grep -c 'if (!sent) cancelSent = false' apps/electron/src/main/voice/overlay-owner.ts` → `1`.

### Step 2: Add the regression case

In `overlay-owner.isolated.ts`, inside the existing
`describe('actual native overlay owner composition', ...)`, add a third `it`
after the "background actors never replace a live surface" case (as-built
content is in "Test plan" below).

**Verify**: `grep -c "it('" apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts`
→ `3`.

### Step 3: Bump the wrapper's expected count

In `overlay-owner.test.ts`, change `expect(stderr).toContain('2 pass')` to
`expect(stderr).toContain('3 pass')`. Leave `'0 fail'` and the 20 s timeout.

**Verify**: `grep -n "pass'" apps/electron/src/main/voice/__tests__/overlay-owner.test.ts`
→ one line containing `3 pass`.

### Step 4: Run the suite

**Verify**: `bun test apps/electron/src/main/voice/__tests__/overlay-owner.test.ts`
→ `1 pass, 0 fail`; the child's stderr contains `3 pass` / `0 fail`, so
`bun test apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts`
→ `3 pass, 0 fail`.

## Test plan

- **New test**: the third case in `overlay-owner.isolated.ts` (below), covering
  the regression (a failed stop forward must not latch out the next stop for
  the same recording), the preserved single-shot guarantee (a successful forward
  still refuses a repeat), and the same for cancel.
- **Structural pattern**: the two existing `it` cases in the same file — same
  `FakeWindow` / `handlers` / `children` fixtures and `createNativeVoiceOverlayHost`
  construction.
- **Baseline counts quoted from the files as they stood**: `overlay-owner.isolated.ts`
  had **2** `it` cases; `overlay-owner.test.ts` asserted `expect(stderr).toContain('2 pass')`
  and `'0 fail'`. After this plan: **3** `it` cases and `'3 pass'`.
- **Verification**: `bun test apps/electron/src/main/voice/__tests__/overlay-owner.test.ts`
  → `1 pass, 0 fail`; `.../overlay-owner.isolated.ts` → `3 pass, 0 fail`.

As-built new case (`overlay-owner.isolated.ts:88-114`):

```ts
  it('a command whose forward fails does not latch out a later stop or cancel for the same recording', () => {
    const owner = new FakeWindow(); const commands: unknown[] = []
    let forwardOk = false
    const port = createNativeVoiceOverlayHost({ resolveOwner: () => owner as never,
      sendCommand: (...args) => { commands.push(args); return forwardOk } })
    port.publish({ context, state, position: 'top', assertCurrent() {} })
    const child = children.at(-1)!
    const command = handlers.get(VOICE_OVERLAY_COMMAND)!
    // The first stop reaches the handler but the forward fails: nothing was sent,
    // so the surface must still accept a stop for the same recording.
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    expect(commands).toHaveLength(1)
    forwardOk = true
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: true })
    expect(commands).toHaveLength(2)
    // A successful forward stays single-shot.
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    expect(commands).toHaveLength(2)
    // The same holds for cancel.
    forwardOk = false
    expect(command({ sender: child.webContents }, 'cancel', state.recordingId)).toEqual({ ok: false })
    expect(commands).toHaveLength(3)
    forwardOk = true
    expect(command({ sender: child.webContents }, 'cancel', state.recordingId)).toEqual({ ok: true })
    expect(commands).toHaveLength(4)
    port.dispose()
  })
```

Without Step 1, the second `stop` line asserts `{ ok: true }` but the old code
returns `{ ok: false }` (latch stuck), so the case fails — this is the
regression guard.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c 'if (!sent) stopSent = false' apps/electron/src/main/voice/overlay-owner.ts` → `1`
- [ ] `grep -c 'if (!sent) cancelSent = false' apps/electron/src/main/voice/overlay-owner.ts` → `1`
- [ ] `grep -c "it('" apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts` → `3`
- [ ] `grep -c "3 pass" apps/electron/src/main/voice/__tests__/overlay-owner.test.ts` → `1`
- [ ] `bun test apps/electron/src/main/voice/__tests__/overlay-owner.test.ts` exits 0, `1 pass, 0 fail`
- [ ] `bun test apps/electron/src/main/voice/__tests__/overlay-owner.isolated.ts` exits 0, `3 pass, 0 fail`
- [ ] `git status` shows nothing modified outside the three in-scope files

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpt at `overlay-owner.ts:54-69` does not match the
  live file (the tree has drifted since `346374d43`).
- `overlay-owner.isolated.ts` no longer defines the `handlers` / `children` /
  `FakeWindow` fixtures the new case relies on.
- The isolated suite reports anything other than `3 pass, 0 fail`, or the
  wrapper's child exits non-zero for a reason other than the new case.
- The fix appears to require touching an out-of-scope file (e.g. the renderer
  or `index.ts`), or the sender/phase guards would have to change.
- A reviewer tells you the index `advisor-plans/README.md` is theirs — do not
  edit it.

## Maintenance notes

- **Keep the two latches symmetric.** Both `stop` and `cancel` use the
  `set → forward → clear-on-failure` shape; if a third forwarding command is
  added, give it the same shape rather than a third convention.
- **A reviewer should check** that a *successful* forward still refuses a
  repeat (`stopSent`/`cancelSent` remain `true`) and that the sender,
  recordingId and phase guards are byte-identical to before.
- **The reset points** in `publish()` (recordingId change) and `disposeSurface()`
  are unchanged and still correct; this plan only adds the failed-forward reset.
- **Deferred (out of scope):** *why* `sendCommand` can return `false` (owner
  context revoked mid-recording) is a separate concern in
  `apps/electron/src/main/index.ts`; no change is made there.