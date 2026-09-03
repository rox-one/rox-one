import {
  clearIpcCalls,
  detectSessionIpcNPlusOne,
  estimateJsonBytes,
  recordIpcInvoke,
  snapshotIpcCalls,
} from './ipc-counter'
import {
  createLargeVaultFixture,
  createSessionFixture,
  lookupCachedSession,
  warmSessionCache,
  type FixtureSessionMeta,
} from './fixtures'
import { clearInteractions, endInteraction, startInteraction } from './marks'
import { recordPayloadBytes, resetTelemetry, snapshotTelemetry } from './telemetry'
import { createSyntheticBundleSteps, profileBundleSteps } from './bundle-profile'
import { evaluateBundle, evaluateSamples } from './budgets'
import { formatBenchmarkReport } from './report'
import type { BenchmarkReport, BenchmarkRun, InteractionKind, InteractionSample } from './types'
import { simulatePremiumMenuOpen } from '@craft-agent/ui/premium-menu'

export interface HarnessOptions {
  iterations?: number
  includeBundle?: boolean
}

function sampleFromPending(
  kind: InteractionKind,
  durationMs: number,
  sessionCount: number,
  ipcBefore: ReturnType<typeof snapshotIpcCalls>,
  messagesAlreadyCached: boolean,
  allowCollectionGet: boolean,
): InteractionSample {
  const ipc = (() => {
    const after = snapshotIpcCalls()
    const delta: InteractionSample['ipc'] = {}
    for (const channel of new Set([...Object.keys(ipcBefore), ...Object.keys(after)])) {
      const count = (after[channel]?.count ?? 0) - (ipcBefore[channel]?.count ?? 0)
      const totalResultBytes = (after[channel]?.totalResultBytes ?? 0) - (ipcBefore[channel]?.totalResultBytes ?? 0)
      if (count || totalResultBytes) delta[channel] = { channel, count, totalResultBytes }
    }
    return delta
  })()
  const nPlusOne = detectSessionIpcNPlusOne(ipc, sessionCount, {
    allowCollectionGet,
    messagesAlreadyCached,
  })
  const tel = snapshotTelemetry()
  return {
    kind,
    durationMs,
    marks: [],
    collectionReload: (ipc['sessions:get']?.count ?? 0) > 0 && !allowCollectionGet,
    ipc,
    nPlusOne,
    longTaskCount: tel.longTaskCount,
    reactCommitMs: tel.reactCommitMs,
    payloadBytes: tel.payloadBytes,
  }
}

function runCachedSwitch(
  cache: Map<string, FixtureSessionMeta>,
  fromId: string,
  toId: string,
  sessionCount: number,
): InteractionSample {
  const ipcBefore = snapshotIpcCalls()
  startInteraction('cached-session-switch')
  const hit = lookupCachedSession(cache, toId)
  if (!hit) {
    recordIpcInvoke('sessions:get', 0)
  } else {
    void fromId
    void hit.preview
  }
  const durationMs = endInteraction('cached-session-switch') ?? 0
  return sampleFromPending('cached-session-switch', durationMs, sessionCount, ipcBefore, true, false)
}

function runColdReady(sessions: FixtureSessionMeta[]): InteractionSample {
  const ipcBefore = snapshotIpcCalls()
  startInteraction('cold-ready')
  recordIpcInvoke('sessions:get', estimateJsonBytes(sessions.map(({ id, name, workspaceId, lastMessageAt, messageCount, permissionMode }) => ({
    id, name, workspaceId, lastMessageAt, messageCount, permissionMode, messages: [],
  }))))
  recordPayloadBytes(estimateJsonBytes(sessions))
  const durationMs = endInteraction('cold-ready') ?? 0
  return sampleFromPending('cold-ready', durationMs, sessions.length, ipcBefore, false, true)
}

function runDropdownOpen(sessionCount: number): InteractionSample {
  const ipcBefore = snapshotIpcCalls()
  startInteraction('dropdown-open')
  simulatePremiumMenuOpen(1000, 42)
  const durationMs = endInteraction('dropdown-open') ?? 0
  return sampleFromPending('dropdown-open', durationMs, sessionCount, ipcBefore, true, false)
}

function runCheap(kind: Exclude<InteractionKind, 'cached-session-switch' | 'cold-ready' | 'dropdown-open'>, sessionCount: number): InteractionSample {
  const ipcBefore = snapshotIpcCalls()
  startInteraction(kind)
  const durationMs = endInteraction(kind) ?? 0
  return sampleFromPending(kind, durationMs, sessionCount, ipcBefore, true, false)
}

function runNotesOpen(noteCount: number, sessionCount: number): InteractionSample {
  const ipcBefore = snapshotIpcCalls()
  startInteraction('notes-open')
  let acc = 0
  for (let i = 0; i < Math.min(noteCount, 64); i += 1) acc += i
  void acc
  const durationMs = endInteraction('notes-open') ?? 0
  return sampleFromPending('notes-open', durationMs, sessionCount, ipcBefore, true, false)
}

export async function runBenchmark(opts: HarnessOptions = {}): Promise<BenchmarkReport> {
  const iterations = opts.iterations ?? 40
  const includeBundle = opts.includeBundle ?? true

  clearIpcCalls()
  resetTelemetry()
  clearInteractions()

  const small = createSessionFixture(500)
  const large = createSessionFixture(2000)
  const vault = createLargeVaultFixture(2000)
  const cache = warmSessionCache(large.sessions)

  const smallSamples: InteractionSample[] = [runColdReady(small.sessions)]
  const largeSamples: InteractionSample[] = []
  for (let i = 0; i < iterations; i += 1) {
    const from = large.sessions[i % large.sessions.length]!
    const to = large.sessions[(i + 17) % large.sessions.length]!
    largeSamples.push(runCachedSwitch(cache, from.id, to.id, large.sessions.length))
  }
  for (const kind of ['view-switch', 'browser-chrome', 'canvas-layout'] as const) {
    largeSamples.push(runCheap(kind, large.sessions.length))
  }
  largeSamples.push(runDropdownOpen(large.sessions.length))

  const vaultSamples: InteractionSample[] = [runNotesOpen(vault.notes.length, large.sessions.length)]

  const bundle = includeBundle
    ? await profileBundleSteps(createSyntheticBundleSteps())
    : { durationMs: 0, hung: false, steps: [] }

  const runs: BenchmarkRun[] = [
    {
      fixture: 'sessions-500',
      sessionCount: small.sessions.length,
      noteCount: 0,
      samples: smallSamples,
      bundle: { durationMs: 0, hung: false },
    },
    {
      fixture: 'sessions-2000',
      sessionCount: large.sessions.length,
      noteCount: 0,
      samples: largeSamples,
      bundle: { durationMs: bundle.durationMs, hung: bundle.hung },
    },
    {
      fixture: 'large-vault',
      sessionCount: 0,
      noteCount: vault.notes.length,
      samples: vaultSamples,
      bundle: { durationMs: 0, hung: false },
    },
  ]

  const samples = runs.flatMap((run) => run.samples)
  const violations = [
    ...evaluateSamples(samples),
    ...(includeBundle ? evaluateBundle(bundle.durationMs, bundle.hung) : []),
  ]

  return {
    generatedAt: new Date().toISOString(),
    runs,
    violations,
    passed: violations.length === 0,
  }
}

export async function runBenchmarkAndFormat(opts: HarnessOptions = {}): Promise<{ report: BenchmarkReport; text: string }> {
  const report = await runBenchmark(opts)
  return { report, text: formatBenchmarkReport(report) }
}
