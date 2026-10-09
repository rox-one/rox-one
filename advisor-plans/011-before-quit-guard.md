# Plan 011: Guarantee `app.exit(0)` when the `before-quit` cleanup throws

> **Executor instructions**: Follow this plan step by step. Every step is a file
> edit; you do NOT run tests, linters, or formatters — the reviewer/orchestrator
> runs the verification gates at the end. If anything in the "STOP conditions"
> section matches what you see on disk, stop and report — do not improvise.
> When done, report the edited/created files back to whoever dispatched you; do
> not touch `advisor-plans/README.md` unless a reviewer explicitly told you to
> maintain it.
>
> **Drift check (run first)**: `git diff --stat 3114264ee..HEAD -- apps/electron/src/main/index.ts apps/electron/src/main/quit-exit-guard.ts apps/electron/src/main/__tests__/quit-exit-guard.test.ts`
> If `index.ts` changed since this plan was written, compare the "Current state"
> excerpts against the live file before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Revision**: `3114264ee` (branch `e01-decisions`)
- **Finding**: CORRECTNESS-05 (audit card `/tmp/improve-full.md:96-109`)
- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Confidence**: MED (the code path is clear; reproducibility depends on which dispose step throws)
- **Depends on**: none
- **Category**: bug

## Why this matters

The Electron main process's `before-quit` handler calls
`event.preventDefault()` to cancel the default quit, then `await
performQuitCleanup()` and `app.exit(0)` (`apps/electron/src/main/index.ts:2064-2066`).
The handler is `async` and has **no try/catch**, and `performQuitCleanup`
contains steps that are *not* individually guarded:
`getModelRefreshService().stopAll()` (`index.ts:1972`),
`await import('./power-manager')` (`index.ts:2013`), and `releaseServerLock()`
(`index.ts:2017`). If any of these throws (or rejects between `await`s), the
async handler rejects *after* the quit was already cancelled: `app.exit(0)` is
never reached, so the process stays alive with no windows (the classic macOS
"zombie"), still holding the server-lock and config-dir lock — and the next
launch complains the lock is held. The only trace is an `unhandledRejection`.
Guaranteeing `app.exit(0)` in a `finally` turns a wedged process into a clean
exit, regardless of which cleanup step fails.

## Current state

All facts verified at `3114264ee`.

### Files

- `apps/electron/src/main/index.ts` — Electron main entrypoint; contains
  `performQuitCleanup` (line 1920) and the `before-quit` handler (line 2021).
- `apps/electron/src/main/quit-exit-guard.ts` — **to be created**: the tiny
  pure helper that always exits after cleanup.
- `apps/electron/src/main/__tests__/quit-exit-guard.test.ts` — **to be created**:
  the unit test for the helper.

### The handler (verbatim, `index.ts:2063-2068`)

```ts
  if (sessionManager || openDesignRuntime?.hasActiveRuntime()) {
    event.preventDefault()
    await performQuitCleanup()
    app.exit(0)
  }
})
```

There is no `try`/`catch`/`finally`: a rejection from `performQuitCleanup`
skips `app.exit(0)`. (The update-install path does not reach this branch — it
returns early at `index.ts:2023-2024` — this plan changes only the normal-quit
branch.)

### The unguarded cleanup steps inside `performQuitCleanup`

```ts
  // index.ts:1972 — not inside any try/catch
  getModelRefreshService().stopAll()

  // index.ts:2013 — not inside any try/catch
  const { cleanup: cleanupPowerManager } = await import('./power-manager')
  cleanupPowerManager()

  // index.ts:2017 — not inside any try/catch
  releaseServerLock()
```

### The idempotency invariant that must survive (`index.ts:1919-1927`)

```ts
let quitCleanupRan = false
async function performQuitCleanup(): Promise<void> {
  // Idempotent: a failed update install may retry, and the update path plus a
  // subsequent quit must not dispose already-disposed services.
  if (quitCleanupRan) {
    mainLog.info('Quit cleanup already ran, skipping')
    return
  }
  quitCleanupRan = true
  …
```

Do not touch this function or its guard flag; the fix is entirely in the
handler, which calls `performQuitCleanup` exactly once.

### Why a helper (test strategy)

`index.ts` is the Electron app entrypoint: importing it registers
`app.on(...)` handlers and runs module-level bootstrap, so the `before-quit`
handler itself cannot be unit-tested. The minimum sufficient test level is a
unit test on a small extractable helper that encapsulates the exact invariant
("cleanup runs; whatever happens, exit is called"). The helper holds no state
and imports nothing from `electron`, so it is trivially testable.

