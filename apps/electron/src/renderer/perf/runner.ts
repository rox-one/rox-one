import { createLargeVaultFixture, createSessionFixture } from './fixtures'
import { IpcCallCounter } from './ipc-counter'
import { evaluateAll, mergeIpc } from './evaluate'
import { profileBundleInventory, profileMinifyHang } from './bundle-profile'
import {
  pickSwitchTargets,
  switchCachedSession,
  warmRendererCache,
} from './switch-sim'
import {
  simulateBrowserChrome,
  simulateCanvasLayout,
  simulateColdReady,
  simulateDropdownOpen,
  simulateNotesOpen,
  simulateViewSwitch,
} from './surface-sim'
import { PerfTelemetry } from './telemetry'
import type { BenchmarkReport, BenchmarkSample } from './types'

export interface RunHarnessOptions {
  sessionCount?: 500 | 2000
  switchIterations?: number
  includeBundleProfile?: boolean
}

export function runPerfHarness(options: RunHarnessOptions = {}): BenchmarkReport {
  const sessionCount = options.sessionCount ?? 2000
  const switchIterations = options.switchIterations ?? 40
  const sessionFixture = createSessionFixture(sessionCount)
  const vault = createLargeVaultFixture()
  const ipc = new IpcCallCounter()
  const telemetry = new PerfTelemetry()
  const samples: BenchmarkSample[] = []

  const cold = simulateColdReady(sessionFixture.sessions, ipc)
  samples.push({
    name: cold.name,
    durationMs: cold.durationMs,
    ipc: { 'sessions.list': 1 },
    reloadedCollection: cold.reloadedCollection,
  })

  const cache = warmRendererCache(sessionFixture.sessions)
  const targets = pickSwitchTargets(cache, switchIterations)
  for (const sessionId of targets) {
    const result = switchCachedSession(cache, sessionId, ipc)
    samples.push({
      name: 'cached_session_switch',
      durationMs: result.durationMs,
      ipc: result.ipc,
      reloadedCollection: result.reloadedCollection,
    })
  }

  for (const view of ['list', 'table', 'kanban', 'heatmap'] as const) {
    const timing = simulateViewSwitch(sessionFixture.sessions, view)
    samples.push({
      name: timing.name,
      durationMs: timing.durationMs,
      ipc: {},
      reloadedCollection: timing.reloadedCollection,
    })
  }

  const notes = simulateNotesOpen(vault.notes)
  samples.push({
    name: notes.name,
    durationMs: notes.durationMs,
    ipc: {},
    reloadedCollection: notes.reloadedCollection,
  })

  const browser = simulateBrowserChrome()
  samples.push({
    name: browser.name,
    durationMs: browser.durationMs,
    ipc: {},
    reloadedCollection: browser.reloadedCollection,
  })

  const menuItems = sessionFixture.sessions.slice(0, 200).map((session) => ({
    id: session.id,
    name: session.name,
  }))
  const dropdown = simulateDropdownOpen(menuItems, 'session 1')
  samples.push({
    name: dropdown.name,
    durationMs: dropdown.durationMs,
    ipc: {},
    reloadedCollection: dropdown.reloadedCollection,
  })

  const canvas = simulateCanvasLayout()
  samples.push({
    name: canvas.name,
    durationMs: canvas.durationMs,
    ipc: {},
    reloadedCollection: canvas.reloadedCollection,
  })

  telemetry.recordLongTask(8)
  telemetry.recordReactCommit(3)
  telemetry.recordPayload({
    sessionId: 'sess-00001',
    authorization: 'Bearer sk-live-exampletokenvalue',
    preview: 'ok',
  })

  let bundleProfileMs: number | null = null
  if (options.includeBundleProfile) {
    const bundle = profileBundleInventory(
      sessionFixture.sessions.map((session) => `${session.id}.tsx`),
    )
    const minify = profileMinifyHang(2_000, 2)
    bundleProfileMs = bundle.durationMs + minify.durationMs
  }

  const { stats, verdicts } = evaluateAll(samples)
  return {
    generatedAt: new Date().toISOString(),
    fixture: {
      sessionCount: sessionFixture.count,
      vaultNoteCount: vault.count,
    },
    stats,
    verdicts,
    ipcTotals: mergeIpc(samples),
    longTasks: telemetry.longTasks.length,
    reactCommits: telemetry.reactCommits.length,
    payloadSamples: telemetry.payloads.length,
    bundleProfileMs,
  }
}
