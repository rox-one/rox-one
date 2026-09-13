import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const topBar = readFileSync(join(import.meta.dir, '../TopBar.tsx'), 'utf8')
const topBarButton = readFileSync(join(import.meta.dir, '../../ui/TopBarButton.tsx'), 'utf8')

describe('Zen Shell top bar (ZS-03)', () => {
  it('uses native traffic-light safe area and does not draw HTML stoplights', () => {
    expect(topBar).toContain('zenTopBarSafeLeftPx')
    expect(topBar).toContain('titlebar-drag-region')
    expect(topBar).not.toMatch(/rounded-full bg-(red|yellow|green)/)
  })

  it('wires shell history to onBack/onForward and AppMenu', () => {
    expect(topBar).toContain('onClick={onBack}')
    expect(topBar).toContain('onClick={onForward}')
    expect(topBar).toContain('disabled={!canGoBack}')
    expect(topBar).toContain('disabled={!canGoForward}')
    expect(topBar).toContain('<AppMenu')
  })

  it('keeps interactive controls out of the drag region', () => {
    expect(topBarButton).toContain('titlebar-no-drag')
  })
})
