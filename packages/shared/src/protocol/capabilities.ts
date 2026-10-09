/**
 * Protocol capability tokens — named actions a peer can perform on behalf of
 * another (wire contract, advertised in the handshake `features.capabilities`).
 *
 * Single source of truth: `@rox/server-core/transport/capabilities` re-exports
 * these constants so existing `CLIENT_*` imports keep working.
 */

/** Capability: open a URL in the client's default browser. */
export const CLIENT_OPEN_EXTERNAL = 'client:openExternal'

/** Capability: open a file with the OS default application. */
export const CLIENT_OPEN_PATH = 'client:openPath'

/** Capability: reveal a file in Finder / Explorer. */
export const CLIENT_SHOW_IN_FOLDER = 'client:showItemInFolder'

/** Capability: show a confirmation dialog (message box) on the client. */
export const CLIENT_CONFIRM_DIALOG = 'client:confirmDialog'

/** Capability: show a native file/folder picker on the client. */
export const CLIENT_OPEN_FILE_DIALOG = 'client:openFileDialog'

/** Capability: drive a local `BrowserPaneManager` instance for a remote agent. */
export const CLIENT_BROWSER_INVOKE = 'client:browser:invoke'

/** All capabilities a local Electron client advertises on handshake. */
export const PROTOCOL_CLIENT_CAPABILITIES: readonly string[] = [
  CLIENT_OPEN_EXTERNAL,
  CLIENT_OPEN_PATH,
  CLIENT_SHOW_IN_FOLDER,
  CLIENT_CONFIRM_DIALOG,
  CLIENT_OPEN_FILE_DIALOG,
  CLIENT_BROWSER_INVOKE,
]