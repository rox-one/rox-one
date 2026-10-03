import type { PersonalTask, VersionedPersonalTask } from '@rox/core/tasks/personal'
import type { PersonalTasksApi } from '../../../../../lib/personal-tasks-sync'
import { samePersonalTask } from './index'

export type PersonalTaskLinkErrorCode = 'revision-conflict' | 'write-unconfirmed' | 'readback-failed'

/** Stable reconciliation reason; user-facing copy belongs to the Tasks UI. */
export class PersonalTaskLinkError extends Error {
  constructor(readonly code: PersonalTaskLinkErrorCode) {
    super(code)
    this.name = 'PersonalTaskLinkError'
  }
}

/** Native CAS and read-back for the existing task→session link; no new RPC. */
export async function commitPersonalTaskLink(
  api: Pick<PersonalTasksApi, 'personalTasksList' | 'personalTasksPut'>,
  task: PersonalTask,
  sessionId: string,
  expectedRevision: number | null,
): Promise<VersionedPersonalTask> {
  const before = await api.personalTasksList()
  if ((before.revisions[task.id] ?? null) !== expectedRevision) throw new PersonalTaskLinkError('revision-conflict')
  const linked = structuredClone(task)
  if (!linked.links.some(link => link.kind === 'session' && link.id === sessionId)) linked.links.push({ kind: 'session', id: sessionId })
  const receipt = await api.personalTasksPut([{ task: linked, expectedRevision }])
  const accepted = receipt.accepted.length === 1 ? receipt.accepted[0] : undefined
  if (!accepted || receipt.conflicts.length || receipt.rejected.length || !samePersonalTask(linked, accepted.task)
    || !Number.isSafeInteger(accepted.revision) || accepted.revision < 1) throw new PersonalTaskLinkError('write-unconfirmed')
  const after = await api.personalTasksList()
  const saved = after.tasks.find(entry => entry.id === linked.id)
  if (!saved || after.revisions[linked.id] !== accepted.revision || !samePersonalTask(linked, saved)) throw new PersonalTaskLinkError('readback-failed')
  return { task: saved, revision: accepted.revision }
}
