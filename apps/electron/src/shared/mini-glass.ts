/**
 * Mini glass companion (#1500s) — constants shared by the main process and the
 * preload. The companion window is a floating surface, so its main→renderer
 * events travel through the typed transport (`WindowManager.pushToWindow`).
 */

/** Main→renderer event: clear the companion's state after the window hides. */
export const MINI_GLASS_RESET = 'mini-glass:reset'
