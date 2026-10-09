/**
 * Dream-runtime wiring regression.
 *
 * Defect: `startMemoryRepoRuntime` passed a bare workspace id
 * (`bankWorkspaceId(bankId)`) to `SessionManager.getMemoryServiceForBank`,
 * which only resolves `ws:<workspaceId>[#<owner8>]`. Every dream therefore
 * logged "no memory service for bank" and steps 1 (`whenIdle()` distillation
 * drain) and 4 (`runDecayJob()`) never ran.
 *
 * This drives the REAL runtime bootstrap with a fake SessionManager-shaped
 * accessor that records every argument it receives, then runs one dream per
 * bank through the wired scheduler and asserts the exact full bank id reaches
 * the accessor (`main` included — the accessor itself owns the `main` → null
 * decision).
 */
import '../memory-test-setup' // must run before any module reading the config dir
import { afterAll, describe, expect, it, spyOn, vi } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { RpcServer } from '@rox/server-core/transport'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { MemoryDreamEvent, MemoryDreamRun } from '@rox/shared/memory/repo'
import { handleMemoryRepoRead, type SessionToolContext } from '@rox/session-tools-core'
import type { HandlerDeps } from '../../handler-deps'
import { getMemoryRepoRuntime, registerMemoryRepoHandlers, startMemoryRepoRuntime } from '../memory-repo'
import { notifyRepoMutation } from '../../../memory/repo/notify'

const configDir = mkdtempSync(join(tmpdir(), 'dream-runtime-wiring-'))

/** Shutdown hooks registered by `startMemoryRepoRuntime` on the fake transport. */
const shutdownHooks: Array<() => void> = []

/** Every broadcast the runtime pushed through the fake transport. */
interface RecordedPush {
  channel: string
  target: unknown
  args: unknown[]
}
const pushes: RecordedPush[] = []

const server: RpcServer = {
  handle() {},
  push(channel: string, target: unknown, ...args: unknown[]) {
    pushes.push({ channel, target, args })
  },
  async invokeClient() {
    return undefined
  },
  hasClientCapability() {
    return false
  },
  findClientsWithCapability() {
    return []
  },
  isRequestContextCurrent: () => true,
  onShutdown(dispose: () => void) {
    shutdownHooks.push(dispose)
    return () => {
      const at = shutdownHooks.indexOf(dispose)
      if (at >= 0) shutdownHooks.splice(at, 1)
    }
  },
} as unknown as RpcServer

/** Every argument the runtime hands to the bank accessor, in order. */
const recorded: string[] = []

/** Workspaces the fake session manager reports; the notes test appends one. */
const workspaces: Array<{ id: string; name: string; rootPath: string }> = []

const dreamDeps = {
  sessionManager: {
    getWorkspaces: () => workspaces,
    runDistillOneShot: async () => '',
    getMemoryServiceForBank: (bankId: string) => {
      recorded.push(bankId)
      return null
    },
  },
  oauthFlowStore: {},
  platform: {},
} as unknown as HandlerDeps

// Pre-seed the process-wide `main` journal BEFORE bootstrap: hydration must
// restore this prior run, otherwise a restart re-runs every bank and the Dreams
// panel reports "never dreamed". Timestamps are relative so the assertion is
// stable regardless of the wall-clock date.
const seededDreamId = 'restart-dream'
const seededStartedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
const seededEndedAt = new Date(Date.now() - 30 * 60 * 1000 + 5_000).toISOString()
mkdirSync(join(configDir, 'memory'), { recursive: true })
writeFileSync(
  join(configDir, 'memory', 'dream-log.jsonl'),
  (
    [
      { ts: seededStartedAt, dreamId: seededDreamId, bankId: 'main', kind: 'start', message: 'dream started (interval)', model: 'gpt-4o-mini' },
      { ts: seededEndedAt, dreamId: seededDreamId, bankId: 'main', kind: 'end', message: 'dream ok' },
    ] as MemoryDreamEvent[]
  )
    .map((event) => `${JSON.stringify(event)}\n`)
    .join(''),
  'utf-8',
)

const runtime = startMemoryRepoRuntime({ server, deps: dreamDeps, configDir })
// No interval timer needed; `runNow` works while the scheduler is stopped.
runtime.scheduler.stop()

