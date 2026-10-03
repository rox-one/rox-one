/** Retained recipe/slash/followup intent, with no authority or effect claims. */
import { BUILTIN_MEETING_AGENTS, type BuiltinMeetingAgentId } from './catalog.ts'
import { recipeById, type MeetingProfileId, type RecipeOverride } from './recipes.ts'
import { compileMeetingFollowupMatcher, cronMatchesAt, meetingFollowupOccurrenceKey } from '../automations/meeting-followup.ts'
import { Cron } from 'croner'
import type { MeetingFollowupKind } from '../automations/types.ts'

const PROFILE_ROLES: Record<MeetingProfileId, readonly BuiltinMeetingAgentId[]> = {
  standup: ['rox.meeting.scribe', 'rox.meeting.followup'],
  discovery: ['rox.meeting.assist', 'rox.meeting.scribe'],
  'design-review': ['rox.meeting.knowledge', 'rox.meeting.scribe'],
  client: ['rox.meeting.analyst', 'rox.meeting.scribe'],
  'project-review': ['rox.meeting.analyst', 'rox.meeting.scribe', 'rox.meeting.followup'],
}
export type FollowupPlanningInput = {
  id: string; kind: MeetingFollowupKind; timezone: string; cron?: string;
  expiresAt: number; budgetRemaining: number; missedRunPolicy: 'skip' | 'catch-up-once' | 'hold';
  maxRetries: number; retryCount?: number; scope: 'device' | 'server';
  optOut?: boolean; calendarCanceled?: boolean; deviceAvailable?: boolean; missed?: boolean;
}
export type MeetingPlanInput = {
  meetingId: string; recipeId?: MeetingProfileId; slash?: string;
  /** Local preference only; this can never grant execution rights. */
  override?: RecipeOverride; followup?: FollowupPlanningInput;
}
export type MeetingRecipeJobPlan = {
  roleId: BuiltinMeetingAgentId; definitionVersion: number; promptVersion: number;
  skillIds: readonly string[]; playbook: string; outputSchemaId: string;
  allowedActions: readonly string[]; status: 'planned';
}
export type MeetingActionPlan = {
  meetingId: string; sourceRevision: number; recipeId: MeetingProfileId;
  playbook: string; outputSchemaId: string; outputs: readonly string[];
  jobs: MeetingRecipeJobPlan[];
  execution: { allowed: false; reason: 'meeting-backend-delegation-unavailable'; verified: false };
  followup?: {
    occurrenceKey: string; due: boolean; policy: string;
    matcher: ReturnType<typeof compileMeetingFollowupMatcher>;
    execution: { allowed: false; reason: 'followup-principal-executor-unavailable'; verified: false };
  };
}
export class MeetingPlanningError extends Error {
  constructor(readonly code: string) { super(code) }
}
export function parseMeetingSlash(text: string): { token: string; rest: string } | null {
  const match = text.trim().match(/^\/([A-Za-z0-9._-]+)(?:\s+([\s\S]*))?$/)
  return match ? { token: match[1]!, rest: match[2] ?? '' } : null
}
export function bindRecipeJobs(recipeId: MeetingProfileId, override?: RecipeOverride): MeetingRecipeJobPlan[] {
  const recipe = recipeById(recipeId)
  if (!recipe) throw new MeetingPlanningError('unknown-recipe')
  if (override && override.recipeId !== recipe.id) throw new MeetingPlanningError('override-recipe-mismatch')
  if (override?.disabled) throw new MeetingPlanningError('recipe-disabled')
  if (override?.extraActions?.some(action => !recipe.allowedActions.includes(action))) {
    throw new MeetingPlanningError('clone-privilege-escalation')
  }
  return PROFILE_ROLES[recipe.id].map(roleId => {
    const role = BUILTIN_MEETING_AGENTS.find(candidate => candidate.id === roleId)!
    if (override?.skillId && override.skillId !== recipe.skillId && !role.skillIds.includes(override.skillId)) {
      throw new MeetingPlanningError('skill-not-permitted')
    }
    return { roleId, definitionVersion: role.version, promptVersion: role.promptVersion,
      skillIds: [...role.skillIds], playbook: recipe.playbook, outputSchemaId: recipe.schema,
      allowedActions: [...recipe.allowedActions], status: 'planned' as const }
  })
}
export function invokeMeetingSlash(text: string, selectedId: MeetingProfileId): MeetingProfileId {
  const parsed = parseMeetingSlash(text)
  if (!parsed) throw new MeetingPlanningError('not-slash')
  const explicit = recipeById(parsed.token)
  if (explicit) return explicit.id
  const selected = recipeById(selectedId)
  if (!selected) throw new MeetingPlanningError('unknown-recipe')
  const allowed = bindRecipeJobs(selectedId).flatMap(job => job.skillIds)
  if (parsed.token !== selected.skillId && !allowed.includes(parsed.token)) {
    const known = BUILTIN_MEETING_AGENTS.some(role => role.skillIds.includes(parsed.token)) ||
      Object.keys(PROFILE_ROLES).some(id => recipeById(id)?.skillId === parsed.token)
    throw new MeetingPlanningError(known ? 'skill-not-permitted' : 'unknown-skill')
  }
  return selectedId
}
function followupPlan(input: FollowupPlanningInput, now: number): NonNullable<MeetingActionPlan['followup']> {
  if (!input || typeof input.id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(input.id) ||
    typeof input.timezone !== 'string' || !input.timezone || input.timezone.length > 128 ||
    (input.cron !== undefined && (typeof input.cron !== 'string' || input.cron.length > 512)) ||
    !['prepare', 'finalize', 'promise-check', 'send', 'capture'].includes(input.kind) ||
    !['skip', 'catch-up-once', 'hold'].includes(input.missedRunPolicy) ||
    !['device', 'server'].includes(input.scope) || !Number.isFinite(input.expiresAt) ||
    !Number.isSafeInteger(input.budgetRemaining) || input.budgetRemaining < 0 ||
    !Number.isSafeInteger(input.maxRetries) || input.maxRetries < 1 || input.maxRetries > 20 ||
    (input.retryCount !== undefined && (!Number.isSafeInteger(input.retryCount) || input.retryCount < 0))) {
    throw new MeetingPlanningError('invalid-followup')
  }
  let key: string
  try { key = meetingFollowupOccurrenceKey(input.id, now, input.timezone) }
  catch { throw new MeetingPlanningError('invalid-timezone') }
  const matcher = compileMeetingFollowupMatcher(input)
  // A proposed configuration is not an enabled authenticated executor.
  matcher.enabled = false
  try { new Cron(matcher.cron!, { timezone: input.timezone }).nextRun(new Date(now)) }
  catch { throw new MeetingPlanningError('invalid-cron') }
  const due = cronMatchesAt(matcher.cron!, now, input.timezone)
  let policy = 'planned'
  if (input.optOut) policy = 'opt-out'
  else if (input.calendarCanceled && ['prepare', 'capture'].includes(input.kind)) policy = 'calendar-canceled'
  else if (input.expiresAt <= now) policy = 'expired'
  else if (input.budgetRemaining === 0) policy = 'budget-exhausted'
  else if ((input.retryCount ?? 0) >= input.maxRetries) policy = 'max-retries'
  else if (input.missed && input.missedRunPolicy !== 'catch-up-once') policy = `missed-${input.missedRunPolicy}`
  else if (input.scope === 'device' && input.deviceAvailable === false) policy = 'waiting_device'
  else if (input.kind === 'send') policy = 'send-requires-fresh-grant'
  else if (!due && !input.missed) policy = 'not-due'
  return { occurrenceKey: key, due, policy, matcher,
    execution: { allowed: false, reason: 'followup-principal-executor-unavailable', verified: false } }
}
export function planMeetingActions(input: MeetingPlanInput, sourceRevision: number, now = Date.now()): MeetingActionPlan {
  const recipeId = input.slash === undefined ? input.recipeId ?? 'standup' : invokeMeetingSlash(input.slash, input.recipeId ?? 'standup')
  const recipe = recipeById(recipeId)
  if (!recipe) throw new MeetingPlanningError('unknown-recipe')
  const jobs = bindRecipeJobs(recipeId, input.override)
  return { meetingId: input.meetingId, sourceRevision, recipeId, playbook: recipe.playbook,
    outputSchemaId: recipe.schema, outputs: [...recipe.outputs], jobs,
    execution: { allowed: false, reason: 'meeting-backend-delegation-unavailable', verified: false },
    ...(input.followup ? { followup: followupPlan(input.followup, now) } : {}) }
}
