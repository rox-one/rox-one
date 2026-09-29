import { describe, expect, it } from 'bun:test'
import { clampShellColumns, type ShellColumnClampInput } from '../shell-width-clamp'

const base: ShellColumnClampInput = {
  shellWidth: 1400,
  reserved: 88,
  sidebar: 220,
  navigator: 300,
  sidebarVisible: true,
  navigatorVisible: true,
  sidebarMin: 180,
  navigatorMin: 240,
  centerMin: 420,
}

describe('clampShellColumns', () => {
  it('keeps restored widths when the center already has its minimum', () => {
    expect(clampShellColumns(base)).toEqual({ sidebar: 220, navigator: 300 })
  })

  it('narrows the list first, then the sidebar', () => {
    // 88 + 220 + 300 + 420 = 1028 → 1000 needs 28 from the list.
    expect(clampShellColumns({ ...base, shellWidth: 1000 })).toEqual({ sidebar: 220, navigator: 272 })
    // 1028 - 950 = 78 → list gives 60 (to 240), sidebar gives 18.
    expect(clampShellColumns({ ...base, shellWidth: 950 })).toEqual({ sidebar: 202, navigator: 240 })
  })

  it('stops at the column minimums in genuinely narrow windows', () => {
    expect(clampShellColumns({ ...base, shellWidth: 800 })).toEqual({ sidebar: 180, navigator: 240 })
  })

  it('ignores hidden columns and unmeasured shells', () => {
    expect(clampShellColumns({ ...base, shellWidth: 700, sidebarVisible: false })).toEqual({ sidebar: 220, navigator: 240 })
    expect(clampShellColumns({ ...base, shellWidth: 0 })).toEqual({ sidebar: 220, navigator: 300 })
  })
})
