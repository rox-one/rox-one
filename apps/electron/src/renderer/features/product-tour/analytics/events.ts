import type { EvidenceLevel, Phase, SafeReason, StepId, TourId } from '../contracts'

export const LEARNING_EVENT_NAMES = ['tour-started', 'tour-paused', 'tour-resumed', 'tour-dismissed', 'tour-finished',
  'step-shown', 'step-acknowledged', 'step-observed', 'step-verified', 'step-skipped', 'step-not-applicable',
  'step-blocked', 'storage-unavailable', 'lease-lost'] as const
export type LearningEventName = typeof LEARNING_EVENT_NAMES[number]
export interface SafeLearningEvent {
  readonly eventName: LearningEventName
  readonly tourId?: TourId
  readonly stepId?: StepId
  readonly version?: number
  readonly tourVersion?: number
  readonly stepVersion?: number
  readonly phase?: Phase
  readonly evidenceLevel?: EvidenceLevel
  readonly reason?: SafeReason
  readonly platform?: 'darwin' | 'win32' | 'linux' | 'web' | 'macos' | 'windows'
  readonly locale?: string
  readonly shellVariant?: 'regular' | 'compact' | 'rail'
  readonly durationBucket?: '<1s' | '1-5s' | '5-15s' | '15-60s' | '1-5m' | '>=5m'
}
export const LEARNING_STEP_IDS: readonly StepId[] = ['sources.ask', 'agents.budget', 'agents.overview', 'approval.inspect', 'approval.resolve',
  'attachments.add', 'attachments.review', 'automation.action', 'automation.control', 'automation.trigger', 'connections.audit',
  'connections.services', 'cwd.inspect', 'feed.read', 'feed.sources', 'first.compose', 'first.execution', 'first.permissions', 'first.result',
  'first.send', 'first.session', 'inbox.queue', 'inbox.triage', 'learning.controls', 'learning.library', 'meetings.list', 'meetings.result',
  'memory.inspect', 'memory.save', 'memory.scope', 'models.picker', 'models.settings', 'notes.create', 'notes.save', 'pages.open', 'pages.state',
  'parallel.new', 'parallel.return', 'project.link', 'project.open', 'search.open', 'search.query', 'skills.explain', 'skills.select', 'sources.details',
  'sources.result', 'sources.select', 'sources.status', 'tasks.create', 'tasks.delegate', 'voice.review', 'voice.start', 'workflow.board',
  'workflow.label', 'workflow.status', 'workspace.scope']
export const LEARNING_SAFE_REASONS: readonly SafeReason[] = ['user-paused', 'user-dismissed', 'scope-changed', 'focus-lost', 'modal-open', 'target-missing',
  'ambiguous-target', 'target-occluded', 'route-timeout', 'unsupported-platform', 'api-unavailable', 'not-authorized', 'installing',
  'not-connected', 'network-unavailable', 'missing-entity', 'storage-unavailable', 'lease-lost', 'operation-failed', 'correlation-ambiguous']
const enums = {
  eventName: LEARNING_EVENT_NAMES,
  stepId: LEARNING_STEP_IDS,
  phase: ['idle', 'preparing', 'locating', 'presenting', 'waiting-action', 'handed-off', 'paused', 'blocked', 'finished'],
  evidenceLevel: ['acknowledged', 'observed', 'verified'],
  reason: LEARNING_SAFE_REASONS,
  platform: ['darwin', 'win32', 'linux', 'web', 'macos', 'windows'],
  locale: ['ar', 'de', 'en', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-Hans', 'zh-Hant'],
  shellVariant: ['regular', 'compact', 'rail'],
  durationBucket: ['<1s', '1-5s', '5-15s', '15-60s', '1-5m', '>=5m'],
} as const

/** Rebuild from finite enums; never spread a signal, binding, error or event into a logger. */
export function sanitizeLearningEvent(input: unknown): SafeLearningEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input)
    const source: Record<string, unknown> = Object.create(null)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor.enumerable && Object.hasOwn(descriptor, 'value')) source[key] = descriptor.value
    }
    if (!LEARNING_EVENT_NAMES.includes(source.eventName as LearningEventName)) return null
    const output: Record<string, unknown> = {}
    for (const [key, values] of Object.entries(enums)) {
      if ((values as readonly unknown[]).includes(source[key])) output[key] = source[key]
    }
    if (typeof source.tourId === 'string' && /^OBT-(0[1-9]|1[0-9]|2[0-5])$/.test(source.tourId)) output.tourId = source.tourId
    for (const key of ['version', 'tourVersion', 'stepVersion']) {
      if (Number.isSafeInteger(source[key]) && (source[key] as number) > 0) output[key] = source[key]
    }
    return output as unknown as SafeLearningEvent
  } catch { return null }
}
