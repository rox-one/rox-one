/**
 * Meeting recipe profiles, slash skills, and clone/override policy (issue #375 / I019).
 * Profiles change playbook and output schema. `/` invokes a catalog skill.
 * Clone/override cannot add rights. Client analysis proposes; it never fakes a CRM write.
 */

import { MEETING_AGENT_TOOL_NAMES, hostToolsForMeetingSkills, isKnownSessionToolName } from '../agent/session-tool-defs.ts'
import { builtinMeetingAgent, type BuiltinMeetingAgentId } from './catalog.ts'
import {
  readinessFor,
  type MeetingAgentReadiness,
  type MeetingAgentStore,
} from './bootstrap.ts'
import {
  routeMeetingEvent,
  type MeetingEvent,
  type MeetingSourceSnapshot,
  type RoleJob,
} from './router.ts'

export const MEETING_RECIPE_PACKAGE_VERSION = '1.0.0'

export const MEETING_PROFILE_IDS = [
  'standup',
  'discovery',
  'design-review',
  'client',
  'project-review',
] as const

export type MeetingProfileId = (typeof MEETING_PROFILE_IDS)[number]

export type MeetingRecipeAction =
  | 'notes.create'
  | 'tasks.create'
  | 'knowledge.propose'
  | 'crm.propose'

export type MeetingRecipe = {
  readonly id: MeetingProfileId
  readonly version: number
  readonly playbook: string
  readonly outputs: readonly string[]
  readonly schema: string
  readonly triggers: readonly string[]
  readonly allowedActions: readonly MeetingRecipeAction[]
  readonly skillIds: readonly string[]
  readonly roleIds: readonly BuiltinMeetingAgentId[]
}

export const SYSTEM_RECIPES: readonly MeetingRecipe[] = [
  {
    id: 'standup',
    version: 1,
    playbook: 'standup-notes',
    outputs: ['notes', 'tasks'],
    schema: 'meeting.standup.v1',
    triggers: ['prepare', 'end', 'slash'],
    allowedActions: ['notes.create', 'tasks.create'],
    skillIds: ['meeting.notes', 'meeting.followup'],
    roleIds: ['rox.meeting.scribe', 'rox.meeting.followup'],
  },
  {
    id: 'discovery',
    version: 1,
    playbook: 'discovery-notes',
    outputs: ['notes', 'questions'],
    schema: 'meeting.discovery.v1',
    triggers: ['question', 'hotkey', 'slash'],
    allowedActions: ['notes.create'],
    skillIds: ['meeting.assist', 'meeting.notes'],
    roleIds: ['rox.meeting.assist', 'rox.meeting.scribe'],
  },
  {
    id: 'design-review',
    version: 1,
    playbook: 'design-review',
    outputs: ['notes', 'decisions'],
    schema: 'meeting.design-review.v1',
    triggers: ['fact', 'decision', 'slash'],
    allowedActions: ['notes.create', 'knowledge.propose'],
    skillIds: ['meeting.knowledge-diff', 'meeting.notes'],
    roleIds: ['rox.meeting.knowledge', 'rox.meeting.scribe'],
  },
  {
    id: 'client',
    version: 1,
    playbook: 'client-recap',
    outputs: ['notes', 'crm-proposal'],
    schema: 'meeting.client.v1',
    triggers: ['profile', 'review', 'slash'],
    allowedActions: ['notes.create', 'crm.propose'],
    skillIds: ['meeting.crm', 'meeting.notes'],
    roleIds: ['rox.meeting.analyst', 'rox.meeting.scribe'],
  },
  {
    id: 'project-review',
    version: 1,
    playbook: 'project-review',
    outputs: ['notes', 'tasks'],
    schema: 'meeting.project-review.v1',
    triggers: ['profile', 'review', 'end', 'slash'],
    allowedActions: ['notes.create', 'tasks.create'],
    skillIds: ['meeting.risks', 'meeting.notes', 'meeting.followup'],
    roleIds: ['rox.meeting.analyst', 'rox.meeting.scribe', 'rox.meeting.followup'],
  },
]

export type RecipeOverride = {
  readonly recipeId: MeetingProfileId
  readonly disabled?: boolean
  readonly playbook?: string
  readonly extraActions?: readonly string[]
  readonly skillId?: string
}

export type RecipeClone = {
  readonly from: MeetingProfileId
  readonly id: string
  readonly version: number
  readonly allowedActions: readonly MeetingRecipeAction[]
  readonly skillIds: readonly string[]
  readonly roleIds: readonly BuiltinMeetingAgentId[]
}

