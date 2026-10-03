/** Named exports for Bun handler tests; suites override the APIs they exercise. */
export const electronMockExports = {
  app: {
    isPackaged: false, getAppPath: () => '/', getPath: () => '/tmp',
    quit() {}, dock: { setIcon() {}, setBadge() {} },
  },
  ipcMain: { handle() {}, on() {} },
  BrowserWindow: class {
    static fromWebContents() { return null }
    static getFocusedWindow() { return null }
    static getAllWindows() { return [] }
  },
  BrowserView: class {},
  WebContentsView: class {},
  nativeTheme: { shouldUseDarkColors: false, shouldUseHighContrastColors: false, prefersReducedTransparency: false },
  systemPreferences: { getUserDefault: () => false },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromDataURL: () => ({}) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {} },
  Menu: { buildFromTemplate: () => ({ popup() {} }) },
  session: { fromPartition: () => ({ cookies: { set: async () => {} } }) },
  Notification: class {},
  powerSaveBlocker: { start: () => 1, stop() {}, isStarted: () => false },
  globalShortcut: { register: () => false, unregister() {} },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
  webContents: { fromId: () => null },
  protocol: { handle() {} },
  clipboard: { readText: () => '', writeText() {} },
}
