export function createLearningScopeKey(clientProfileId: string, workspaceId: string): string {
  return JSON.stringify([clientProfileId, workspaceId])
}
