import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MEMORY_CONFIG } from '@rox/shared/memory/types'

const page = readFileSync(join(import.meta.dir, '../MemorySettingsPage.tsx'), 'utf8')
const notice = readFileSync(join(import.meta.dir, '../../../../../../../NOTICE'), 'utf8')
const sidecarNotice = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/cognee-sidecar/NOTICE'),
  'utf8',
)

describe('graph memory default-on + NOTICE (PR8)', () => {
  it('keeps DEFAULT_MEMORY_CONFIG.graph on', () => {
    expect(DEFAULT_MEMORY_CONFIG.graph).toBe(true)
  })

  it('Settings page documents default-on graph toggle', () => {
    expect(page).toContain("t('settings.memory.graph')")
    expect(page).toContain('graphOn')
  })

  it('root NOTICE attributes cognee; sidecar NOTICE present', () => {
    expect(notice.toLowerCase()).toContain('cognee')
    expect(sidecarNotice).toContain('Apache License')
    expect(sidecarNotice).toContain('topoteretes')
  })
})
