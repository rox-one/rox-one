import { describe, test, expect } from 'bun:test'
import { EXTRA_SCREEN_FEATURE_FLAGS, EXTRA_SCREEN_FLAG, WORKBENCH_FEATURE_FLAGS } from '@rox/core/platform'
import { EXTRA_SCREEN_IDS } from '../../../../shared/extra-screens'
import { EXTRA_SCREENS, visibleExtraScreens } from '../registry'

describe('extra screens registry', () => {
  test('every id has a registry entry with its workbench.mode.<id>.v1 flag', () => {
    expect(EXTRA_SCREENS.map((screen) => screen.id as string)).toEqual([...EXTRA_SCREEN_IDS] as string[])
    for (const screen of EXTRA_SCREENS) {
      expect(screen.flag).toBe(`workbench.mode.${screen.id}.v1`)
      expect(EXTRA_SCREEN_FLAG[screen.id] as string).toBe(screen.flag)
    }
  })

  test('flags are registered, default ON and rollback-safe', () => {
    for (const def of EXTRA_SCREEN_FEATURE_FLAGS) {
      expect(def.defaultValue).toBe(true)
      expect(def.rollbackSafe).toBe(true)
      expect(WORKBENCH_FEATURE_FLAGS.some((flag) => flag.id === def.id)).toBe(true)
    }
  })

  test('disabled screens are hidden from the rail group', () => {
    expect(visibleExtraScreens([])).toEqual([])
    expect(visibleExtraScreens(['dossier']).map((screen) => screen.id)).toEqual(['dossier'])
    expect(visibleExtraScreens(['radar', 'dossier']).map((screen) => screen.id)).toEqual(['dossier', 'radar'])
  })
})
