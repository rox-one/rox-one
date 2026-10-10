import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../switch.tsx'), 'utf8')

// The 28x36 Switch (restructured on main in 3fd43af8c) moved the track off the
// root onto an inner aria-hidden span: the root is now a transparent hit target
// and the span is the visible 18x32 track (unchecked bg-foreground/30, checked
// bg-accent). The pre-restructure root-level contract from #306
// (data-[state=unchecked]:bg-foreground/55, dark:/50, border-foreground/45) no
// longer exists; the contrast floor now lives on the span's own colour.
const track = source.match(/aria-hidden="true"[\s\S]*?className="([^"]+)"/)?.[1] ?? ''

describe('Switch contrast', () => {
  it('keeps the unchecked track at >=30% foreground so Appearance toggles stay visible', () => {
    // shipped declaration of the unchecked track colour
    expect(track).toContain('bg-foreground/30')
    // the floor is numeric: the unchecked track is never lighter than 30% foreground
    expect(Number(track.match(/bg-foreground\/(\d+)/)?.[1] ?? '0')).toBeGreaterThanOrEqual(30)
    // the checked track stays visually distinct from the unchecked one
    expect(track).toContain('group-data-[state=checked]:bg-accent')
    // never regress to the faint pre-#306 / #306-era values
    expect(source).not.toContain('data-[state=unchecked]:bg-foreground/35')
    expect(source).not.toContain('dark:data-[state=unchecked]:bg-foreground/30')
    expect(source).not.toContain('border-foreground/25')
  })
})