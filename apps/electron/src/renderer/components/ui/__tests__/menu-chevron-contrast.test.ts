import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

function source(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

describe('menu chevron contrast', () => {
  it('keeps submenu arrows at 70% foreground, not 40/50 muted', () => {
    const dropdown = source('ui/dropdown-menu.tsx')
    const context = source('ui/context-menu.tsx')
    const compact = source('app-shell/CompactSessionMenu.tsx')
    const mobile = source('app-menu/MobileMenuItem.tsx')
    const collection = source('app-shell/collection/collection-menu-row.tsx')

    expect(dropdown).toContain('ChevronRightIcon className="ml-auto size-4 text-foreground/70"')
    expect(context).toContain('ChevronRightIcon className="ml-auto text-foreground/70"')
    expect(compact).toContain('ChevronRight className="h-4 w-4 shrink-0 text-foreground/70"')
    expect(mobile).toContain('ChevronRight className="h-4 w-4 shrink-0 text-foreground/70"')
    expect(collection).toContain('text-foreground/70 transition-transform duration-150')

    expect(compact).not.toContain('ChevronRight className="h-4 w-4 shrink-0 text-foreground/50"')
    expect(mobile).not.toContain('ChevronRight className="h-4 w-4 shrink-0 text-foreground/40"')
    expect(collection).not.toContain("h-3 w-3 shrink-0 text-muted-foreground/70")
  })
})
