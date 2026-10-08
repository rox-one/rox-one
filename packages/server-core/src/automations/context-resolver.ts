import type { AutomationContextReference } from '@rox/shared/automations/types'
import type { AutomationContextResolution } from '@rox/shared/automations/context'
import { resolveLocalAutomationContextReference } from '@rox/shared/automations/context-storage'
import { WorkspaceWorkStore } from '../workspace-work/store'

export function resolveWorkspaceAutomationContext(root: string, workspaceId: string, reference: AutomationContextReference): AutomationContextResolution {
  if (reference.workspaceId !== workspaceId || reference.object?.kind !== 'task') {
    return resolveLocalAutomationContextReference(root, workspaceId, reference)
  }
  try {
    const project = resolveLocalAutomationContextReference(root, workspaceId, { workspaceId, projectId: reference.projectId })
    if (project.status !== 'available') return project
    const resolution = new WorkspaceWorkStore(root, workspaceId).resolveTask(reference.object.id)
    if (resolution.status !== 'available') return resolution
    return { status: 'available', workspaceId: resolution.task.workspaceId, projectId: resolution.task.project?.id, objectId: resolution.task.id }
  } catch { return { status: 'unavailable' } }
}
