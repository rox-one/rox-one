import type { PersonalTask, VersionedPersonalTask } from '@rox/core/tasks/personal'
import type { LoadedProject } from '@rox/shared/projects/types'
import type { Session } from '@rox/shared/protocol/dto'
import type { CapabilitySnapshot, TourSignal } from '../../../contracts'
import type { TourObservation } from '../../../runtime/hooks'

/** Compare locally; task text and session content never enter a tour signal. */
export function samePersonalTask(left: PersonalTask, right: PersonalTask): boolean {
  const canonical = (task: PersonalTask) => JSON.stringify(task, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value)
  return canonical(left) === canonical(right)
}

function signal(observation: TourObservation, name: TourSignal['name'], level: TourSignal['level'], at: number): TourSignal {
  const base = { name, binding: observation.binding, operationToken: observation.operationToken,
    operationStartedAt: observation.at, eventToken: crypto.randomUUID(), at }
  return level === 'verified' ? { ...base, level, origin: 'native-commit' } : { ...base, level, origin: 'ui-observation' }
}

/** Only an actually rendered native project in the bound workspace counts. */
export function deriveProjectSignals(
  observation: TourObservation | null,
  project: LoadedProject | null,
  visible: boolean,
  at = Date.now(),
): readonly TourSignal[] {
  if (!observation || !visible || !project || project.workspaceId !== observation.binding.workspaceId) return []
  return [signal(observation, 'project.visible', 'observed', at)]
}

export interface PersonalTaskEvidence {
  readonly kind: 'created' | 'delegated'
  readonly expected: PersonalTask
  /** Canonical native record, read back after the accepted write. */
  readonly persisted: VersionedPersonalTask | null
  readonly session?: Session | null
  readonly sessionId?: string
  /** The delegated prompt is present in the native session's user messages. */
  readonly promptAccepted?: boolean
}

export function derivePersonalTaskSignals(
  observation: TourObservation | null,
  evidence: PersonalTaskEvidence,
  at = Date.now(),
): readonly TourSignal[] {
  const record = evidence.persisted
  if (!observation || !record || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !samePersonalTask(evidence.expected, record.task)) return []
  if (evidence.kind === 'created') return [signal(observation, 'personal-task.persisted', 'verified', at)]
  const session = evidence.session
  if (!session || session.id !== evidence.sessionId || !evidence.promptAccepted || session.workspaceId !== observation.binding.workspaceId
    || !record.task.links.some(link => link.kind === 'session' && link.id === session.id)) return []
  return [signal(observation, 'personal-task.delegated', 'verified', at)]
}

export function tasksProjectsCapabilities(input: {
  readonly projectsApi: boolean
  readonly personalTasksApi: boolean
  readonly syncState: 'local' | 'syncing' | 'synced' | 'error'
  readonly delegationApi: boolean
  readonly workspacePresent: boolean
  readonly taskPresent: boolean
  readonly taskTrashed?: boolean
}): CapabilitySnapshot {
  const storage = !input.personalTasksApi ? { state: 'unavailable', reason: 'api-unavailable' } as const
    : input.syncState === 'error' ? { state: 'unavailable', reason: 'storage-unavailable' } as const
      : input.syncState !== 'synced' ? { state: 'pending', reason: 'installing' } as const : { state: 'ready' } as const
  return {
    'projects.available': input.projectsApi && input.workspacePresent
      ? { state: 'ready' } : { state: 'unavailable', reason: 'api-unavailable' },
    'personal-tasks.available': storage,
    'task.delegation-available': storage.state !== 'ready' ? storage
      : !input.workspacePresent || !input.delegationApi ? { state: 'unavailable', reason: 'api-unavailable' }
        : !input.taskPresent || input.taskTrashed ? { state: 'unavailable', reason: 'missing-entity' }
          : { state: 'ready' },
  }
}
