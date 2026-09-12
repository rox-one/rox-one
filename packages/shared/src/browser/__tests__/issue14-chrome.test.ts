import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const omp = readFileSync(join(import.meta.dir, '../../agent/omp-agent.ts'), 'utf8')
const toolbar = readFileSync(
  join(import.meta.dir, '../../../../../apps/electron/src/renderer/browser-toolbar.tsx'),
  'utf8',
)

describe('Issue 14 agent and toolbar chrome', () => {
  it('tells OMP to use the host browser without forcing every URL', () => {
    expect(omp).toContain('Safe http/https links belong in the host browser pane')
    expect(omp).toContain('Do not force every URL open')
  })

  it('exposes profile, inspect, history and downloads in toolbar chrome', () => {
    expect(toolbar).toContain("t('browser.profile')")
    expect(toolbar).toContain("t('browser.inspect')")
    expect(toolbar).toContain('listHistory')
    expect(toolbar).toContain('listDownloads')
    expect(toolbar).toContain('openDevTools')
  })
})
