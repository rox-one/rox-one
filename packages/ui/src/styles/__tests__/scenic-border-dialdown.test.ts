import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const uiCss = readFileSync(join(import.meta.dir, '../index.css'), 'utf8')
const rendererCss = readFileSync(
  join(import.meta.dir, '../../../../../apps/electron/src/renderer/index.css'),
  'utf8',
)

describe('scenic border dial-down (ship-rox-ui-border-dialdown)', () => {
  it('softens scenic shadow tokens outside high contrast', () => {
    expect(uiCss).toContain('SCENIC BORDER DIAL-DOWN')
    expect(uiCss).toContain('html[data-scenic]:not([data-contrast="high"])')
    expect(uiCss).toContain('.session-workflow-editor .shadow-strong')
  })

  it('removes scenic gradient frames except high contrast', () => {
    expect(rendererCss).toContain(
      'html[data-scenic]:not([data-contrast="high"]) .shadow-middle::before',
    )
    expect(rendererCss).toContain('content: none')
    expect(rendererCss).toContain(
      'html[data-contrast="high"][data-scenic] .shadow-middle::before',
    )
  })

  it('keeps high-contrast scenic gradient frames', () => {
    const hcIdx = rendererCss.indexOf(
      'html[data-contrast="high"][data-scenic] .shadow-middle::before',
    )
    expect(hcIdx).toBeGreaterThan(-1)
    const slice = rendererCss.slice(hcIdx, hcIdx + 700)
    expect(slice).toContain("content: ''")
    expect(slice).toContain('mask-composite: exclude')
  })

  it('does not rewrite the leftover high-contrast token block', () => {
    expect(uiCss).toContain('HIGH CONTRAST (issue 07 leftover')
    expect(uiCss).toContain('html[data-contrast="high"][data-scenic]::before')
    expect(uiCss).toContain('--rox-elev-panel: inset 0 0 0 2px var(--border-strong)')
  })
})