// The memory_repo_* session tools are published by `registerMemoryRepoHandlers`
// (not by `startMemoryRepoRuntime`); register them so the adapter test drives the
// REAL runtime the RPC layer installs.
registerMemoryRepoHandlers(server, dreamDeps)

afterAll(() => {
  getMemoryRepoRuntime()?.scheduler.stop()
  rmSync(configDir, { recursive: true, force: true })
})

describe('dream journal hydration across restart', () => {
  it('restores the main bank last run from the pre-seeded journal', async () => {
    const status = await runtime.scheduler.status('main')
    expect(status.lastRun).not.toBeNull()
    expect(status.lastRun?.dreamId).toBe(seededDreamId)
    expect(status.lastRun?.status).toBe('ok')
    expect(status.lastRun?.startedAt).toBe(seededStartedAt)
    expect(status.lastRun?.endedAt).toBe(seededEndedAt)
    expect(status.lastRun?.model).toBe('gpt-4o-mini')
    // `nextRunAt` is only set when `lastRunAt` was hydrated from the journal.
    expect(status.nextRunAt).not.toBeNull()
  })
})

describe('dream runtime memory-service wiring', () => {
  it('passes the full bank id (owner suffix intact) to getMemoryServiceForBank', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111'
    const ownerBankId = `ws:${workspaceId}#deadbeef`

    await runtime.scheduler.runNow(`ws:${workspaceId}`)
    await runtime.scheduler.runNow(ownerBankId)
    await runtime.scheduler.runNow('main')

    expect(recorded).toEqual([`ws:${workspaceId}`, ownerBankId, 'main'])
  })

  it('resolves pending notes from the workspace notesPath (Notes UI root), per bank', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222'
    const root = mkdtempSync(join(tmpdir(), 'dream-wiring-ws-'))
    const customNotes = join(root, 'custom-notes')
    mkdirSync(join(customNotes, 'sub'), { recursive: true })
    writeFileSync(join(customNotes, 'two.md'), '# Two\n')
    writeFileSync(join(customNotes, 'sub', 'one.md'), 'one\n')
    writeFileSync(join(root, 'config.json'), JSON.stringify({ name: 'ws', notesPath: customNotes }))
    workspaces.push({ id: workspaceId, name: 'ws', rootPath: root })

    const status = await runtime.scheduler.status(`ws:${workspaceId}#cafebabe`)
    expect(status.pendingNoteIds).toEqual(['sub/one', 'two'])

    // The Notes screen of another bank (no workspace root) never sees them.
    const mainStatus = await runtime.scheduler.status('main')
    expect(mainStatus.pendingNoteIds).toEqual([])

    workspaces.pop()
    rmSync(root, { recursive: true, force: true })
  })
})

describe('dream runtime push wiring', () => {
  it('pushes exactly one memory:repoChanged when a mutation batch settles', async () => {
    pushes.length = 0
    // `notifyMutation` debounces before materializing; drive the debounce with
    // fake timers and await the settled batch itself (never a wall-clock sleep).
    vi.useFakeTimers()
    try {
      const settled = Promise.withResolvers<void>()
      const off = runtime.service.onMaterialized(() => settled.resolve())
      try {
        runtime.service.notifyMutation({ scope: 'main' }, 'wiring-test')
        vi.advanceTimersByTime(10_000)
        await settled.promise
      } finally {
        off()
      }
    } finally {
      vi.useRealTimers()
    }
    const changed = pushes.filter((push) => push.channel === RPC_CHANNELS.memory.REPO_CHANGED)
    expect(changed).toHaveLength(1)
    expect(changed[0]!.args).toEqual(['main', 'wiring-test'])
  })

  it('pushes the dreamEvent sequence and exactly one dreamDone for the finished run', async () => {
    // The harness stops the scheduler after bootstrap (no interval timer);
    // re-attach the runner→scheduler forwarding so dream events flow again.
    runtime.scheduler.start()
    pushes.length = 0
    const run = await runtime.scheduler.runNow('main')

    const events = pushes
      .filter((push) => push.channel === RPC_CHANNELS.memory.DREAM_EVENT)
      .map((push) => push.args[0] as MemoryDreamEvent)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.dreamId === run.dreamId)).toBe(true)
    expect(events[events.length - 1]!.kind).toBe('end')

    const done = pushes.filter((push) => push.channel === RPC_CHANNELS.memory.DREAM_DONE)
    expect(done).toHaveLength(1)
    expect((done[0]!.args[0] as MemoryDreamRun).dreamId).toBe(run.dreamId)
    // The push is present by the time `runNow` resolves (no setTimeout involved)
    // and carries exactly the run the scheduler recorded.
    expect((await runtime.scheduler.status('main')).lastRun?.dreamId).toBe(run.dreamId)
  })

  it("pushes exactly one dreamDone for a bank's first run", async () => {
    runtime.scheduler.start()
    const bankId = 'ws:33333333-3333-4333-8333-333333333333'
    // No prior run recorded: the R8-1 case where the old 0 ms timer could drop
    // the push entirely.
    expect((await runtime.scheduler.status(bankId)).lastRun).toBeNull()

    pushes.length = 0
    const run = await runtime.scheduler.runNow(bankId)
    const done = pushes.filter(
      (push) => push.channel === RPC_CHANNELS.memory.DREAM_DONE && (push.args[0] as MemoryDreamRun).bankId === bankId,
    )
    expect(done).toHaveLength(1)
    expect((done[0]!.args[0] as MemoryDreamRun).dreamId).toBe(run.dreamId)
  })
})

