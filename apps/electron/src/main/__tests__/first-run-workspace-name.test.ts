import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mainSrc = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')

describe('first-run workspace name', () => {
  it('names the default workspace after the machine, not the profile display name', () => {
    expect(mainSrc).toContain('resolveWorkspaceMachineName')
    expect(mainSrc).not.toContain('resolveUserDisplayName')
    expect(mainSrc).toContain('name: workspaceName')
  })
})
