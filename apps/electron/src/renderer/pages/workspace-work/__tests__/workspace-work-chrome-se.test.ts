import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const files = ['WorkspacePlanView.tsx', 'WorkspaceTasksView.tsx', 'AgentProfilesView.tsx']

describe('P6 workspace-work chrome (SE surface fills)', () => {
  it('uses surface-hover, not foreground-alpha fills', () => {
    for (const name of files) {
      const src = readFileSync(join(import.meta.dir, '..', name), 'utf8')
      expect(src.includes('bg-foreground/['), `${name} still has bg-foreground/[`).toBe(false)
      expect(src.includes('hover:bg-foreground/['), `${name} still has hover fg`).toBe(false)
    }
    const plan = readFileSync(join(import.meta.dir, '../WorkspacePlanView.tsx'), 'utf8')
    expect(plan).toContain('hover:bg-surface-hover')
  })
})
