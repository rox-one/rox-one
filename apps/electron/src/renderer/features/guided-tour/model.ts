/**
 * Guided tour (spotlight / "shadow screen" onboarding) — pure model.
 *
 * A short orientation tour shown once after the first-run wizard: a dimmed
 * overlay with a cut-out around one UI element at a time and a tooltip card.
 * Targets are resolved by `data-tour="guide.*"` first, then by stable legacy
 * hooks (`data-tutorial`, `data-testid`, section ids) so other branches that
 * restyle the shell keep working. A step whose target is absent or invisible
 * is skipped; a step with no selectors is shown as a centred card.
 *
 * This is deliberately separate from `features/product-tour` (the evidence-
 * based learning runtime, gated by `feature-product-tour-v1`, off by default).
 */

export const GUIDED_TOUR_VERSION = 1
export const GUIDED_TOUR_START_EVENT = 'rox:guided-tour:start'

export interface GuidedTourStep {
  readonly id: string
  /** Ordered selectors; the first visible match wins. Empty → centred card. */
  readonly selectors: readonly string[]
  readonly titleKey: string
  readonly bodyKey: string
}

export const GUIDED_TOUR_STEPS: readonly GuidedTourStep[] = [
  { id: 'welcome', selectors: [], titleKey: 'guidedTour.welcome.title', bodyKey: 'guidedTour.welcome.body' },
  {
    id: 'navigation',
    selectors: ['[data-tour="guide.sidebar-nav"]', '[data-sidebar-primary-nav]'],
    titleKey: 'guidedTour.navigation.title', bodyKey: 'guidedTour.navigation.body',
  },
  {
    id: 'tools',
    selectors: ['[data-tour="guide.sidebar-tools"]', '[data-sidebar-tools]'],
    titleKey: 'guidedTour.tools.title', bodyKey: 'guidedTour.tools.body',
  },
  {
    id: 'pills',
    selectors: ['[data-tour="guide.pills"]', '[data-testid="titlebar-mode-pill"]'],
    titleKey: 'guidedTour.pills.title', bodyKey: 'guidedTour.pills.body',
  },
  {
    id: 'agent',
    selectors: ['[data-tour="guide.agent"]', '[data-testid="titlebar-mode-pill"] [data-mode="agent"]'],
    titleKey: 'guidedTour.agent.title', bodyKey: 'guidedTour.agent.body',
  },
  {
    id: 'new-chat',
    selectors: ['[data-tour="guide.new-chat"]', '[data-tutorial="new-chat-button"]'],
    titleKey: 'guidedTour.newChat.title', bodyKey: 'guidedTour.newChat.body',
  },
  {
    id: 'composer',
    selectors: ['[data-tour="guide.composer"]', '[data-tutorial="chat-input"]'],
    titleKey: 'guidedTour.composer.title', bodyKey: 'guidedTour.composer.body',
  },
  {
    id: 'cloud',
    selectors: ['[data-tour="guide.cloud"]'],
    titleKey: 'guidedTour.cloud.title', bodyKey: 'guidedTour.cloud.body',
  },
  { id: 'search', selectors: [], titleKey: 'guidedTour.search.title', bodyKey: 'guidedTour.search.body' },
  {
    id: 'profile',
    selectors: ['[data-tour="guide.profile"]', '[data-tutorial="profile-strip"]'],
    titleKey: 'guidedTour.profile.title', bodyKey: 'guidedTour.profile.body',
  },
]

export type GuidedTourStatus = 'completed' | 'skipped'
export interface GuidedTourRecord { readonly status: GuidedTourStatus; readonly version: number; readonly at: number }

export function parseGuidedTourRecord(value: unknown): GuidedTourRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<GuidedTourRecord>
  if ((record.status !== 'completed' && record.status !== 'skipped') || typeof record.version !== 'number') return null
  return { status: record.status, version: record.version, at: typeof record.at === 'number' ? record.at : 0 }
}

/** Auto-start only when the tour of the current version was never finished or skipped. */
export function shouldAutoStartGuidedTour(record: unknown): boolean {
  const parsed = parseGuidedTourRecord(record)
  return !parsed || parsed.version < GUIDED_TOUR_VERSION
}

export interface RectLike { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** A target is usable when it is connected and has a non-empty box intersecting the viewport. */
export function isUsableRect(rect: RectLike | null, viewport: { width: number; height: number }): boolean {
  if (!rect || rect.width < 2 || rect.height < 2) return false
  return rect.left < viewport.width && rect.top < viewport.height && rect.left + rect.width > 0 && rect.top + rect.height > 0
}

export interface TargetQuery { (selector: string): RectLike | null }

/** Resolve a step's target rect; `undefined` = centred step, `null` = missing (skip). */
export function resolveStepRect(step: GuidedTourStep, query: TargetQuery, viewport: { width: number; height: number }): RectLike | null | undefined {
  if (step.selectors.length === 0) return undefined
  for (const selector of step.selectors) {
    const rect = query(selector)
    if (isUsableRect(rect, viewport)) return rect
  }
  return null
}

/**
 * Next showable index from `from` moving in `direction`, skipping steps whose
 * target is missing. Returns -1 when the tour runs off either end.
 */
export function findShowableIndex(
  steps: readonly GuidedTourStep[], from: number, direction: 1 | -1,
  isShowable: (step: GuidedTourStep) => boolean,
): number {
  for (let index = from; index >= 0 && index < steps.length; index += direction) {
    if (isShowable(steps[index]!)) return index
  }
  return -1
}

/** Card placement next to a highlighted rect, clamped to the viewport. */
export function placeCard(
  rect: RectLike | undefined, card: { width: number; height: number }, viewport: { width: number; height: number }, gap = 12,
): { left: number; top: number; side: 'center' | 'right' | 'left' | 'bottom' | 'top' } {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))
  const margin = 12
  if (!rect) return { left: (viewport.width - card.width) / 2, top: (viewport.height - card.height) / 2, side: 'center' }
  const centreY = clamp(rect.top + rect.height / 2 - card.height / 2, margin, viewport.height - card.height - margin)
  const centreX = clamp(rect.left + rect.width / 2 - card.width / 2, margin, viewport.width - card.width - margin)
  if (rect.left + rect.width + gap + card.width + margin <= viewport.width && rect.width < viewport.width / 2) {
    return { left: rect.left + rect.width + gap, top: centreY, side: 'right' }
  }
  if (rect.top + rect.height + gap + card.height + margin <= viewport.height) {
    return { left: centreX, top: rect.top + rect.height + gap, side: 'bottom' }
  }
  if (rect.top - gap - card.height >= margin) return { left: centreX, top: rect.top - gap - card.height, side: 'top' }
  if (rect.left - gap - card.width >= margin) return { left: rect.left - gap - card.width, top: centreY, side: 'left' }
  return { left: (viewport.width - card.width) / 2, top: (viewport.height - card.height) / 2, side: 'center' }
}

/** Request the tour from anywhere (profile popover, command palette). */
export function requestGuidedTour(target: Pick<Window, 'dispatchEvent'> = window): void {
  target.dispatchEvent(new Event(GUIDED_TOUR_START_EVENT))
}