export type RecipeLedger = {
  packageVersion: string
  overrides: Partial<Record<MeetingProfileId, RecipeOverride>>
  clones: RecipeClone[]
}

export type RecipeBoundJob = RoleJob & {
  recipeId: MeetingProfileId
  playbook: string
  outputSchemaId: string
}

export type AgentReadinessBlocker =
  | 'not-installed'
  | 'disabled'
  | 'unauthorized'
  | 'unhealthy'

export type AgentReadinessView = MeetingAgentReadiness & {
  blocker: AgentReadinessBlocker | null
}

export type ClientAnalysisNote = {
  id: string
  audience: 'private' | 'shared'
  body: string
}

export function emptyRecipeLedger(packageVersion = MEETING_RECIPE_PACKAGE_VERSION): RecipeLedger {
  return { packageVersion, overrides: {}, clones: [] }
}

export function recipeById(id: string): MeetingRecipe | undefined {
  return SYSTEM_RECIPES.find((recipe) => recipe.id === id)
}

export function ensureMeetingRecipes(
  ledger: RecipeLedger,
  packageVersion = MEETING_RECIPE_PACKAGE_VERSION,
): RecipeLedger {
  return {
    packageVersion,
    overrides: { ...ledger.overrides },
    clones: ledger.clones.map((clone) => ({ ...clone })),
  }
}

export function applyOverride(
  recipe: MeetingRecipe,
  override: RecipeOverride | undefined,
): MeetingRecipe {
  if (!override) return recipe
  const skillId = override.skillId
  const skillAllowed = skillId ? recipe.skillIds.includes(skillId) && catalogSkill(skillId) : false
  return {
    ...recipe,
    playbook: override.playbook ?? recipe.playbook,
    allowedActions: recipe.allowedActions,
    skillIds: skillAllowed ? recipe.skillIds : recipe.skillIds,
  }
}

export function resolvedRecipe(id: MeetingProfileId, ledger: RecipeLedger = emptyRecipeLedger()): MeetingRecipe | undefined {
  const system = recipeById(id)
  if (!system) return undefined
  return applyOverride(system, ledger.overrides[id])
}

export function setRecipeOverride(ledger: RecipeLedger, override: RecipeOverride): RecipeLedger {
  return {
    ...ledger,
    overrides: {
      ...ledger.overrides,
      [override.recipeId]: override,
    },
  }
}

export function resetRecipe(ledger: RecipeLedger, id: MeetingProfileId): RecipeLedger {
  const overrides = { ...ledger.overrides }
  delete overrides[id]
  return { ...ledger, overrides }
}

export function overrideSurvivesUpgrade(
  stored: RecipeOverride,
  _systemVersion: number,
): RecipeOverride {
  return stored
}

export function cloneRecipe(
  recipe: MeetingRecipe,
  cloneId: string,
  requested?: {
    allowedActions?: readonly string[]
    skillIds?: readonly string[]
    roleIds?: readonly string[]
  },
): { ok: true; clone: RecipeClone } | { ok: false; reason: 'clone-privilege-escalation' } {
  const requestedActions = requested?.allowedActions ?? recipe.allowedActions
  const requestedSkills = requested?.skillIds ?? recipe.skillIds
  const requestedRoles = requested?.roleIds ?? recipe.roleIds
  const extraAction = requestedActions.some((action) => !recipe.allowedActions.includes(action as MeetingRecipeAction))
  const extraSkill = requestedSkills.some((skill) => !recipe.skillIds.includes(skill) || !catalogSkill(skill))
  const extraRole = requestedRoles.some((role) => !recipe.roleIds.includes(role as BuiltinMeetingAgentId))
  const forbidden = requestedActions.some((action) => action === 'crm.update' || action === 'action.external' || action === 'shell')
  if (extraAction || extraSkill || extraRole || forbidden) {
    return { ok: false, reason: 'clone-privilege-escalation' }
  }
  return {
    ok: true,
    clone: {
      from: recipe.id,
      id: cloneId,
      version: recipe.version,
      allowedActions: [...recipe.allowedActions],
      skillIds: [...recipe.skillIds],
      roleIds: [...recipe.roleIds],
    },
  }
}

/** @deprecated use cloneRecipe; kept for the original I019 RED names. */
export function escalateClone(
  recipe: MeetingRecipe,
  extraActions: readonly string[],
): { ok: false; reason: 'clone-privilege-escalation' } | RecipeClone {
  const result = cloneRecipe(recipe, `${recipe.id}-clone`, { allowedActions: extraActions })
  if (!result.ok) return result
  return result.clone
}

