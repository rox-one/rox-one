/**
 * W1-07 (#1504) — host for the unified mode roots (`messenger`, `calendar`,
 * `goals`; `contacts` was merged into Команда in W3.3).
 *
 * The page comes from the `<surface>.page` slot: the first visible
 * contribution (lowest `order`) wins, so a package ships its screen by
 * registering into the slot — no shell edit. Until then the host renders an
 * i18n'd empty state and nothing else (UI-SPEC §14 "Empty").
 *
 * Reachable while the surface's `workbench.mode.<id>.v1` flag is on, and for
 * the merged `calendar`/`messenger` surfaces also through the legacy
 * `meetings`/`contacts` aliases (see `shared/surface-routes.ts`).
 */
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, MessagesSquare, Target, type LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/mode-screen/ModeScreen'
import type { UnifiedSurfaceId } from '../../shared/surface-routes'
import { useSlotContributions } from './useSlots'
import type { SlotId } from './slots'
// Registers the merged surface pages (calendar ← Встречи, messenger ← Команда)
// into the slot registry (W3.2/W3.3).
import './surface-pages'

export interface SurfacePageProps {
  surface: UnifiedSurfaceId
  /**
   * Calendar only: the meeting selected through the legacy
   * `meetings/meeting/{id}` alias (W3.2), or null/undefined.
   */
  meetingId?: string | null
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
      className="flex h-full min-h-0 flex-col items-center justify-center bg-background font-sans text-base text-foreground"
      data-testid={`surface-empty-${surface}`}
      data-surface={surface}
    >
      <Icon className="mb-2 h-12 w-12 text-text-muted" strokeWidth={1.25} aria-hidden />
      <EmptyState title={t(titleKey)} body={t(bodyKey)} />
    </div>
  )
}

export function SurfaceHost({ surface, meetingId }: SurfacePageProps) {
  const pages = useSlotContributions<SurfacePagePayload>(surfacePageSlot(surface))
  const Page = pages.find((page) => page.payload?.component)?.payload?.component
  return Page ? <Page surface={surface} meetingId={meetingId} /> : <SurfaceEmptyState surface={surface} />
}

export default SurfaceHost
