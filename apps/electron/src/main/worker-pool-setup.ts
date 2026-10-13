/**
 * Shared worker pool wiring (ADR-0024).
 *
 * Call after `app` is ready: the low-power decision reads Chromium's GPU
 * status. `pool-worker.cjs` sits next to main.cjs in dist/; when it is missing
 * the pool runs tasks inline.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { configureWorkerPool } from '@rox/shared/workers'
import { peekRenderProfile } from './render-profile'
import type { ShellPlatform } from '../shared/shell-appearance'

function currentPlatform(): ShellPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') {
    return process.platform
  }
  return 'linux'
}

export function setupWorkerPool(): void {
  const script = join(__dirname, 'pool-worker.cjs')
  configureWorkerPool({
    script: existsSync(script) ? script : undefined,
    lowPower: peekRenderProfile(currentPlatform()).profile === 'performance',
  })
}