describe('memory-repo session tool adapter', () => {
  it("reads MEMORY.md for the session's own workspace bank", async () => {
    const workspaceId = '44444444-4444-4444-8444-444444444444'
    const root = mkdtempSync(join(tmpdir(), 'dream-tool-ws-'))
    workspaces.push({ id: workspaceId, name: 'tool-ws', rootPath: root })
    try {
      await runtime.service.materialize(`ws:${workspaceId}`, 'test-seed')
      const ctx = { workspacePath: root } as unknown as SessionToolContext
      const result = await handleMemoryRepoRead(ctx, { path: 'MEMORY.md', bank: `ws:${workspaceId}` })
      expect(result.isError).toBe(false)
      const text = result.content?.[0]?.text ?? ''
      expect(text).toContain('## Memory repository file: MEMORY.md')
      expect(text).toContain(`_bank: ws:${workspaceId}_`)
    } finally {
      workspaces.pop()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("refuses a bank outside the session's own workspace + main", async () => {
    const ownId = '55555555-5555-4555-8555-555555555555'
    const otherId = '66666666-6666-4666-8666-666666666666'
    const ownRoot = mkdtempSync(join(tmpdir(), 'dream-tool-own-'))
    const otherRoot = mkdtempSync(join(tmpdir(), 'dream-tool-other-'))
    workspaces.push({ id: ownId, name: 'own-ws', rootPath: ownRoot })
    workspaces.push({ id: otherId, name: 'other-ws', rootPath: otherRoot })
    try {
      const ctx = { workspacePath: ownRoot } as unknown as SessionToolContext
      const result = await handleMemoryRepoRead(ctx, { path: 'MEMORY.md', bank: `ws:${otherId}` })
      expect(result.isError).toBe(true)
      const text = result.content?.[0]?.text ?? ''
      expect(text).toContain('MEMORY_REPO_BANK_NOT_FOUND')
      // The other workspace's bank EXISTS (it is in `listBanks`); the refusal is
      // the session-scope filter, not an empty repository.
      expect(text).toContain(`no memory bank "ws:${otherId}"`)
    } finally {
      workspaces.pop()
      workspaces.pop()
      rmSync(ownRoot, { recursive: true, force: true })
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })
})

describe('runtime disposal with the transport', () => {
  it('disposes the scheduler, service and notifier from the shutdown hook', () => {
    expect(shutdownHooks).toHaveLength(1)

    const stop = spyOn(runtime.scheduler, 'stop')
    const dispose = spyOn(runtime.service, 'dispose')
    const notify = spyOn(runtime.service, 'notifyMutation')

    // Before shutdown the process-wide A2 seam reaches the service.
    notifyRepoMutation({ scope: 'main' }, 'pre-shutdown')
    expect(notify).toHaveBeenCalledTimes(1)

    for (const hook of [...shutdownHooks]) hook()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    // The runtime singleton is cleared and the notifier detached: a later
    // mutation is a silent no-op instead of a debounce against a dead transport.
    expect(getMemoryRepoRuntime()).toBeNull()
    notifyRepoMutation({ scope: 'main' }, 'post-shutdown')
    expect(notify).toHaveBeenCalledTimes(1)
  })
})