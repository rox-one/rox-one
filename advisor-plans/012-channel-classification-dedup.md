# Plan 012: De-duplicate and complete the channel-classification tables (fix the red routing test)

> **Executor instructions**: Follow this plan step by step. Every step is a file
> edit; you do NOT run tests, linters, or formatters — the reviewer/orchestrator
> runs the verification gates at the end. If anything in the "STOP conditions"
> section matches what you see on disk, stop and report — do not improvise.
> When done, report the edited files back to whoever dispatched you; do not
> touch `advisor-plans/README.md` unless a reviewer explicitly told you to
> maintain it.
>
> **Drift check (run first)**: `git diff --stat 3114264ee..HEAD -- packages/shared/src/protocol/routing.ts packages/shared/src/protocol/channels.ts packages/shared/src/protocol/__tests__/routing.test.ts`
> If `routing.ts` changed since this plan was written, compare the "Current
> state" excerpts against the live file before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Revision**: `3114264ee` (branch `e01-decisions`)
- **Finding**: CORRECTNESS-07 (audit card `/tmp/improve-full.md:127-137`)
- **Priority**: P1 (the routing test is **red at HEAD** — see "Why this matters")
- **Effort**: S
- **Risk**: LOW
- **Confidence**: HIGH
- **Depends on**: none
- **Category**: bug / tech-debt

## Why this matters

`packages/shared/src/protocol/routing.ts` is the exhaustive source-of-truth
table that classifies every RPC channel into `LOCAL_ONLY_CHANNELS` or
`REMOTE_ELIGIBLE_CHANNELS`, and the transport gates channel access on it. Two
defects live in that table at HEAD:

1. **Merge-artifact duplicates.** `RPC_CHANNELS.sessions.SET_MEMORY_MODE` and
   `RPC_CHANNELS.sessions.GET_PROVENANCE` each appear **twice** inside
   `REMOTE_ELIGIBLE_CHANNELS` (lines 585 and 598, 586 and 599). Because the
   table is a `Set`, the runtime behavior is unchanged — but the *source* table
   lies about its own composition, and the current test can't catch it.
2. **Four unclassified channels → the test is RED.** Committed channels
   `notes:listComments`, `notes:createComment`, `notes:updateComment`,
   `notes:deleteComment` (`channels.ts:216-219`, landed in `385aaf59d`) were
   never added to either set, so `routing.test.ts` currently reports **22 pass /
   2 fail**:
   - `Channel "notes:listComments" is not classified in LOCAL_ONLY or REMOTE_ELIGIBLE.`
   - `total classified equals total channels` — Expected 863, Received 859.

After this plan: the duplicates are gone; the four comment channels are
classified as `REMOTE_ELIGIBLE` (they are workspace note-vault operations, like
every other `notes.*` channel — see `routing.ts:649-674`); the raw list literals
are exported so a new invariant test ("no duplicate entries in the raw lists")
can guard against a future re-introduction of this merge artifact; and
`routing.test.ts` passes with **0 fail**.

## Current state

All facts verified at `3114264ee`.

### Files

- `packages/shared/src/protocol/routing.ts` — the classification table (Sets at
  lines 17 and 500; helpers `isLocalOnly`/`isRemoteEligible` at 1132/1136).
- `packages/shared/src/protocol/channels.ts` — channel name registry; the four
  comment channels are defined at lines 216-219.
- `packages/shared/src/protocol/__tests__/routing.test.ts` — the exhaustiveness
  + behavior test (currently red).

### The duplicates (verbatim, `routing.ts:583-600`)

```ts
  RPC_CHANNELS.sessions.CREATE,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.SET_MEMORY_MODE,        // line 585 — first occurrence
  RPC_CHANNELS.sessions.GET_PROVENANCE,         // line 586 — first occurrence
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.KILL_SHELL,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.BULK_UPDATE,
  RPC_CHANNELS.sessions.BULK_CHANGED,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.SET_MEMORY_MODE,        // line 598 — duplicate
  RPC_CHANNELS.sessions.GET_PROVENANCE,         // line 599 — duplicate
  RPC_CHANNELS.sessions.EVENT,
```

Both duplicate lines live inside `REMOTE_ELIGIBLE_CHANNELS` (opened at line
500). Keep the first pair (585-586); delete the second pair (598-599).

### The four unclassified channels (verbatim, `channels.ts:215-220`)

```ts
  notes: {
    LIST: 'notes:list',
    READ: 'notes:read',
    SAVE: 'notes:save',
    CREATE: 'notes:create',
    LIST_COMMENTS: 'notes:listComments',
    CREATE_COMMENT: 'notes:createComment',
    UPDATE_COMMENT: 'notes:updateComment',
    DELETE_COMMENT: 'notes:deleteComment',
```

