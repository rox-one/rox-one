import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('WorkspaceNavigator', () => {
  it('renders compact hover card and detailed diff stats', () => {
    const source = readFileSync(join(import.meta.dir, '../WorkspaceNavigator.tsx'), 'utf8')
    expect(source).toContain('data-testid="workspace-navigator"')
    expect(source).toContain('WorktreeHoverCard')
    expect(source).toContain("layout === 'detailed'")
  })
})
