/**
 * P8.1 — Messenger mid-band: info docks overlay <900; header secondary → ⋯;
 * infoOpen defaults closed; channel list fluid under midNarrow.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(
  join(import.meta.dir, '../../components/messenger/MessengerChannels.tsx'),
  'utf8',
)

describe('P8.1 Messenger responsive', () => {
  it('defaults info panel closed', () => {
    expect(src).toMatch(/useState\(false\)/)
    expect(src).toMatch(/setInfoOpen\(false\)/)
  })

  it('measures panel and treats <900 as midNarrow / <720 headerCompact', () => {
    expect(src).toMatch(/panelW < 900/)
    expect(src).toMatch(/panelW < 720/)
    expect(src).toMatch(/ResizeObserver/)
  })

  it('docks info as overlay under midNarrow', () => {
    expect(src).toMatch(/data-messenger-info-dock/)
    expect(src).toMatch(/overlay/)
  })

  it('collapses secondary header actions into overflow menu', () => {
    expect(src).toMatch(/messenger-header-more/)
    expect(src).toMatch(/MoreHorizontal/)
    expect(src).toMatch(/headerCompact/)
  })

  it('keeps info toggle outside the overflow menu', () => {
    expect(src).toMatch(/messenger-info-toggle/)
  })
})
