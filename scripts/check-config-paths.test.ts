/**
 * W1-13 (#1510): grep-gate self-test — fails on a planted
 * `homedir(), '.rox'`, passes workspace-relative `.rox`.
 */
import { describe, expect, it } from 'bun:test'
import { checkFile, checkLine, scanTree, selfTest } from './check-config-paths.ts'

describe('check-config-paths self-test', () => {
  it('all fixtures behave as expected', () => {
    expect(selfTest()).toEqual([])
  })

  it('flags a planted homedir .rox in code tokens', () => {
    const line = "export const p = join(homedir(), '.rox', 'x.json')"
    expect(checkLine('src/planted.ts', line, line).length).toBeGreaterThan(0)
  })

  it('passes a workspace-relative .rox without allowlist edits', () => {
    const line = "join(workspaceRoot, '.rox', 'foreign-import-registry.json')"
    expect(checkLine('src/store.ts', line, line)).toEqual([])
  })

  it('ignores ~/.rox inside TS comments (narrative, not a path)', () => {
    expect(checkLine('src/note.ts', '// legacy ~/.rox profile', '')).toEqual([])
  })
})

describe('check-config-paths on the repo', () => {
  it('scanTree runs without crashing', () => {
    const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
    const violations = scanTree(root)
    // Informational: the real assertion is the script exit code in CI.
    expect(Array.isArray(violations)).toBe(true)
  })

  it('checkFile honors test scope', () => {
    const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
    expect(checkFile(root, 'packages/shared/src/config/__tests__/env.test.ts', [])).toEqual([])
  })
})
