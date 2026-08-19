import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Gap-4 guard: in sessions list mode the legacy MultiSelectPanel must not
 * mount — CollectionBulkBar is the single bulk UI (feature parity superset:
 * status/priority/project/labels/due/flag/archive/clear). MultiSelectPanel
 * stays for sources/skills/automations, which have no CollectionBulkBar.
 *
 * MainContentPanel's render tree is too heavy for this harness, so this test
 * slices the component source at its navigation branches — the same level at
 * which the duplication existed.
 */

const SOURCE = readFileSync(join(__dirname, '..', 'MainContentPanel.tsx'), 'utf8')

function sessionsBranch(source: string): string {
  const start = source.indexOf('if (isSessionsNavigation(navState))')
  if (start < 0) throw new Error('sessions navigation branch not found')
  // The sessions branch is the last navigation branch before the fallback.
  const end = source.indexOf('// Fallback', start)
  return source.slice(start, end > start ? end : undefined)
}

describe('MainContentPanel sessions bulk UI', () => {
  it('does not mount the legacy MultiSelectPanel in the sessions branch', () => {
    expect(sessionsBranch(SOURCE)).not.toContain('<MultiSelectPanel')
  })

  it('keeps CollectionBulkBar mounted for sessions list/chat content', () => {
    expect(sessionsBranch(SOURCE)).toContain('<CollectionBulkBar')
  })

  it('keeps MultiSelectPanel for sources, skills, and automations', () => {
    expect(SOURCE).toContain('entityType="source"')
    expect(SOURCE).toContain('entityType="skill"')
    expect(SOURCE).toContain('entityType="automation"')
  })
})
