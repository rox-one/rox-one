#!/usr/bin/env bun
/**
 * PERF-09 (#1576) surface revisit bench (happy-dom, mocked RPC latency).
 *
 * Mounts the real `useWorkspaceWork` hook (Tasks / Plan / Agents surfaces)
 * against an electronAPI whose read takes `--latency` ms, and reports per
 * visit: time until a snapshot is painted and how many reads were issued.
 * Visit 1 is cold; later visits are revisits within the stale-while-
 * revalidate window (no read). One case ages the entry past the window: it
 * still paints from cache and issues one background read. A last case mounts
 * two views at once (e.g. Tasks + the auxiliary panel).
 *
 *   bun scripts/bench/surface-revisit-bench.tsx [--latency 60] [--visits 3]
 *
 * Simulation only: absolute numbers depend on the latency you pass; the RPC
 * counts and the cold/revisit ratio are what this compares.
 */
import { installDom } from '../../packages/ui/src/components/primitives/__tests__/dom-env'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { emptyWorkspaceWorkState } from '@rox/shared/workspace-work'
import { useWorkspaceWork } from '../../apps/electron/src/renderer/lib/useWorkspaceWork'
import { ROX_REVALIDATE_AFTER_MS, roxQueryClient } from '../../apps/electron/src/renderer/lib/query/client'
import { roxKeys } from '../../apps/electron/src/renderer/lib/query/keys'

installDom()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? Number(process.argv[index + 1]) : fallback
}
const latency = arg('latency', 60)
const visits = arg('visits', 3)
let reads = 0

;(window as unknown as { electronAPI: unknown }).electronAPI = {
  workspaceWorkRead: async (workspaceId: string) => {
    reads++
    await new Promise(resolve => setTimeout(resolve, latency))
    return { ...emptyWorkspaceWorkState(workspaceId), revision: 1, access: { actorId: 'o', canWrite: true, canDelete: true, canManage: true }, members: [], conflicts: [] }
  },
  workspaceWorkWrite: async () => { throw new Error('unused') },
  workspaceWorkDelete: async () => { throw new Error('unused') },
  workspaceWorkSnapshotProfile: async () => null,
  onWorkspaceWorkChanged: () => () => {},
}

async function visit(views: number, workspaceId = 'ws'): Promise<{ paintMs: number; reads: number }> {
  const before = reads
  const start = performance.now()
  let painted = -1
  function View() {
    const { snapshot } = useWorkspaceWork(workspaceId)
    if (snapshot && painted < 0) painted = performance.now() - start
    return null
  }
  const root = createRoot(document.createElement('div'))
  flushSync(() => { root.render(<>{Array.from({ length: views }, (_, i) => <View key={i} />)}</>) })
  const deadline = performance.now() + latency * 10 + 1_000
  while (painted < 0 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1))
  await new Promise(resolve => setTimeout(resolve, latency + 20))
  root.unmount()
  return { paintMs: Math.round(painted * 10) / 10, reads: reads - before }
}

// Warm the module/JIT so visit 1 measures the data path, not compilation.
await visit(1, "warmup")
reads = 0
const results: Array<{ visit: string; paintMs: number; reads: number }> = []
for (let i = 1; i <= visits; i++) results.push({ visit: i === 1 ? 'cold' : `revisit ${i - 1}`, ...await visit(1) })
const key = roxKeys.workspaceWork('ws')
roxQueryClient().setQueryData(key, roxQueryClient().getQueryData(key), { updatedAt: Date.now() - ROX_REVALIDATE_AFTER_MS - 1 })
results.push({ visit: 'revisit after the 10 s window (paint from cache + background read)', ...await visit(1) })
results.push({ visit: 'two views at once (revisit)', ...await visit(2) })
results.push({ visit: 'two views at once (cold, other workspace)', ...await visit(2, 'ws-2') })
console.log(JSON.stringify({ latencyMs: latency, results }, null, 2))
process.exit(0)
