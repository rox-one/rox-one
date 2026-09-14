import { describe, expect, test } from 'bun:test'
import { buildSessionToolDefs } from '../../agent/session-tool-defs.ts'
import {
  emptyMeetingAgentStore,
  ensureBuiltinMeetingAgents,
} from '../bootstrap.ts'
import {
  MEETING_AGENT_TOOL_NAMES,
} from '../../agent/session-tool-defs.ts'
import {
  SYSTEM_RECIPES,
  applyMeetingRecipe,
  applyOverride,
  agentReadinessViews,
  clientCrmProposal,
  cloneRecipe,
  ensureMeetingRecipes,
  escalateClone,
  invokeMeetingSlash,
  invokeSkill,
  MEETING_PROFILE_IDS,
  overrideSurvivesUpgrade,
  proposeClientAnalysis,
  readinessBlocker,
  recipeById,
  resetRecipe,
  setRecipeOverride,
  emptyRecipeLedger,
} from '../recipes.ts'

describe('meeting recipes (issue 375 / I019)', () => {
  test('each profile has its own schema, playbook, and catalog skills', () => {
    expect(MEETING_PROFILE_IDS).toEqual([
      'standup',
      'discovery',
      'design-review',
      'client',
      'project-review',
    ])
    const schemas = new Set<string>()
    for (const id of MEETING_PROFILE_IDS) {
      const recipe = recipeById(id)
      expect(recipe?.schema).toMatch(/^meeting\./)
      expect(recipe?.playbook).toBeTruthy()
      expect(recipe?.skillIds.length).toBeGreaterThan(0)
      for (const skill of recipe!.skillIds) {
        expect(MEETING_AGENT_TOOL_NAMES.has(skill)).toBe(true)
      }
      schemas.add(recipe!.schema)
    }
    expect(SYSTEM_RECIPES).toHaveLength(5)
    expect(schemas.size).toBe(5)
  })

  test('selecting a profile changes output schema and playbook', () => {
    const snapshot = { revision: 1, finalizedWatermark: 1, text: 'standup' }
    const standup = applyMeetingRecipe({
      id: 'e-standup',
      kind: 'end',
      meetingId: 'm1',
      workspaceId: 'ws',
      sourceSnapshot: snapshot,
      final: true,
    }, 'standup')
    const discovery = applyMeetingRecipe({
      id: 'e-discovery',
      kind: 'hotkey',
      meetingId: 'm1',
      workspaceId: 'ws',
      sourceSnapshot: snapshot,
      interactive: true,
      final: true,
    }, 'discovery')
    expect(standup.ok).toBe(true)
    expect(discovery.ok).toBe(true)
    if (!standup.ok || !discovery.ok) return
    expect(standup.recipe.schema).toBe('meeting.standup.v1')
    expect(discovery.recipe.schema).toBe('meeting.discovery.v1')
    expect(standup.recipe.playbook).not.toBe(discovery.recipe.playbook)
    expect(standup.jobs.some((job) => job.outputSchemaId === 'meeting.standup.v1')).toBe(true)
    expect(discovery.jobs.some((job) => job.roleId === 'rox.meeting.assist')).toBe(true)
    expect(standup.jobs.some((job) => job.roleId === 'rox.meeting.assist')).toBe(false)
    expect(standup.jobs.every((job) => job.allowedToolNames.every((name) => recipeById('standup')!.skillIds.includes(name)))).toBe(true)
  })

  test('slash invokes a catalog skill and does not insert an unknown name', () => {
    const ctx = {
      meetingId: 'm1',
      workspaceId: 'ws',
      sourceSnapshot: { revision: 1, finalizedWatermark: 1 },
    }
    const standup = invokeMeetingSlash('/standup', ctx)
    expect(standup.ok).toBe(true)
    if (standup.ok) {
      expect(standup.insertIntoChat).toBe(false)
      expect(standup.skillId).toBe('meeting.notes')
      expect(standup.outputSchemaId).toBe('meeting.standup.v1')
      expect(MEETING_AGENT_TOOL_NAMES.has(standup.skillId)).toBe(true)
      expect(standup.jobs.length).toBeGreaterThan(0)
      expect(standup.jobs.every((job) => job.toolName === 'meeting.notes')).toBe(true)
    }

    const unknown = invokeMeetingSlash('/not-a-skill', ctx)
    expect(unknown).toEqual({ ok: false, insertIntoChat: false, code: 'unknown-skill' })

    const notSlash = invokeMeetingSlash('please run standup', ctx)
    expect(notSlash).toEqual({ ok: false, insertIntoChat: true, code: 'not-slash' })

    expect(invokeSkill('meeting.notes', ['meeting.notes'])).toEqual({ ok: true })
    expect(invokeSkill('meeting.standup', ['meeting.standup'])).toEqual({ ok: false, reason: 'unknown-skill' })
  })

  test('user disable and playbook override survive a recipe version upgrade', () => {
    const stored = overrideSurvivesUpgrade({ recipeId: 'standup', disabled: true, playbook: 'custom-standup' }, 2)
    expect(stored.disabled).toBe(true)
    const first = setRecipeOverride(emptyRecipeLedger('1.0.0'), stored)
    const upgraded = ensureMeetingRecipes(first, '1.1.0')
    expect(upgraded.packageVersion).toBe('1.1.0')
    expect(upgraded.overrides.standup?.disabled).toBe(true)
    const applied = applyOverride(recipeById('standup')!, upgraded.overrides.standup)
    expect(applied.allowedActions).toEqual(recipeById('standup')!.allowedActions)
    expect(applied.playbook).toBe('custom-standup')
    const reset = resetRecipe(upgraded, 'standup')
    expect(reset.overrides.standup).toBeUndefined()
    expect(reset.packageVersion).toBe('1.1.0')
  })

  test('override cannot remap a recipe onto a more powerful catalog skill', () => {
    const recipe = recipeById('standup')!
    const applied = applyOverride(recipe, { recipeId: 'standup', skillId: 'meeting.execute' })
    expect(applied.skillIds).toEqual(recipe.skillIds)
    expect(applied.skillIds).not.toContain('meeting.execute')
  })

  test('clone cannot escalate privileges', () => {
    const recipe = recipeById('standup')!
    const clone = cloneRecipe(recipe, 'standup-mine')
    expect(clone.ok).toBe(true)
    if (clone.ok) {
      expect(clone.clone.allowedActions).toEqual(recipe.allowedActions)
      expect(clone.clone.skillIds).toEqual(recipe.skillIds)
    }
    expect(cloneRecipe(recipe, 'standup-crm', { allowedActions: ['notes.create', 'crm.update'] })).toEqual({
      ok: false,
      reason: 'clone-privilege-escalation',
    })
    expect(cloneRecipe(recipe, 'standup-exec', { skillIds: [...recipe.skillIds, 'meeting.execute'] }).ok).toBe(false)
    expect(escalateClone(recipe, ['crm.update']).reason).toBe('clone-privilege-escalation')
    const cloneOk = escalateClone(recipe, recipe.allowedActions)
    expect('from' in cloneOk).toBe(true)
  })

  test('client analysis proposes and never fakes a CRM update; private notes stay out', () => {
    expect(clientCrmProposal(false)).toEqual({ kind: 'blocked', reason: 'no-crm' })
    expect(clientCrmProposal(true)).toEqual({ kind: 'proposal' })

    const notes = [
      { id: 'n-private', audience: 'private' as const, body: 'SECRET_SALARY 9000' },
      { id: 'n-shared', audience: 'shared' as const, body: 'Client wants a prototype' },
    ]
    const blocked = proposeClientAnalysis({ hasCrmCapability: false, notes })
    expect(blocked).toMatchObject({ ok: false, code: 'no-crm', fakeUpdate: false, includedNoteIds: [] })
    expect(JSON.stringify(blocked)).not.toContain('SECRET_SALARY')

    const proposed = proposeClientAnalysis({ hasCrmCapability: true, notes })
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.kind).toBe('proposal')
    expect(proposed.status).toBe('proposed')
    expect(proposed.includedNoteIds).toEqual(['n-shared'])
    expect(proposed.excludedPrivateIds).toEqual(['n-private'])
    expect(JSON.stringify(proposed)).not.toContain('SECRET_SALARY')
  })

  test('readiness shows five independent states and a concrete blocker', () => {
    expect(readinessBlocker({
      installed: true,
      enabled: true,
      authorized: false,
      healthy: true,
      running: false,
    })).toBe('unauthorized')
    expect(readinessBlocker({
      installed: true,
      enabled: true,
      authorized: true,
      healthy: true,
      running: false,
    })).toBe(null)

    const { store } = ensureBuiltinMeetingAgents('ws-1', '1.0.0', emptyMeetingAgentStore())
    const views = agentReadinessViews('ws-1', store, { available: false, reason: 'no-route' })
    expect(views).toHaveLength(8)
    expect(views.every((row) => row.installed)).toBe(true)
    expect(views.every((row) => row.running === false)).toBe(true)
    expect(views.every((row) => row.healthy === false)).toBe(true)
    expect(views.every((row) => row.blocker === 'unauthorized' || row.blocker === 'unhealthy')).toBe(true)
  })

  test('meeting tools stay opt-in on the single session catalog', () => {
    const defaultNames = buildSessionToolDefs().map((def) => def.name)
    expect(defaultNames).not.toContain('meeting.notes')
    expect(defaultNames).not.toContain('meeting.crm')
    for (const recipe of SYSTEM_RECIPES) {
      for (const skill of recipe.skillIds) {
        expect(buildSessionToolDefs({ includeMeetingAgentTools: true }).some((def) => def.name === skill)).toBe(true)
      }
    }
  })
})
