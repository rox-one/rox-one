import type { IpcMain } from 'electron'
import type { WindowManager } from './window-manager'
import { readBoundWindowWorkspace } from './bootstrap-window-workspace'
import { registerNativeReplicaIpc, type NativeReplicaCredentialStore } from './native-replica'

export interface NativeReplicaBootstrapDependencies {
  configDir: string
  credentials: NativeReplicaCredentialStore
  getWindowManager(): Pick<WindowManager, 'getWindowByWebContentsId' | 'getWorkspaceForWindow' | 'getWorkspaceGenerationForWindow'> | null
}

/** Local encrypted Notes custody is needed by full and thin Electron clients. */
export function registerNativeReplicaForWindows(ipc: IpcMain, dependencies: NativeReplicaBootstrapDependencies): () => void {
  return registerNativeReplicaIpc(ipc, {
    configDir: dependencies.configDir,
    credentials: dependencies.credentials,
    getWorkspaceForWindow: id => dependencies.getWindowManager()?.getWorkspaceForWindow(id) ?? null,
    getWorkspaceForRenderer: event => readBoundWindowWorkspace(event, dependencies.getWindowManager()) || null,
    getWorkspaceGenerationForWindow: id => dependencies.getWindowManager()?.getWorkspaceGenerationForWindow(id) ?? null,
  })
}
