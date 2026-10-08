import { CodedError } from '@rox/shared/protocol'
import { loadSource } from '@rox/shared/sources'
import { loadSkillBySlug } from '@rox/shared/skills'
import type { AgentProfileSnapshot } from '@rox/shared/workspace-work'
import { WorkspaceWorkStore } from './store.ts'
import { validateEntityId } from './validation.ts'

/** Internal host callers use this after their own workspace authorization. No snapshot accepted on the wire. */
export function captureAgentProfileSnapshot(rootPath: string, workspaceId: string, profileId?: string): AgentProfileSnapshot | undefined {
  const state = new WorkspaceWorkStore(rootPath, workspaceId).read()
  const id = profileId === undefined ? state.defaultProfileId : validateEntityId(profileId)
  if (!id) return undefined
  const p = state.profiles.find(profile => profile.id === id)
  if (!p || p.sourceSlugs.some(slug => !loadSource(rootPath, slug)) || p.skillSlugs.some(slug => !loadSkillBySlug(rootPath, slug))) {
    throw new CodedError('NOT_FOUND', 'Agent profile capability unavailable')
  }
  return { profileId: p.id, workspaceId: p.workspaceId, revision: p.revision, name: p.name, role: p.role,
    sourceSlugs: [...p.sourceSlugs], skillSlugs: [...p.skillSlugs], memoryScope: p.memoryScope,
    automationEnabled: p.automationEnabled, capturedAt: Date.now() }
}