## Scope

**In scope** (the only files you may modify/create):

- `apps/electron/src/main/quit-exit-guard.ts` — **create**.
- `apps/electron/src/main/index.ts` — replace the handler's
  `await performQuitCleanup(); app.exit(0)` with a call to the helper, and add
  one import.
- `apps/electron/src/main/__tests__/quit-exit-guard.test.ts` — **create**.

**Out of scope** (do NOT touch, even though they look related):

- `performQuitCleanup` itself (`index.ts:1920`) and the `quitCleanupRan`
  idempotency guard — leave them exactly as they are.
- The update-install path (`beforeUpdateInstallHook`, `installUpdate`) and
  `setBeforeUpdateQuitHook` — this plan only covers the normal `before-quit`
  branch.
- Do not add try/catch around the individual steps at `index.ts:1972/2013/2017`;
  the guarantee lives in one place (the helper).
- Any other file; any reformatting of untouched lines.

## Executor steps

### Step 1: Create the helper `apps/electron/src/main/quit-exit-guard.ts`

Create the file with exactly:

```ts
/**
 * Run the quit cleanup, then ALWAYS terminate the process.
 *
 * `before-quit` cancels the default quit with `event.preventDefault()`, so if
 * `cleanup` throws or rejects (an unguarded dispose step in performQuitCleanup
 * failing between awaits) the process would otherwise survive with no windows
 * and keep the server/config locks held. Running `exit` in a `finally`
 * guarantees termination regardless of how cleanup ends.
 */
export async function runQuitCleanupThenExit(
  cleanup: () => Promise<void>,
  exit: (code: number) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    onError(error)
  } finally {
    exit(0)
  }
}
```

### Step 2: Add the import to `apps/electron/src/main/index.ts`

Immediately after the line
`import { createLocalClientBindingRegistry } from './local-client-binding'`
(currently `index.ts:162`), add:

```ts
import { runQuitCleanupThenExit } from './quit-exit-guard'
```

### Step 3: Route the `before-quit` normal-quit branch through the helper

In `apps/electron/src/main/index.ts`, replace this exact block (currently
lines 2063-2067):

```ts
  if (sessionManager || openDesignRuntime?.hasActiveRuntime()) {
    event.preventDefault()
    await performQuitCleanup()
    app.exit(0)
  }
```

with:

```ts
  if (sessionManager || openDesignRuntime?.hasActiveRuntime()) {
    event.preventDefault()
    // performQuitCleanup has unguarded steps (model-refresh stopAll, the
    // power-manager import, releaseServerLock). Whatever throws, we must still
    // exit: the quit was already cancelled above, so a rejection here would
    // leave a windowless process holding the server/config locks.
    await runQuitCleanupThenExit(
      performQuitCleanup,
      code => app.exit(code),
      error => mainLog.error('[quit] cleanup failed; forcing exit:', error),
    )
  }
```

`mainLog` is already imported at `index.ts:148`; no new import for it.

### Step 4: Create the unit test `apps/electron/src/main/__tests__/quit-exit-guard.test.ts`

Create the file with exactly:

```ts
import { describe, it, expect } from 'bun:test'
import { runQuitCleanupThenExit } from '../quit-exit-guard'

describe('runQuitCleanupThenExit', () => {
  it('always exits after a successful cleanup', async () => {
    const exits: number[] = []
    await runQuitCleanupThenExit(async () => {}, code => exits.push(code), () => {})
    expect(exits).toEqual([0])
  })

  it('still exits when cleanup rejects, after reporting the error', async () => {
    const exits: number[] = []
    const errors: unknown[] = []
    await runQuitCleanupThenExit(
      async () => { throw new Error('stopAll failed') },
      code => exits.push(code),
      error => errors.push(error),
    )
    expect(exits).toEqual([0])
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('stopAll failed')
  })

  it('awaits cleanup before exiting', async () => {
    const order: string[] = []
    await runQuitCleanupThenExit(
      async () => { await Bun.sleep(1); order.push('cleanup') },
      () => order.push('exit'),
      () => {},
    )
    expect(order).toEqual(['cleanup', 'exit'])
  })
})
```

## Verification gates (orchestrator)

Run from the worktree root (`cd /Users/t/Projects/archive/rox-one-e01-wt`).

