import type { ZenShellSnapshot } from '../../shared/shell-appearance'
import { subscribeDesktopShellAppearance } from './shell-appearance-subscription'

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

type RenderProfileAPI = Parameters<typeof subscribeDesktopShellAppearance>[0]

/**
 * First-frame guess before main's snapshot arrives: the preload exposes no
 * synchronous profile, but on Windows `auto` (the default) resolves to
 * `performance`, so a Windows desktop window starts low-power and the first
 * snapshot corrects it if the user chose otherwise. Everything else waits
 * for the snapshot and keeps the standard look meanwhile.
 */
export function seedRenderProfile(
  root: HTMLElement,
  api: Pick<NonNullable<RenderProfileAPI>, 'getRuntimeEnvironment'> | undefined,
  userAgent: string,
): void {
  if (root.hasAttribute('data-render-profile')) return
  if (api?.getRuntimeEnvironment?.() !== 'electron') return
  if (/\bWindows\b/.test(userAgent)) root.setAttribute('data-render-profile', 'performance')
}

let stopActiveSync: (() => void) | null = null

/**
 * Root-level owner of `data-render-profile`, started by `main.tsx` before the
 * first React render so loading, onboarding, reauth and workspace-picker
 * screens follow the profile without waiting for AppShell. Restarting (HMR)
 * replaces the previous subscription, so there is never more than one.
 * `useShellAppearance` also writes the same attribute from the same snapshot,
 * which is idempotent.
 */
export function startRenderProfileSync(api: RenderProfileAPI, root: HTMLElement): () => void {
  stopActiveSync?.()
  const stop = subscribeDesktopShellAppearance(api, snapshot => applyRenderProfile(root, snapshot), () => {})
  stopActiveSync = stop
  return () => {
    stop()
    if (stopActiveSync === stop) stopActiveSync = null
  }
}
