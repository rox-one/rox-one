import { describe, expect, it } from 'bun:test'
import { MessageSquare } from 'lucide-react'
import { SE_MONOCHROME_NAV_IDS, SE_RAIL_ACTIVE_BUTTON_CLASS, seRailIconProps } from '../se-icon-map'

describe('se-icon-map', () => {
  it('marks all app nav destinations monochrome for SE rail', () => {
    expect(SE_MONOCHROME_NAV_IDS.sessions).toBe(true)
    expect(SE_MONOCHROME_NAV_IDS.settings).toBe(true)
  })

  it('exposes SE active rail class token', () => {
    expect(SE_RAIL_ACTIVE_BUTTON_CLASS).toContain('bg-white/6')
  })

  it('returns non-colorable lucide icon props', () => {
    const props = seRailIconProps(MessageSquare)
    expect(props.icon).toBe(MessageSquare)
    expect(props.iconColorable).toBe(false)
  })
})