### The notes block in `REMOTE_ELIGIBLE_CHANNELS` (verbatim, `routing.ts:649-674`)

```ts
  // notes — workspace note vault
  RPC_CHANNELS.notes.LIST,
  RPC_CHANNELS.notes.READ,
  RPC_CHANNELS.notes.SAVE,
  RPC_CHANNELS.notes.UPDATE_PROPERTIES,
  RPC_CHANNELS.notes.CREATE,
  RPC_CHANNELS.notes.PREPARE_CREATE,
  RPC_CHANNELS.notes.RENAME,
  RPC_CHANNELS.notes.MOVE,
  RPC_CHANNELS.notes.DELETE,
  RPC_CHANNELS.notes.SEARCH,
  RPC_CHANNELS.notes.GET_BACKLINKS,
  RPC_CHANNELS.notes.GET_INSIGHTS,
  RPC_CHANNELS.notes.GET_INDEX_HEALTH,
  RPC_CHANNELS.notes.GET_RENAME_IMPACT,
  RPC_CHANNELS.notes.GET_DAILY_NOTE,
  RPC_CHANNELS.notes.IMPORT_ASSET,
  RPC_CHANNELS.notes.LIST_ASSETS,
  RPC_CHANNELS.notes.DELETE_ASSET,
  RPC_CHANNELS.notes.RENAME_ASSET,
  RPC_CHANNELS.notes.REBUILD_INDEX,
  RPC_CHANNELS.notes.WATCH,
  RPC_CHANNELS.notes.UNWATCH,
  RPC_CHANNELS.notes.CHANGED,
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,
```

### The set declarations (verbatim, openings)

`routing.ts:17`:
```ts
export const LOCAL_ONLY_CHANNELS = new Set<string>([
```

`routing.ts:500`:
```ts
export const REMOTE_ELIGIBLE_CHANNELS = new Set<string>([
```

`LOCAL_ONLY_CHANNELS` closes at line 494 (`])`), `REMOTE_ELIGIBLE_CHANNELS`
closes at the end of the file body at line 1126 (`])`).

### The existing test (verbatim, `routing.test.ts:1-42`)

```ts
import { describe, test, expect } from 'bun:test'
import { getAllChannelValues, RPC_CHANNELS } from '../channels'
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '../routing'

describe('channel routing exhaustiveness', () => {
  const all = getAllChannelValues()

  test('every channel is classified exactly once', () => {
    for (const ch of all) {
      const inLocal = LOCAL_ONLY_CHANNELS.has(ch)
      const inRemote = REMOTE_ELIGIBLE_CHANNELS.has(ch)

      if (!inLocal && !inRemote) {
        throw new Error(`Channel "${ch}" is not classified in LOCAL_ONLY or REMOTE_ELIGIBLE. Add it to one set in routing.ts.`)
      }
      if (inLocal && inRemote) {
        throw new Error(`Channel "${ch}" is in BOTH LOCAL_ONLY and REMOTE_ELIGIBLE. It must be in exactly one.`)
      }
    }
  })

  test('no extra channels in LOCAL_ONLY', () => {
    for (const ch of LOCAL_ONLY_CHANNELS) {
      expect(all).toContain(ch)
    }
  })

  test('no extra channels in REMOTE_ELIGIBLE', () => {
    for (const ch of REMOTE_ELIGIBLE_CHANNELS) {
      expect(all).toContain(ch)
    }
  })

  test('sets are non-empty', () => {
    expect(LOCAL_ONLY_CHANNELS.size).toBeGreaterThan(0)
    expect(REMOTE_ELIGIBLE_CHANNELS.size).toBeGreaterThan(0)
  })

  test('total classified equals total channels', () => {
    expect(LOCAL_ONLY_CHANNELS.size + REMOTE_ELIGIBLE_CHANNELS.size).toBe(all.length)
  })
})
```

Because the exports are `Set`s, duplicates are collapsed on construction and
no runtime assertion can observe them — hence the raw lists are exported (step
5) so the new invariant test can.

## Scope

**In scope** (the only files you may modify):

- `packages/shared/src/protocol/routing.ts`
- `packages/shared/src/protocol/__tests__/routing.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `packages/shared/src/protocol/channels.ts` — the channel definitions and
  `getAllChannelValues()` are correct; only the classification changes.
- `isLocalOnly` / `isRemoteEligible` (routing.ts:1132/1136) — unchanged.
- Any other channel, group, or line of `routing.ts` — this plan touches only:
  the two set openings, the two set closings, the two duplicate lines, and the
  four new notes additions.
- Any consumer of the sets (there are none outside `routing.ts` +
  `routing.test.ts`).

## Executor steps

> Do the edits by content anchors (the strings quoted below), not by line
> number — earlier edits shift later line numbers.

### Step 1: Delete the two duplicate entries

In `routing.ts`, replace this exact block:

```ts
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.SET_MEMORY_MODE,
  RPC_CHANNELS.sessions.GET_PROVENANCE,
  RPC_CHANNELS.sessions.EVENT,
