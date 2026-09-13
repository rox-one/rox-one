import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entityRowHoverPlacement } from '../entity-row-hover-slot'

const entityRowSrc = readFileSync(
  join(import.meta.dir, '../entity-row.tsx'),
  'utf8',
)

describe('entityRowHoverPlacement', () => {
  it('puts flag/archive/more in the title trailing slot when a menu exists', () => {
    expect(entityRowHoverPlacement({ hasMenu: true })).toBe('title-slot')
  })

  it('hides the cluster when the more button is suppressed', () => {
    expect(entityRowHoverPlacement({ hasMenu: true, hideMoreButton: true })).toBe('none')
  })

  it('skips the slot when there is no menu', () => {
    expect(entityRowHoverPlacement({ hasMenu: false })).toBe('none')
  })
})

describe('EntityRow hover cluster source contract', () => {
  it('does not paint hover actions as an overlay on the title', () => {
    expect(entityRowSrc).toContain('entityRowHoverPlacement')
    expect(entityRowSrc).toContain('data-entity-row-hover-slot')
    expect(entityRowSrc).not.toMatch(/absolute right-2 top-2/)
  })
})
