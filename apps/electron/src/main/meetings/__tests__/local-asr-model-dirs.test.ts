/**
 * W1-13 (#1510): the legacy hidden-home models dir stays in the local-ASR
 * search list whenever it differs from the resolved config dir (unchanged
 * from before W1-13 with the flag OFF). Pure path logic — no fs access.
 */
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { modelDirs } from '../local-asr'

const home = '/home/tester'

describe('modelDirs', () => {
  it('lists the config dir first and keeps the legacy models dir', () => {
    expect(modelDirs(join(home, 'rox'), home)).toEqual([join(home, 'rox', 'models'), join(home, '.rox', 'models')])
    expect(modelDirs('/custom/profile', home)).toEqual(['/custom/profile/models', join(home, '.rox', 'models')])
  })

  it('dedupes when the config dir is the legacy home', () => {
    expect(modelDirs(join(home, '.rox'), home)).toEqual([join(home, '.rox', 'models')])
  })
})
