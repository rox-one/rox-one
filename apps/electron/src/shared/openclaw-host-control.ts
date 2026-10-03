/** Optional native host controls visible to renderer typechecking only. */
export interface OpenClawHostControlApi {
  openControlUi(input: { workspaceId: string }): Promise<void>
  copyGatewayTokenForSetup(input: { workspaceId: string }): Promise<void>
}

declare global {
  interface Window {
    /** Installed only by a native Electron preload attached to the local host. */
    openClawHostControl?: OpenClawHostControlApi
  }
}
