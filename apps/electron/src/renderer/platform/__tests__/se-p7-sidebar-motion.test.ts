/**
 * P7.3 — LeftSidebar disclosure/list motion: opacity+transform only,
 * no height layout anim, no stagger spam, SE spring tokens.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../components/app-shell')

describe('P7.3 LeftSidebar motion', () => {
  const src = readFileSync(join(ROOT, 'LeftSidebar.tsx'), 'utf8')

  it('wires SE_SPRING_LIST / SE_MOTION_SEC', () => {
    expect(src).toMatch(/SE_SPRING_LIST/)
    expect(src).toMatch(/SE_MOTION_SEC/)
    expect(src).toMatch(/from '@\/lib\/motion\/super-engineering-springs'/)
  })

  it('kills staggerChildren spam', () => {
    expect(src).not.toMatch(/staggerChildren/)
    expect(src).not.toMatch(/delayChildren/)
    expect(src).not.toMatch(/staggerDirection/)
  })

  it('section disclosure uses opacity+transform only (no height/margin layout anim)', () => {
    expect(src).not.toMatch(/height:\s*0/)
    expect(src).not.toMatch(/height:\s*['"]auto['"]/)
    expect(src).not.toMatch(/marginTop:\s*0/)
    expect(src).toMatch(/opacity:\s*0,\s*y:\s*-6/)
    expect(src).toMatch(/opacity:\s*1,\s*y:\s*0/)
  })

  it('honors prefers-reduced-motion with duration 0', () => {
    expect(src).toMatch(/reduceMotion\s*\?\s*\{\s*duration:\s*0\s*\}/)
  })
})