export function catalogSkill(skillId: string): boolean {
  return MEETING_AGENT_TOOL_NAMES.has(skillId) && isKnownSessionToolName(skillId)
}

export function bindRecipeJobs(
  recipe: MeetingRecipe,
  jobs: readonly RoleJob[],
): RecipeBoundJob[] {
  const roles = new Set(recipe.roleIds)
  const skills = new Set(recipe.skillIds)
  const bound: RecipeBoundJob[] = []
  for (const job of jobs) {
    if (!roles.has(job.roleId)) continue
    const allowedToolNames = job.allowedToolNames.filter((name) => skills.has(name))
    bound.push({
      ...job,
      allowedToolNames,
      hostTools: job.hostTools.filter((tool) => skills.has(tool.name)),
      recipeId: recipe.id,
      playbook: recipe.playbook,
      outputSchemaId: recipe.schema,
    })
  }
  return bound
}

function kindForRecipe(recipe: MeetingRecipe): string {
  for (const roleId of recipe.roleIds) {
    const role = builtinMeetingAgent(roleId)
    if (!role) continue
    const match = role.triggerKinds.find((kind) => recipe.triggers.includes(kind))
    if (match) return match
  }
  return recipe.triggers[0] ?? 'slash'
}

export function applyMeetingRecipe(
  event: MeetingEvent,
  recipeId: MeetingProfileId,
  options: { store?: MeetingAgentStore; ledger?: RecipeLedger } = {},
): { ok: true; jobs: RecipeBoundJob[]; recipe: MeetingRecipe } | { ok: false; code: 'unknown-recipe' | 'recipe-disabled' } {
  const recipe = resolvedRecipe(recipeId, options.ledger)
  if (!recipe) return { ok: false, code: 'unknown-recipe' }
  if (options.ledger?.overrides[recipeId]?.disabled) return { ok: false, code: 'recipe-disabled' }
  const routed = routeMeetingEvent(event, { store: options.store })
  return { ok: true, jobs: bindRecipeJobs(recipe, routed.jobs), recipe }
}

function slashJobs(
  recipe: MeetingRecipe,
  skillId: string,
  input: { meetingId: string; workspaceId: string; sourceSnapshot: MeetingSourceSnapshot },
): RecipeBoundJob[] {
  const jobs: RecipeBoundJob[] = []
  for (const roleId of recipe.roleIds) {
    const role = builtinMeetingAgent(roleId)
    if (!role || !role.skillIds.includes(skillId)) continue
    const allowed = role.skillIds.filter((name) => recipe.skillIds.includes(name))
    const hostTools = hostToolsForMeetingSkills(allowed)
    jobs.push({
      id: `slash:${recipe.id}:${role.id}`,
      eventId: `slash:${recipe.id}`,
      roleId: role.id,
      roleVersion: role.version,
      promptVersion: role.promptVersion,
      meetingId: input.meetingId,
      workspaceId: input.workspaceId,
      sourceSnapshot: { ...input.sourceSnapshot },
      capabilityIds: role.allowedCapabilityIds,
      allowedToolNames: hostTools.map((tool) => tool.name),
      hostTools,
      budget: { timeoutMs: role.timeoutMs },
      toolName: skillId,
      interactive: true,
      status: 'queued',
      recipeId: recipe.id,
      playbook: recipe.playbook,
      outputSchemaId: recipe.schema,
    })
  }
  return jobs
}

export type SlashInvokeResult =
  | {
    ok: true
    insertIntoChat: false
    skillId: string
    recipeId?: MeetingProfileId
    outputSchemaId: string
    playbook: string
    jobs: RecipeBoundJob[]
  }
  | { ok: false; insertIntoChat: false; code: 'unknown-skill' | 'skill-not-permitted' | 'recipe-disabled' }
  | { ok: false; insertIntoChat: true; code: 'not-slash' }

