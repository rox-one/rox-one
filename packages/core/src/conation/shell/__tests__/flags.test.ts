import { describe, expect, it } from 'bun:test'
import {
  CONATION_SHELL_FEATURE_FLAGS,
  CONATION_SHELL_FLAG,
  isConationSurfacesSkillEnabled,
} from '../index.ts'

describe('conation shell flags', () => {
  it('uses locked ids under workbench.conation / skills.conation', () => {
    expect(CONATION_SHELL_FLAG.shell).toBe('workbench.conation.shell')
    expect(CONATION_SHELL_FLAG.inspector).toBe('workbench.conation.inspector')
    expect(CONATION_SHELL_FLAG.surfacesSkill).toBe('skills.conation.surfaces')
  })

  it('defaults all flags false and rollback-safe', () => {
    for (const id of Object.values(CONATION_SHELL_FLAG)) {
      const definition = CONATION_SHELL_FEATURE_FLAGS.find((flag) => flag.id === id)
      expect(definition?.defaultValue).toBe(false)
      expect(definition?.rollbackSafe).toBe(true)
      expect(definition?.dependencies).toEqual([])
    }
  })

  it('surfaces skill gate stays off unless explicitly requested', () => {
    expect(isConationSurfacesSkillEnabled(false)).toBe(false)
    expect(isConationSurfacesSkillEnabled(true)).toBe(true)
  })
})
