import type { WorkspaceWorkState, WorkBlockConflict, AgentProfileSnapshot } from './types.ts'

export function emptyWorkspaceWorkState(workspaceId: string): WorkspaceWorkState {
  return { schemaVersion: 1, workspaceId, revision: 0, defaultProfileId: null,
    profiles: [], tasks: [], comments: [], workBlocks: [], tombstones: [] }
}

export function assertProfileSources(profile: AgentProfileSnapshot | undefined | null, sourceSlugs: readonly string[]): void {
  if (profile && sourceSlugs.some(slug => !profile.sourceSlugs.includes(slug))) throw new Error('Source outside captured agent profile')
}
export function assertProfileSkills(profile: AgentProfileSnapshot | undefined | null, skillSlugs: readonly string[]): void {
  if (profile && skillSlugs.some(slug => !profile.skillSlugs.includes(slug))) throw new Error('Skill outside captured agent profile')
}

/** Half-open blocks: adjacent slots do not conflict. Same person may own many blocks per task. */
export function workBlockConflicts(state: WorkspaceWorkState): WorkBlockConflict[] {
  const tasks = new Map(state.tasks.map(task => [task.id, task]))
  const blocks = [...state.workBlocks].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id))
  const conflicts: WorkBlockConflict[] = []
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i]!
    const taskA = tasks.get(a.taskId)
    if (!taskA) continue
    const owner = taskA.assigneeId ?? taskA.authorId
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j]!
      if (b.startAt >= a.endAt) break
      const taskB = tasks.get(b.taskId)
      if (!taskB || (taskB.assigneeId ?? taskB.authorId) !== owner) continue
      conflicts.push({ firstBlockId: a.id, secondBlockId: b.id, assigneeId: owner,
        startAt: Math.max(a.startAt, b.startAt), endAt: Math.min(a.endAt, b.endAt) })
    }
  }
  return conflicts
}
