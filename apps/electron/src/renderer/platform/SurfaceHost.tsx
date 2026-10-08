/**
 * W1-07 (#1504) — host for the unified mode roots (`messenger`, `calendar`,
 * `goals`, `contacts`).
 *
 * The page comes from the `<surface>.page` slot: the first visible
 * contribution (lowest `order`) wins, so a wave-2 package ships its screen by
 * registering into the slot — no shell edit. Until then the host renders an
 * i18n'd empty state and nothing else (UI-SPEC §14 "Empty").
 *
 * Reachable only while the surface's `workbench.mode.<id>.v1` flag is on (the
 * route gate in `shared/surface-routes.ts`).
 */
import { useEffect, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Contact, MessagesSquare, Target, type LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/mode-screen/ModeScreen'
import type { UnifiedSurfaceId } from '../../shared/surface-routes'
import { useSlotContributions } from './useSlots'
import type { SlotId } from './slots'
import { markSurfaceMounted } from './surface-activity'

export interface SurfacePageProps {
  surface: UnifiedSurfaceId
}

/** Payload of a `<surface>.page` slot contribution. */
export interface SurfacePagePayload {
  component: ComponentType<SurfacePageProps>
}

export function surfacePageSlot(surface: UnifiedSurfaceId): SlotId {
  return `${surface}.page`
}

const SURFACE_ICONS: Record<UnifiedSurfaceId, LucideIcon> = {
  messenger: MessagesSquare,
  calendar: CalendarDays,
  goals: Target,
  contacts: Contact,
}

/** i18n keys of a surface's empty state (all 12 locales; RU default). */
export function surfaceEmptyStateKeys(surface: UnifiedSurfaceId): { titleKey: string; bodyKey: string } {
  return { titleKey: `surfaces.${surface}.emptyTitle`, bodyKey: `surfaces.${surface}.emptyBody` }
}

export function SurfaceEmptyState({ surface }: SurfacePageProps) {
  const { t } = useTranslation()
  const Icon = SURFACE_ICONS[surface]
  const { titleKey, bodyKey } = surfaceEmptyStateKeys(surface)
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center bg-background font-sans text-[13px] text-foreground"
      data-testid={`surface-empty-${surface}`}
      data-surface={surface}
    >
      <Icon className="mb-2 h-12 w-12 text-text-muted" strokeWidth={1.25} aria-hidden />
      <EmptyState title={t(titleKey)} body={t(bodyKey)} />
    </div>
  )
}

export function SurfaceHost({ surface }: SurfacePageProps) {
  // Messenger-only shortcuts (`when: messengerActive`) read this.
  useEffect(() => markSurfaceMounted(surface), [surface])
  const pages = useSlotContributions<SurfacePagePayload>(surfacePageSlot(surface))
  const Page = pages.find((page) => page.payload?.component)?.payload?.component
  return Page ? <Page surface={surface} /> : <SurfaceEmptyState surface={surface} />
}

export default SurfaceHost
