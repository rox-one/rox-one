import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const uiCss = readFileSync(join(import.meta.dir, '../index.css'), 'utf8')
const dialCss = readFileSync(join(import.meta.dir, '../scenic-border-dialdown.css'), 'utf8')
const uiAll = uiCss + '\n' + dialCss
const rendererCss = readFileSync(
  join(import.meta.dir, '../../../../../apps/electron/src/renderer/index.css'),
  'utf8',
)
const electronDial = readFileSync(
  join(import.meta.dir, '../../../../../apps/electron/src/renderer/scenic-border-dialdown.css'),
  'utf8',
)

describe('scenic border dial-down (ship-rox-ui-border-dialdown)', () => {
  it('softens scenic shadow tokens outside high contrast', () => {
    expect(uiAll).toContain('SCENIC BORDER DIAL-DOWN')
    expect(uiAll).toContain('html[data-scenic]:not([data-contrast="high"])')
    expect(uiAll).toContain('.session-workflow-editor .shadow-strong')
  })

  it('removes scenic gradient frames except high contrast via dialdown import', () => {
    expect(rendererCss).toContain('@import "./scenic-border-dialdown.css"')
    expect(electronDial).toContain(
      'html[data-scenic]:not([data-contrast="high"]) .shadow-middle::before',
    )
    expect(electronDial).toContain('content: none !important')
  })

  it('keeps high-contrast scenic gradient frames in renderer', () => {
    expect(rendererCss).toContain('html[data-scenic] .shadow-middle::before')
    expect(rendererCss).toContain('mask-composite: exclude')
  })

  it('does not rewrite the leftover high-contrast token block', () => {
    expect(uiCss).toContain('HIGH CONTRAST (issue 07 leftover')
    expect(uiCss).toContain('html[data-contrast="high"][data-scenic]::before')
    expect(uiCss).toContain('--rox-elev-panel: inset 0 0 0 2px var(--border-strong)')
  })
})
