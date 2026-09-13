import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const config = readFileSync(join(import.meta.dir, '..', '..', 'vite.config.ts'), 'utf8')
const playgroundHtml = readFileSync(
  join(import.meta.dir, '..', 'renderer', 'playground.html'),
  'utf8',
)

describe('electron vite worktree isolation', () => {
  it('resolves @craft-agent packages from this checkout via package.json exports', () => {
    expect(config).toContain('function worktreeCraftPackagePlugin')
    expect(config).toContain('worktreeCraftPackagePlugin()')
    expect(config).toContain("'@craft-agent/shared'")
    expect(config).toContain("exclude: ['@craft-agent/ui', '@craft-agent/shared', '@craft-agent/core'")
  })

  it('lets the playground bind on 127.0.0.1 without a missing process global', () => {
    expect(playgroundHtml).toContain('ws://127.0.0.1:*')
    expect(playgroundHtml).toContain('globalThis.process')
  })
})
