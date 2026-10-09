/**
 * Browser-pane session partition id.
 *
 * Kept free of Electron imports so proxy configuration can read the constant
 * without pulling in the browser-pane manager's Electron surface.
 */
export const BROWSER_PANE_SESSION_PARTITION = 'persist:browser-pane'