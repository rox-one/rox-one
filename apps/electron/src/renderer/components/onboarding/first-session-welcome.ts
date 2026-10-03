import type { Session } from '../../../shared/types'

/** Recheck the active caller and workspace after each transport await. */
export async function openFirstSessionWelcome(ports: {
  workspaceId: string
  isCurrent(): boolean
  getWindowWorkspace(): Promise<string | null>
  ensureWelcome(workspaceId: string): Promise<Session | null>
  onSession(session: Session): void
  onOpen(sessionId: string): void
}): Promise<void> {
  if (!ports.isCurrent()) return
  if (await ports.getWindowWorkspace() !== ports.workspaceId || !ports.isCurrent()) return
  const session = await ports.ensureWelcome(ports.workspaceId)
  if (!session || !ports.isCurrent()) return
  if (await ports.getWindowWorkspace() !== ports.workspaceId || !ports.isCurrent()) return
  ports.onSession(session)
  ports.onOpen(session.id)
}
