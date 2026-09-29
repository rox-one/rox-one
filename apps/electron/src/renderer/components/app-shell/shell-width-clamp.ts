/**
 * Clamp restored sidebar/navigator widths so the session/center column keeps
 * its minimum when the window is wide enough to allow it.
 *
 * Persisted widths are never rewritten here: this only computes the widths to
 * display. The session list (navigator) yields first, then the sidebar, each
 * down to its own minimum. When even the minimums don't leave `centerMin`
 * (a genuinely narrow window) the columns stay at their minimums and the
 * center takes what is left.
 */
export interface ShellColumnClampInput {
  shellWidth: number
  /** Width taken by fixed chrome in the same row (activity rail, inspector rail). */
  reserved: number
  sidebar: number
  navigator: number
  sidebarVisible: boolean
  navigatorVisible: boolean
  sidebarMin: number
  navigatorMin: number
  centerMin: number
}

export function clampShellColumns(input: ShellColumnClampInput): { sidebar: number; navigator: number } {
  const { shellWidth, reserved, sidebar, navigator, sidebarMin, navigatorMin, centerMin } = input
  if (!(shellWidth > 0)) return { sidebar, navigator }

  const used = reserved
    + (input.sidebarVisible ? sidebar : 0)
    + (input.navigatorVisible ? navigator : 0)
  let deficit = used + centerMin - shellWidth
  if (deficit <= 0) return { sidebar, navigator }

  let nextNavigator = navigator
  let nextSidebar = sidebar
  if (input.navigatorVisible) {
    const give = Math.min(deficit, Math.max(0, navigator - navigatorMin))
    nextNavigator = navigator - give
    deficit -= give
  }
  if (deficit > 0 && input.sidebarVisible) {
    const give = Math.min(deficit, Math.max(0, sidebar - sidebarMin))
    nextSidebar = sidebar - give
  }
  return { sidebar: Math.round(nextSidebar), navigator: Math.round(nextNavigator) }
}
