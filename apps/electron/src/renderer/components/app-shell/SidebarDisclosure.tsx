/**
 * Zen Shell sidebar disclosure (ZS-04).
 *
 * Group headers are a single toggle button. Navigable parents keep a
 * non-interactive row with two siblings: navigation + disclosure. No nested
 * buttons and no span-only interactivity.
 */

import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export function sidebarSectionDomId(linkId: string): string {
  return `sidebar-section-${linkId.replace(/[^A-Za-z0-9_-]+/g, '-')}`
}

export function isNavigableExpandable(link: { expandable?: boolean; onClick?: () => void }): boolean {
  return Boolean(link.expandable && link.onClick)
}

export function restoreFocusToToggle(body: HTMLElement | null, toggle: HTMLElement | null): void {
  if (!body || !toggle) return
  const active = globalThis.document?.activeElement
  if (active && body.contains(active)) {
    toggle.focus()
  }
}

export function SidebarDisclosureChevron({ expanded }: { expanded: boolean }) {
  const Icon = expanded ? ChevronDown : ChevronRight
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
}

export interface SidebarDisclosureButtonProps {
  expanded: boolean
  sectionId: string
  sectionTitle: string
  onToggle: () => void
}

export const SidebarDisclosureButton = React.forwardRef<HTMLButtonElement, SidebarDisclosureButtonProps>(
  function SidebarDisclosureButton({ expanded, sectionId, sectionTitle, onToggle }, ref) {
    const { t } = useTranslation()
    const label = expanded
      ? t('sidebar.disclosure.collapse', { section: sectionTitle })
      : t('sidebar.disclosure.expand', { section: sectionTitle })

    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'sidebar-disclosure flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px]',
          'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
          expanded
            ? 'opacity-40 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(pointer:coarse)]:opacity-100'
            : 'opacity-100',
        )}
        aria-expanded={expanded}
        aria-controls={sectionId}
        aria-label={label}
        title={label}
        data-no-dnd="true"
        data-touch-reveal="true"
        onClick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          onToggle()
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onContextMenu={(event) => {
          event.stopPropagation()
        }}
      >
        <SidebarDisclosureChevron expanded={expanded} />
      </button>
    )
  },
)
