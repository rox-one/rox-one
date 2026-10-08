/**
 * W1-10 (#1507) — visual snapshot runner plan.
 *
 * Matrix from PLAN W1-10 v2 gates + TECH-SPEC §7 + UI-SPEC §2.6: viewports
 * 1440×900 and 1280×800, both UI profiles (`rox`, `se`), light/dark themes,
 * RU/EN locales, hover + focus-visible + motion keyframes (start/mid/end)
 * under a fixed clock, plus reduced-motion variants. This module builds the
 * deterministic plan; executing it needs a browser driver (Playwright),
 * which wave-2 E2E provides — without one the gate reports pending.
 */

export const VISUAL_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
] as const

export const VISUAL_PROFILES = ['rox', 'se'] as const
export const VISUAL_THEMES = ['light', 'dark'] as const
export const VISUAL_LOCALES = ['ru', 'en'] as const
export const VISUAL_MOTION_FRAMES = ['start', 'mid', 'end'] as const

/** Fixed clock (ms since epoch) pinned for every snapshot. */
export const FIXED_CLOCK_ISO = '2026-10-08T09:00:00.000Z'
export const FIXED_CLOCK_MS = Date.parse(FIXED_CLOCK_ISO)

export interface VisualSnapshotPlan {
  screenId: string
  viewport: (typeof VISUAL_VIEWPORTS)[number]
  profile: (typeof VISUAL_PROFILES)[number]
  theme: (typeof VISUAL_THEMES)[number]
  locale: (typeof VISUAL_LOCALES)[number]
  state: 'default' | 'hover' | 'focus-visible' | 'motion-start' | 'motion-mid' | 'motion-end' | 'reduced-motion'
  clockMs: number
}

const STATES: VisualSnapshotPlan['state'][] = [
  'default',
  'hover',
  'focus-visible',
  'motion-start',
  'motion-mid',
  'motion-end',
  'reduced-motion',
]

export function planVisualSnapshots(screenIds: string[]): VisualSnapshotPlan[] {
  const plan: VisualSnapshotPlan[] = []
  for (const screenId of screenIds) {
    for (const viewport of VISUAL_VIEWPORTS) {
      for (const profile of VISUAL_PROFILES) {
        for (const theme of VISUAL_THEMES) {
          for (const locale of VISUAL_LOCALES) {
            for (const state of STATES) {
              plan.push({ screenId, viewport, profile, theme, locale, state, clockMs: FIXED_CLOCK_MS })
            }
          }
        }
      }
    }
  }
  return plan
}

/** Snapshots per screen: 2 viewports × 2 profiles × 2 themes × 2 locales × 7 states. */
export const SNAPSHOTS_PER_SCREEN =
  VISUAL_VIEWPORTS.length *
  VISUAL_PROFILES.length *
  VISUAL_THEMES.length *
  VISUAL_LOCALES.length *
  STATES.length
