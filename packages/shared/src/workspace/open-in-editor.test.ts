import { describe, expect, it } from 'bun:test'
import {
  EDITOR_BINARIES,
  isForbiddenEditorLaunch,
  launchWorkspaceInEditor,
  lookupBinaryOnPath,
  resolveEditorLaunch,
} from './open-in-editor.ts'

describe('isForbiddenEditorLaunch', () => {
  it('rejects Terminal.app and open -a Terminal', () => {
    expect(isForbiddenEditorLaunch('open', ['-a', 'Terminal'])).toBe(true)
    expect(isForbiddenEditorLaunch('open', ['-a', 'Terminal.app', '/tmp'])).toBe(true)
    expect(isForbiddenEditorLaunch('/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal', ['/tmp'])).toBe(true)
    expect(isForbiddenEditorLaunch('/opt/homebrew/bin/cmux', ['/tmp/ws'])).toBe(false)
    expect(isForbiddenEditorLaunch('/usr/local/bin/code', ['/tmp/ws'])).toBe(false)
  })
})

describe('lookupBinaryOnPath / resolveEditorLaunch', () => {
  it('prefers cmux over later PATH editors and never selects Terminal', () => {
    const files = new Set([
      '/opt/homebrew/bin/cmux',
      '/usr/local/bin/code',
      '/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
    ])
    const lookup = (bin: string) =>
      lookupBinaryOnPath(bin, {
        pathEnv: '/opt/homebrew/bin:/usr/local/bin:/Applications/Utilities/Terminal.app/Contents/MacOS',
        exists: (p) => files.has(p),
        pathSep: '/',
        delimiter: ':',
      })

    const resolved = resolveEditorLaunch({ dirPath: '/tmp/ws', lookup })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.plan.editor).toBe('cmux')
      expect(resolved.plan.command).toBe('/opt/homebrew/bin/cmux')
      expect(resolved.plan.args).toEqual(['/tmp/ws'])
      expect(isForbiddenEditorLaunch(resolved.plan.command, resolved.plan.args)).toBe(false)
    }
  })

  it('walks the candidate list when earlier binaries are missing', () => {
    const files = new Set(['/usr/bin/zed'])
    const lookup = (bin: string) =>
      lookupBinaryOnPath(bin, {
        pathEnv: '/usr/bin',
        exists: (p) => files.has(p),
        pathSep: '/',
        delimiter: ':',
      })
    const resolved = resolveEditorLaunch({ dirPath: '/repo', lookup })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.plan.editor).toBe('zed')
  })

  it('returns no-editor rather than spawning Terminal', () => {
    const lookup = () => '/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'
    const spawned: Array<{ command: string; args: string[] }> = []
    const result = launchWorkspaceInEditor('/tmp/ws', {
      lookup,
      spawn: (command, args) => {
        spawned.push({ command, args })
      },
    })
    expect(result.opened).toBe(false)
    expect(result.reason).toBe('no-editor')
    expect(spawned).toEqual([])
  })
})

describe('EDITOR_BINARIES', () => {
  it('is cmux then cursor, code, zed — never Terminal', () => {
    expect([...EDITOR_BINARIES]).toEqual(['cmux', 'cursor', 'code', 'zed'])
    expect(EDITOR_BINARIES.join(' ')).not.toMatch(/terminal/i)
  })
})
