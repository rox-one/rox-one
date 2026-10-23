import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('WorkspaceNavigator', () => {
  const source = readFileSync(join(import.meta.dir, '../WorkspaceNavigator.tsx'), 'utf8')

  it('renders compact hover card and detailed diff stats', () => {
    expect(source).toContain('data-testid="workspace-navigator"')
    expect(source).toContain('WorktreeHoverCard')
    expect(source).toContain("layout === 'detailed'")
  })

  it('gates compact WorktreeHoverCard behind WORKTREE_HOVER_DELAY_MS (200–300)', () => {
    expect(source).toContain('export const WORKTREE_HOVER_DELAY_MS = 250')
    expect(source).toMatch(/setTimeout\([^,]+,\s*WORKTREE_HOVER_DELAY_MS\)/)
    expect(source).toContain('scheduleHover')
    expect(source).toContain('clearHover')
    // Must not open the card synchronously on mouse enter.
    expect(source).not.toMatch(/onMouseEnter=\{\(\) => layout === 'compact' && setHoverBranchId\(/)
  })

  it('uses SE icons v2 extract for workspace glyphs', () => {
    expect(source).toContain("from '@rox/ui/icons/se'")
    expect(source).not.toMatch(/from 'lucide-react'/)
  })
})
