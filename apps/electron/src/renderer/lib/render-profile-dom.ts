import type { ZenShellSnapshot } from '../../shared/shell-appearance'

/**
 * PERF-07: mirror main's rendering profile on `<html data-render-profile>`.
 * `performance` switches the CSS in `index.css` (LOW-POWER RENDERING PROFILE)
 * to solid tints, no backdrop blur and reduced motion. Anything else,
 * including an older main without the field, keeps the standard look.
 */
export function applyRenderProfile(root: HTMLElement, snapshot: Pick<ZenShellSnapshot, 'renderProfile'> | null | undefined): void {
  if (snapshot?.renderProfile === 'performance') {
    root.setAttribute('data-render-profile', 'performance')
  } else {
    root.removeAttribute('data-render-profile')
  }
}
