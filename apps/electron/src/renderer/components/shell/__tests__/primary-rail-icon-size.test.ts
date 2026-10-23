import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * P4 chrome: sidebar/rail icons ~14–16px (Oct 14). PrimaryRail must use
 * icon-toolbar (16px), not icon-rail (20px). ActivityRail/RailRow already
 * use icon-toolbar; LeftSidebar SE path uses h-3.5 (14px).
 */
describe('PrimaryRail icon size (P4)', () => {
  it('uses icon-toolbar (16px) and not icon-rail (20px)', () => {
    const body = readFileSync(join(import.meta.dir, '../PrimaryRail.tsx'), 'utf8')
    expect(body).toContain('icon-toolbar')
    expect(body).not.toMatch(/\bicon-rail\b/)
  })
})