| # | Command | Expected |
|---|---------|----------|
| G1 | `cd /Users/t/Projects/archive/rox-one-e01-wt && bun test apps/electron/src/main/__tests__/quit-exit-guard.test.ts` | `3 pass, 0 fail` |
| G2 | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "runQuitCleanupThenExit" apps/electron/src/main/index.ts` | `2` (one import, one call) |
| G3 (negative) | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -n "await performQuitCleanup()" apps/electron/src/main/index.ts` | exactly one hit — the *update-install* path (`~:1808`); the `before-quit` branch no longer calls it directly |
| G4 (code-path) | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -n -A6 "if (sessionManager || openDesignRuntime?.hasActiveRuntime())" apps/electron/src/main/index.ts` | shows `event.preventDefault()` then `await runQuitCleanupThenExit(...)`, and **no** bare `app.exit(0)` immediately after `performQuitCleanup` |
| G5 | `cd /Users/t/Projects/archive/rox-one-e01-wt && cd apps/electron && bun run tsc --noEmit` | no **new** errors (see note) |
| G6 | `cd /Users/t/Projects/archive/rox-one-e01-wt && git status --porcelain` | only `index.ts` modified and the two new files added |

G3 interpretation: `performQuitCleanup` is also awaited by the update-install
hook; that call site must remain. The gate proves the *normal-quit* branch no
longer awaits it outside the helper.

G5 note: the repo README records that `typecheck:electron` is **already red on
the base revision** with 4 pre-existing errors in
`apps/electron/src/renderer/App.tsx` (unrelated `AudioTranscript*` exports).
The gate is therefore "no NEW error mentions `quit-exit-guard.ts` or the changed
region of `index.ts`", not "exit 0".

## Test plan

- **New tests** (new file, verbatim above): exercises the three properties of
  the helper — exit after success, exit-with-error-report after a rejection,
  and cleanup-before-exit ordering.
- **Regression proof**: the second case fails if the helper drops its `finally`
  (a rejected `cleanup` would leave `exits` empty) — that is the exact defect
  being prevented.
- **Structural pattern**: `apps/electron/src/main/__tests__/server-endpoint-policy.test.ts`
  imports a co-located pure helper (`../server-endpoint-policy.ts`) and tests it
  with plain `describe/it/expect` from `bun:test`. Match that shape.
- **Verification**: G1.

## Done criteria

ALL must hold:

- [ ] `apps/electron/src/main/quit-exit-guard.ts` exists and exports
      `runQuitCleanupThenExit`
- [ ] `index.ts` imports and calls the helper in the `before-quit` branch; the
      branch no longer calls `performQuitCleanup()` + `app.exit(0)` directly (G2,
      G3, G4)
- [ ] `apps/electron/src/main/__tests__/quit-exit-guard.test.ts` exists with the
      three cases; `bun test <file>` → `3 pass, 0 fail` (G1)
- [ ] no new `tsc --noEmit` errors attributable to the changed files (G5)
- [ ] `git status` shows only the three in-scope paths (G6)
- [ ] `performQuitCleanup` and `quitCleanupRan` are unchanged

## STOP conditions

Stop and report (do not improvise) if:

- The handler excerpt at `index.ts:2063-2067` does not match the live file, or
  `await performQuitCleanup()` no longer appears at `~:1808` (the update path).
- The branch guard is not literally `if (sessionManager || openDesignRuntime?.hasActiveRuntime())`.
- `import { createLocalClientBindingRegistry } from './local-client-binding'`
  is no longer present (pick another stable `./` import as the insertion anchor
  and say so in your report).
- Extracting the helper appears to require touching `performQuitCleanup`, the
  `quitCleanupRan` guard, or the update-install hook.
- A reviewer tells you `advisor-plans/README.md` is theirs.

## Maintenance notes

- **One place owns the guarantee.** Never re-inline `performQuitCleanup()` +
  `app.exit(0)` into an async lifecycle handler; always go through
  `runQuitCleanupThenExit` so a future dispose step that throws cannot re-wedge
  the process.
- **Idempotency stays in `performQuitCleanup`** (`quitCleanupRan`). The helper
  calls it once; do not add a second idempotency layer.
- **Reviewer should check**: `event.preventDefault()` still precedes the call,
  the error callback logs (never silently swallows), and the update-install
  path is untouched.
- **Deferred (out of scope):** making the individual steps at
  `index.ts:1972/2013/2017` throw-proof is not done here; the single `finally`
  covers them.