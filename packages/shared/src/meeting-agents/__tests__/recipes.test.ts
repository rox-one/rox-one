import { describe, expect, it } from 'bun:test'
import {
  applyOverride,
  clientCrmProposal,
  cloneRecipe,
  escalateClone,
  invokeSkill,
  MEETING_PROFILE_IDS,
  overrideSurvivesUpgrade,
  readinessBlocker,
  recipeById,
  SYSTEM_RECIPES,
} from '../recipes.ts'

describe('meeting recipes (#375)', () => {
  it('has a schema for each profile', () => {
    expect(MEETING_PROFILE_IDS).toEqual([
      'standup',
      'discovery',
      'design-review',
      'client',
      'project-review',
    ])
    for (const id of MEETING_PROFILE_IDS) {
      const recipe = recipeById(id)
      expect(recipe?.schema).toMatch(/^meeting\./)
      expect(recipe?.skillId).toBeTruthy()
    }
    expect(SYSTEM_RECIPES).toHaveLength(5)
  })

  it('fails closed on unknown skills instead of inserting a name', () => {
    expect(invokeSkill('meeting.standup', ['meeting.standup'])).toEqual({ ok: true })
    expect(invokeSkill('meeting.standup', [])).toEqual({ ok: false, reason: 'unknown-skill' })
  })

  it('keeps user disable across system upgrade', () => {
    const stored = overrideSurvivesUpgrade({ recipeId: 'standup', disabled: true }, 2)
    expect(stored.disabled).toBe(true)
    const recipe = recipeById('standup')!
    const applied = applyOverride(recipe, stored)
    expect(applied.allowedActions).toEqual(recipe.allowedActions)
  })

  it('rejects clone privilege escalation', () => {
    const recipe = recipeById('standup')!
    const clone = cloneRecipe(recipe, 'standup-mine')
    expect(clone.allowedActions).toEqual(recipe.allowedActions)
    expect(escalateClone(recipe, ['crm.update'])).toEqual({ ok: false, reason: 'clone-privilege-escalation' })
    const cloneOk = escalateClone(recipe, recipe.allowedActions)
    expect('from' in cloneOk).toBe(true)
  })

  it('does not fake a CRM update without CRM capability', () => {
    expect(clientCrmProposal(false)).toEqual({ kind: 'blocked', reason: 'no-crm' })
    expect(clientCrmProposal(true)).toEqual({ kind: 'proposal' })
  })

  it('readiness reports the concrete blocker', () => {
    expect(
      readinessBlocker({
        installed: true,
        enabled: true,
        authorized: false,
        healthy: true,
        running: false,
      }),
    ).toBe('unauthorized')
  })
})
