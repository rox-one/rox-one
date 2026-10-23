/**
 * P7.4 — kill one-off long/odd transitions; SessionFiles mirrors LeftSidebar SE motion.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../..')

describe('P7.4 one-off motion sweep', () => {
  it('SessionFilesSection: no stagger/height; SE springs', () => {
    const src = readFileSync(
      join(ROOT, 'components/right-sidebar/SessionFilesSection.tsx'),
      'utf8',
    )
    expect(src).toMatch(/SE_SPRING_LIST/)
    expect(src).not.toMatch(/staggerChildren/)
    expect(src).not.toMatch(/height:\s*['"]auto['"]/)
    expect(src).toMatch(/opacity:\s*0,\s*y:\s*-6/)
  })

  it('PanelStackContainer uses SE_MOTION_SEC.disclosure', () => {
    const src = readFileSync(
      join(ROOT, 'components/app-shell/PanelStackContainer.tsx'),
      'utf8',
    )
    expect(src).toMatch(/SE_MOTION_SEC\.disclosure/)
    expect(src).not.toMatch(/duration:\s*0\.18/)
  })

  it('ChatDisplay processing crossfade uses SE_MOTION_SEC (not 0.4s)', () => {
    const src = readFileSync(join(ROOT, 'components/app-shell/ChatDisplay.tsx'), 'utf8')
    expect(src).toMatch(/SE_MOTION_SEC\.disclosure/)
    expect(src).not.toMatch(/duration:\s*0\.4/)
  })
})