export function parseMeetingSlash(text: string): { token: string; rest: string } | null {
  const match = text.trim().match(/^\/([A-Za-z0-9._-]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { token: match[1], rest: match[2] ?? '' }
}

export function invokeMeetingSlash(
  text: string,
  input: {
    meetingId: string
    workspaceId: string
    sourceSnapshot: MeetingSourceSnapshot
    recipeId?: MeetingProfileId
    store?: MeetingAgentStore
    ledger?: RecipeLedger
  },
): SlashInvokeResult {
  const parsed = parseMeetingSlash(text)
  if (!parsed) return { ok: false, insertIntoChat: true, code: 'not-slash' }

  const recipeFromToken = recipeById(parsed.token)
  const recipe = recipeFromToken
    ?? (input.recipeId ? resolvedRecipe(input.recipeId, input.ledger) : undefined)
  const skillId = recipeFromToken
    ? recipeFromToken.skillIds[0]
    : parsed.token

  if (!catalogSkill(skillId)) {
    return { ok: false, insertIntoChat: false, code: 'unknown-skill' }
  }

  if (recipeFromToken && input.ledger?.overrides[recipeFromToken.id]?.disabled) {
    return { ok: false, insertIntoChat: false, code: 'recipe-disabled' }
  }

  if (recipe && !recipe.skillIds.includes(skillId)) {
    return { ok: false, insertIntoChat: false, code: 'skill-not-permitted' }
  }

  if (recipe) {
    const jobs = slashJobs(recipe, skillId, input)
    if (jobs.length === 0) {
      const applied = applyMeetingRecipe({
        id: `slash:${parsed.token}`,
        kind: kindForRecipe(recipe),
        meetingId: input.meetingId,
        workspaceId: input.workspaceId,
        sourceSnapshot: input.sourceSnapshot,
        interactive: true,
        final: true,
      }, recipe.id, input)
      if (!applied.ok) {
        return { ok: false, insertIntoChat: false, code: applied.code === 'recipe-disabled' ? 'recipe-disabled' : 'unknown-skill' }
      }
      return {
        ok: true,
        insertIntoChat: false,
        skillId,
        recipeId: recipe.id,
        outputSchemaId: recipe.schema,
        playbook: recipe.playbook,
        jobs: applied.jobs,
      }
    }
    return {
      ok: true,
      insertIntoChat: false,
      skillId,
      recipeId: recipe.id,
      outputSchemaId: recipe.schema,
      playbook: recipe.playbook,
      jobs,
    }
  }

  return { ok: false, insertIntoChat: false, code: 'unknown-skill' }
}

/** @deprecated name from the original I019 RED; prefers catalog membership. */
export function invokeSkill(skillId: string, installed: readonly string[]): { ok: true } | { ok: false; reason: 'unknown-skill' } {
  if (!installed.includes(skillId) || !catalogSkill(skillId)) return { ok: false, reason: 'unknown-skill' }
  return { ok: true }
}

export function clientCrmProposal(hasCrmCapability: boolean): { kind: 'proposal' } | { kind: 'blocked'; reason: 'no-crm' } {
  if (!hasCrmCapability) return { kind: 'blocked', reason: 'no-crm' }
  return { kind: 'proposal' }
}

export function proposeClientAnalysis(input: {
  hasCrmCapability: boolean
  notes: readonly ClientAnalysisNote[]
}):
  | { ok: true; kind: 'proposal'; status: 'proposed'; includedNoteIds: string[]; excludedPrivateIds: string[] }
  | { ok: false; code: 'no-crm'; fakeUpdate: false; includedNoteIds: []; excludedPrivateIds: string[] } {
  const privateNotes = input.notes.filter((note) => note.audience === 'private')
  const sharedNotes = input.notes.filter((note) => note.audience === 'shared')
  if (!input.hasCrmCapability) {
    return {
      ok: false,
      code: 'no-crm',
      fakeUpdate: false,
      includedNoteIds: [],
      excludedPrivateIds: privateNotes.map((note) => note.id),
    }
  }
  return {
    ok: true,
    kind: 'proposal',
    status: 'proposed',
    includedNoteIds: sharedNotes.map((note) => note.id),
    excludedPrivateIds: privateNotes.map((note) => note.id),
  }
}

export function readinessBlocker(state: {
  installed: boolean
  enabled: boolean
  authorized: boolean
  healthy: boolean
  running: boolean
}): AgentReadinessBlocker | null {
  if (!state.installed) return 'not-installed'
  if (!state.enabled) return 'disabled'
  if (!state.authorized) return 'unauthorized'
  if (!state.healthy) return 'unhealthy'
  return null
}

export function agentReadinessViews(
  workspaceId: string,
  store: MeetingAgentStore,
  probe: { available: boolean; reason?: string } = { available: true },
): AgentReadinessView[] {
  return readinessFor(workspaceId, store, probe).map((row) => ({
    ...row,
    blocker: readinessBlocker(row),
  }))
}

export function blockerI18nKey(blocker: AgentReadinessBlocker | null): string | null {
  if (!blocker) return null
  if (blocker === 'not-installed') return 'meetings.agentBlockerNotInstalled'
  if (blocker === 'disabled') return 'meetings.agentBlockerDisabled'
  if (blocker === 'unauthorized') return 'meetings.agentBlockerUnauthorized'
  return 'meetings.agentBlockerUnhealthy'
}