```

with:

```ts
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.EVENT,
```

This removes the second occurrences (`SET_MEMORY_MODE`, `GET_PROVENANCE`)
while keeping the first pair.

### Step 2: Classify the four comment channels as REMOTE_ELIGIBLE

In `routing.ts`, replace this exact block (the tail of the notes group):

```ts
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,
```

with:

```ts
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,
  RPC_CHANNELS.notes.LIST_COMMENTS,
  RPC_CHANNELS.notes.CREATE_COMMENT,
  RPC_CHANNELS.notes.UPDATE_COMMENT,
  RPC_CHANNELS.notes.DELETE_COMMENT,
```

### Step 3: Export the LOCAL_ONLY raw list and build the Set from it

In `routing.ts`, replace the opening line:

```ts
export const LOCAL_ONLY_CHANNELS = new Set<string>([
```

with:

```ts
export const LOCAL_ONLY_CHANNEL_LIST: readonly string[] = [
```

Then replace the closing block (immediately above the
`// REMOTE_ELIGIBLE — runs on whichever server owns the workspace` comment):

```ts
  RPC_CHANNELS.directory.EXPORT_DOSSIER,

])
```

with:

```ts
  RPC_CHANNELS.directory.EXPORT_DOSSIER,

]

export const LOCAL_ONLY_CHANNELS = new Set<string>(LOCAL_ONLY_CHANNEL_LIST)
```

### Step 4: Export the REMOTE_ELIGIBLE raw list and build the Set from it

In `routing.ts`, replace the opening line:

```ts
export const REMOTE_ELIGIBLE_CHANNELS = new Set<string>([
```

with:

```ts
export const REMOTE_ELIGIBLE_CHANNEL_LIST: readonly string[] = [
```

Then replace the closing block:

```ts
  RPC_CHANNELS.commands.EVENT,
])
```

with:

```ts
  RPC_CHANNELS.commands.EVENT,
]

export const REMOTE_ELIGIBLE_CHANNELS = new Set<string>(REMOTE_ELIGIBLE_CHANNEL_LIST)
```

### Step 5: Add the "no duplicate entries in the raw lists" invariant test

In `packages/shared/src/protocol/__tests__/routing.test.ts`:

**5a.** Replace the import line

```ts
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from '../routing'
```

with

```ts
import { LOCAL_ONLY_CHANNEL_LIST, LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNEL_LIST, REMOTE_ELIGIBLE_CHANNELS } from '../routing'
```

**5b.** Insert this new `describe` block between the end of
`describe('channel routing exhaustiveness', …)` and the start of
`describe('channel routing behavior', …)` — i.e. replace

```ts
    expect(LOCAL_ONLY_CHANNELS.size + REMOTE_ELIGIBLE_CHANNELS.size).toBe(all.length)
  })
})

describe('channel routing behavior', () => {
```

with

```ts
    expect(LOCAL_ONLY_CHANNELS.size + REMOTE_ELIGIBLE_CHANNELS.size).toBe(all.length)
  })
})

describe('channel routing source lists', () => {
  // The exported Sets de-duplicate on construction, so a duplicated source line
  // (the merge artifact this plan fixes) is invisible at runtime. Assert on the
  // raw lists so a future duplicate fails CI.
  for (const [name, list] of [
    ['LOCAL_ONLY_CHANNEL_LIST', LOCAL_ONLY_CHANNEL_LIST],
    ['REMOTE_ELIGIBLE_CHANNEL_LIST', REMOTE_ELIGIBLE_CHANNEL_LIST],
  ] as const) {
    test(`${name} contains no duplicate entries`, () => {
      const seen = new Set<string>()
      const duplicates = list.filter(channel => {
        if (seen.has(channel)) return true
        seen.add(channel)
        return false
      })
      expect(duplicates).toEqual([])
    })
  }
})

describe('channel routing behavior', () => {
```

### Step 6 (negative — no source-set literals remain)

Confirm both set declarations were converted: after steps 3-4 there must be no
`= new Set<string>([` in `routing.ts`. Do not add anything else in its place.

## Verification gates (orchestrator)

Run from the worktree root (`cd /Users/t/Projects/archive/rox-one-e01-wt`).

| # | Command | Expected |
|---|---------|----------|
| G1 | `cd /Users/t/Projects/archive/rox-one-e01-wt && bun test packages/shared/src/protocol/__tests__/routing.test.ts` | **0 fail** (was **22 pass / 2 fail** at HEAD), and includes `LOCAL_ONLY_CHANNEL_LIST contains no duplicate entries` + `REMOTE_ELIGIBLE_CHANNEL_LIST contains no duplicate entries` passing |
| G2 | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "sessions.SET_MEMORY_MODE" packages/shared/src/protocol/routing.ts` | `1` |
| G3 | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "sessions.GET_PROVENANCE" packages/shared/src/protocol/routing.ts` | `1` |
| G4 | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "notes.LIST_COMMENTS\|notes.CREATE_COMMENT\|notes.UPDATE_COMMENT\|notes.DELETE_COMMENT" packages/shared/src/protocol/routing.ts` | `4` |
| G5 (negative) | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "= new Set<string>(\[" packages/shared/src/protocol/routing.ts` | `0` |
| G6 | `cd /Users/t/Projects/archive/rox-one-e01-wt && grep -c "export const LOCAL_ONLY_CHANNEL_LIST\|export const REMOTE_ELIGIBLE_CHANNEL_LIST" packages/shared/src/protocol/routing.ts` | `2` |
| G7 | `cd /Users/t/Projects/archive/rox-one-e01-wt && cd packages/shared && bun run tsc --noEmit` | exit 0 |
| G8 | `cd /Users/t/Projects/archive/rox-one-e01-wt && git status --porcelain` | only `routing.ts` and `__tests__/routing.test.ts` modified |

G1 baseline to record before/after: at HEAD the command reports `22 pass / 2
fail`. After the plan it must report `0 fail` (the two previously-failing
assertions now pass, plus the two new invariant tests).

## Test plan

- **Modified test**: add the `describe('channel routing source lists', …)`
  block (step 5b) with one case per raw list. Structural pattern: the existing
  `describe('channel routing exhaustiveness', …)` block in the same file
  (loops over arrays of cases, plain `test(…)` + `expect`).
- **Regression proof**: the `REMOTE_ELIGIBLE_CHANNEL_LIST contains no duplicate
  entries` case fails on a naive step-5 without step 1 (the raw list would still
  hold `SET_MEMORY_MODE` twice). The exhaustiveness test's
  `every channel is classified exactly once` + `total classified equals total
  channels` cases fail without step 2 (the four unclassified channels).
- **No new file**: the test is strengthened in place, as the finding requires.
- **Verification**: G1.

## Done criteria

ALL must hold:

- [ ] `SET_MEMORY_MODE` and `GET_PROVENANCE` each appear exactly once in
      `routing.ts` (G2, G3)
- [ ] the four `notes.*Comment*` channels are present in `REMOTE_ELIGIBLE_CHANNELS`
      (G4)
- [ ] no `= new Set<string>([` remains; both raw lists are exported and the Sets
      are built from them (G5, G6)
- [ ] `routing.test.ts` has the new `channel routing source lists` block
- [ ] `bun test packages/shared/src/protocol/__tests__/routing.test.ts` → **0 fail**
- [ ] `bun run tsc --noEmit` in `packages/shared` exits 0 (G7)
- [ ] `git status` shows only the two in-scope files (G8)

## STOP conditions

Stop and report (do not improvise) if:

- The duplicate lines are not exactly `RPC_CHANNELS.sessions.SET_MEMORY_MODE,`
  followed by `RPC_CHANNELS.sessions.GET_PROVENANCE,` after
  `RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,` (the tree has drifted).
- `routing.ts:17` / `:500` no longer match the quoted set-opening lines, or the
  file no longer ends its remote set with `RPC_CHANNELS.commands.EVENT,\n])`.
- `getAllChannelValues()` no longer totals 863, or the exhaustiveness test's
  failure set is not exactly the four `notes:*Comment*` channels plus the
  `total classified` mismatch (i.e. the diagnosis has changed).
- A comment channel already appears elsewhere in `routing.ts` (would create a
  LOCAL∩REMOTE intersection).
- Making the change appears to require touching `channels.ts` or a consumer
  file.
- A reviewer tells you `advisor-plans/README.md` is theirs.

## Maintenance notes

- **New channels must be classified.** `getAllChannelValues()` drives the
  exhaustiveness test; a new channel added to `channels.ts` without a routing
  entry turns that test red — that is intended (it is how the four comment
  channels went unnoticed only because CI was not read).
- **Raw lists are the source of truth.** Future edits go into
  `LOCAL_ONLY_CHANNEL_LIST` / `REMOTE_ELIGIBLE_CHANNEL_LIST`, never directly
  into the Sets. The "no duplicate entries" invariant guards against a repeat of
  this merge artifact.
- **Reviewer should check**: the two duplicates are gone, the four comment
  channels are REMOTE_ELIGIBLE (with no LOCAL intersection), the `isLocalOnly` /
  `isRemoteEligible` helpers and their call sites are byte-identical, and only
  the two in-scope files changed.
- **Deferred (out of scope):** no CI/pretest wiring or `.github` change is made
  here; this plan only fixes the table and hardens its test.