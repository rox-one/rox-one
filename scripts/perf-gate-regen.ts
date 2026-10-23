#!/usr/bin/env bun
/**
 * One-shot regen for the Renderer bundle-size / boot-manifest gate.
 *
 * CI fails when either:
 *   - `perf-baselines/bundle-size.json` is behind a real renderer build, or
 *   - `apps/electron/src/renderer/boot-manifest.json` is STALE vs that build.
 *
 * Both need the same production renderer with source maps. Running the two
 * writers separately is how the gate drifts after other merges — this script
 * is the single command every failure message points at:
 *
 *   bun run perf:gate:regen
 *
 * Steps (fail-fast):
 *   1. `bun run electron:build:renderer` with ROX_RENDERER_SOURCEMAP=1
 *   2. rewrite apps/electron/src/renderer/boot-manifest.json
 *   3. re-record perf-baselines/bundle-size.json
 *
 * Owner-approved growth is accepted by step 3; review the diff before merging.
 */

import { spawn } from 'bun'
import { join } from 'path'

export const PERF_GATE_REGEN_CMD = 'bun run perf:gate:regen'

const ROOT = join(import.meta.dir, '..')

async function run(label: string, cmd: string[], env?: Record<string, string | undefined>): Promise<void> {
  console.log(`[perf:gate:regen] ${label}: ${cmd.join(' ')}`)
  const proc = spawn({
    cmd,
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`[perf:gate:regen] ${label} failed (exit ${code})`)
  }
}

export async function regenPerfGate(): Promise<void> {
  await run('build renderer (sourcemaps on)', ['bun', 'run', 'electron:build:renderer'], {
    NODE_OPTIONS: '--max-old-space-size=8192',
    ROX_RENDERER_SOURCEMAP: '1',
  })
  // Write mode (no --check): derives and commits the boot sources / routes.
  await run('rewrite boot-manifest.json', ['bun', 'run', 'scripts/boot-manifest.ts'])
  await run('re-record bundle-size baseline', ['bun', 'scripts/check-bundle-size.ts', '--update'])
  console.log(
    `[perf:gate:regen] done. Review and commit:\n` +
      `  - apps/electron/src/renderer/boot-manifest.json\n` +
      `  - perf-baselines/bundle-size.json`,
  )
}

if (import.meta.main) {
  regenPerfGate().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
