/**
 * Mode Bar — static application modes (ADR-0001), rendered as ONE centered
 * segmented pill in the titlebar. Every registered mode lives in the pill
 * (no overflow menu); the active one gets an accent-tinted segment that
 * slides between items.
 *
 * Modes with `rootRoute: null` render disabled with a tooltip. They are not
 * empty pages.
 *
 * Styling lives in `components/app-shell/titlebar-mode-pill.css` (plain CSS);
 * Tailwind utility classes in this component are covered by the renderer scan.
 * The pill uses `-webkit-app-region: no-drag`; the surrounding titlebar stays draggable.
 */
import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  BookOpen,
  Calendar,
  Home,
  Inbox,
  ListTodo,
  MessageSquare,
  NotebookPen,
  Rss,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { isModeNavigable, type ModeContribution } from '@craft-agent/core/platform'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
import type { Route } from '../../shared/routes'
import { getModeRegistry } from './mode-registry-bootstrap'
import { CORE_MODES, resolveSeededModes } from './modes-seed'
import { modeScreenFlagsAtom } from '@/atoms/mode-flags'
import { useInboxBlockingCount } from '@/hooks/useInboxItems'
import { handleModePillKeyDown } from './mode-pill-keyboard'

const MODE_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Calendar,
  Home,
  Inbox,
  ListTodo,
  MessageSquare,
  NotebookPen,
  Rss,
}

const seedById = new Map(CORE_MODES.map((mode) => [mode.contribution.id, mode]))

export interface ModeBarMetrics {
  /** Pill width with icons + labels. */
  full: number
  /** Pill width with icons only. */
  compact: number
}

export interface ModeBarProps {
  /** Icon-only segments (labels move into tooltips). */
  collapsed?: boolean
  /** Reports the natural pill widths so the titlebar can decide when to collapse. */
  onMeasure?: (metrics: ModeBarMetrics) => void
}

function PillItems({
  modes,
  activeId,
  collapsed,
  interactive,
  itemRefs,
  badges,
}: {
  modes: readonly ModeContribution[]
  activeId: string | null
  collapsed: boolean
  interactive: boolean
  itemRefs?: MutableRefObject<Map<string, HTMLButtonElement>>
  /** Per-mode counters (Входящие: requests blocking an agent). */
  badges?: Readonly<Record<string, number>>
}) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  return (
    <>
      {modes.map((mode) => {
        const Icon = MODE_ICONS[mode.icon] ?? Inbox
        const title = t(mode.titleKey)
        const disabled = !isModeNavigable(mode)
        const active = mode.id === activeId
        const badge = disabled ? 0 : badges?.[mode.id] ?? 0
        const button = (
          <button
            key={mode.id}
            ref={itemRefs ? (el) => {
              if (el) itemRefs.current.set(mode.id, el)
              else itemRefs.current.delete(mode.id)
            } : undefined}
            type="button"
            tabIndex={interactive && !disabled ? undefined : -1}
            data-mode={mode.id}
            aria-label={badge ? `${title} · ${t('workbench.mode.badge', { count: badge })}` : title}
            aria-current={active ? 'page' : undefined}
            aria-disabled={disabled || undefined}
            onClick={!interactive || disabled ? undefined : () => {
              if (mode.rootRoute) void navigate(mode.rootRoute as Route)
            }}
            className="rox-mode-pill-item titlebar-no-drag"
          >
            <Icon className="rox-mode-pill-icon" strokeWidth={1.75} aria-hidden />
            {!collapsed && <span className="rox-mode-pill-label">{title}</span>}
            {badge > 0 && <span className="rox-mode-pill-badge" aria-hidden>{badge > 99 ? '99+' : badge}</span>}
          </button>
        )
        if (!interactive) return button
        // Expanded + available: the label is visible, so no tooltip noise.
        if (!collapsed && !disabled) return button
        return (
          <Tooltip key={mode.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="bottom">
              {disabled ? `${title} · ${t('workbench.mode.unavailable')}` : title}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </>
  )
}

export function ModeBar({ collapsed = false, onMeasure }: ModeBarProps = {}) {
  const { t, i18n } = useTranslation()
  const navState = useNavigationState()
  const flags = useAtomValue(modeScreenFlagsAtom)
  const modes = resolveSeededModes(getModeRegistry().list(), flags)
  const activeId = modes.find((mode) => seedById.get(mode.id)?.isActive(navState))?.id ?? null
  const inboxBlocking = useInboxBlockingCount()
  const badges = { inbox: inboxBlocking }

  const navRef = useRef<HTMLElement | null>(null)
  const fullGhostRef = useRef<HTMLDivElement | null>(null)
  const compactGhostRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null)
  const [ready, setReady] = useState(false)

  const modeKey = modes.map((mode) => `${mode.id}:${mode.rootRoute ? 1 : 0}`).join('|')

  // Sliding indicator geometry follows the active segment.
  const syncIndicator = useCallback(() => {
    const el = activeId ? itemRefs.current.get(activeId) : undefined
    setIndicator((prev) => {
      if (!el) return prev === null ? prev : null
      const next = { x: el.offsetLeft, w: el.offsetWidth }
      return prev && prev.x === next.x && prev.w === next.w ? prev : next
    })
  }, [activeId])

  useLayoutEffect(() => {
    syncIndicator()
  }, [syncIndicator, collapsed, modeKey, i18n.language])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => syncIndicator())
    observer.observe(nav)
    return () => observer.disconnect()
  }, [syncIndicator])

  // Enable the slide transition only after the first placement so the
  // indicator never animates in from x=0 on mount.
  useLayoutEffect(() => {
    if (ready || !indicator) return
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, ready])

  // Natural widths for the titlebar's collapse decision (fonts may load late).
  useLayoutEffect(() => {
    const full = fullGhostRef.current
    const compact = compactGhostRef.current
    if (!full || !compact || !onMeasure) return
    let last = ''
    const report = () => {
      const metrics = {
        full: Math.ceil(full.getBoundingClientRect().width),
        compact: Math.ceil(compact.getBoundingClientRect().width),
      }
      const key = `${metrics.full}:${metrics.compact}`
      if (key === last) return
      last = key
      onMeasure(metrics)
    }
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(full)
    observer.observe(compact)
    return () => observer.disconnect()
  }, [onMeasure, modeKey, i18n.language])

  return (
    <>
      <nav
        ref={navRef}
        aria-label={t('workbench.modes')}
        className="rox-mode-pill titlebar-no-drag"
        data-collapsed={collapsed || undefined}
        data-ready={ready || undefined}
        data-testid="titlebar-mode-pill"
        onKeyDown={handleModePillKeyDown}
      >
        <span
          aria-hidden
          className="rox-mode-pill-indicator"
          data-visible={indicator ? true : undefined}
          style={indicator ? { width: indicator.w, transform: `translateX(${indicator.x}px)` } : undefined}
        />
        <PillItems modes={modes} activeId={activeId} collapsed={collapsed} interactive itemRefs={itemRefs} badges={badges} />
      </nav>
      {onMeasure && (
        <>
          <div ref={fullGhostRef} aria-hidden className="rox-mode-pill rox-mode-pill-ghost">
            <PillItems modes={modes} activeId={null} collapsed={false} interactive={false} badges={badges} />
          </div>
          <div ref={compactGhostRef} aria-hidden className="rox-mode-pill rox-mode-pill-ghost" data-collapsed>
            <PillItems modes={modes} activeId={null} collapsed interactive={false} badges={badges} />
          </div>
        </>
      )}
    </>
  )
}
