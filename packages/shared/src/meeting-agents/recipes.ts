/**
 * RMA-I019 / #375 — meeting recipe profiles.
 * Clone does not inherit extra privileges. Unknown skills fail closed.
 * No CRM capability → no fake CRM update.
 */

export const MEETING_PROFILE_IDS = [
  'standup',
  'discovery',
  'design-review',
  'client',
  'project-review',
] as const

export type MeetingProfileId = (typeof MEETING_PROFILE_IDS)[number]

export type MeetingRecipe = {
  readonly id: MeetingProfileId
  readonly version: number
  readonly playbook: string
  readonly outputs: readonly string[]
  readonly schema: string
  readonly triggers: readonly string[]
  readonly allowedActions: readonly string[]
  readonly skillId: string
}

export const SYSTEM_RECIPES: readonly MeetingRecipe[] = [
  {
    id: 'standup',
    version: 1,
    playbook: 'standup-notes',
    outputs: ['notes', 'tasks'],
    schema: 'meeting.standup.v1',
    triggers: ['calendar.standup'],
    allowedActions: ['notes.create', 'tasks.create'],
    skillId: 'meeting.standup',
  },
  {
    id: 'discovery',
    version: 1,
    playbook: 'discovery-notes',
    outputs: ['notes', 'questions'],
    schema: 'meeting.discovery.v1',
    triggers: ['calendar.discovery'],
    allowedActions: ['notes.create'],
    skillId: 'meeting.discovery',
  },
  {
    id: 'design-review',
    version: 1,
    playbook: 'design-review',
    outputs: ['notes', 'decisions'],
    schema: 'meeting.design-review.v1',
    triggers: ['calendar.design-review'],
    allowedActions: ['notes.create', 'tasks.create'],
    skillId: 'meeting.design-review',
  },
  {
    id: 'client',
    version: 1,
    playbook: 'client-recap',
    outputs: ['notes', 'crm-proposal'],
    schema: 'meeting.client.v1',
    triggers: ['calendar.client'],
    allowedActions: ['notes.create'],
    skillId: 'meeting.client',
  },
  {
    id: 'project-review',
    version: 1,
    playbook: 'project-review',
    outputs: ['notes', 'tasks'],
    schema: 'meeting.project-review.v1',
    triggers: ['calendar.project-review'],
    allowedActions: ['notes.create', 'tasks.create'],
    skillId: 'meeting.project-review',
  },
]

export type RecipeOverride = {
  readonly recipeId: MeetingProfileId
  readonly disabled?: boolean
  readonly extraActions?: readonly string[]
  readonly skillId?: string
}

export type RecipeClone = {
  readonly from: MeetingProfileId
  readonly id: string
  readonly allowedActions: readonly string[]
}

export function recipeById(id: string): MeetingRecipe | undefined {
  return SYSTEM_RECIPES.find((recipe) => recipe.id === id)
}

export function invokeSkill(skillId: string, installed: readonly string[]): { ok: true } | { ok: false; reason: 'unknown-skill' } {
  if (!installed.includes(skillId)) return { ok: false, reason: 'unknown-skill' }
  return { ok: true }
}

export function applyOverride(
  recipe: MeetingRecipe,
  override: RecipeOverride | undefined,
): MeetingRecipe {
  if (!override) return recipe
  return {
    ...recipe,
    allowedActions: recipe.allowedActions,
    skillId: override.skillId ?? recipe.skillId,
  }
}

export function cloneRecipe(recipe: MeetingRecipe, cloneId: string): RecipeClone {
  return {
    from: recipe.id,
    id: cloneId,
    allowedActions: [...recipe.allowedActions],
  }
}

export function escalateClone(
  recipe: MeetingRecipe,
  extraActions: readonly string[],
): { ok: false; reason: 'clone-privilege-escalation' } | RecipeClone {
  const extras = extraActions.filter((action) => !recipe.allowedActions.includes(action))
  if (extras.length > 0) {
    return { ok: false, reason: 'clone-privilege-escalation' }
  }
  return cloneRecipe(recipe, `${recipe.id}-clone`)
}

export function clientCrmProposal(hasCrmCapability: boolean): { kind: 'proposal' } | { kind: 'blocked'; reason: 'no-crm' } {
  if (!hasCrmCapability) return { kind: 'blocked', reason: 'no-crm' }
  return { kind: 'proposal' }
}

export type AgentReadinessState = {
  readonly installed: boolean
  readonly enabled: boolean
  readonly authorized: boolean
  readonly healthy: boolean
  readonly running: boolean
}

export function readinessBlocker(state: AgentReadinessState): string | null {
  if (!state.installed) return 'not-installed'
  if (!state.enabled) return 'disabled'
  if (!state.authorized) return 'unauthorized'
  if (!state.healthy) return 'unhealthy'
  if (!state.running) return 'not-running'
  return null
}

export function overrideSurvivesUpgrade(
  stored: RecipeOverride,
  _systemVersion: number,
): RecipeOverride {
  return stored
}
