/**
 * PhaseBadge
 *
 * Colored badge indicating the phase/timing of an automation trigger event.
 * Derives from getEventCategory() to avoid duplicating event classification.
 */

import { useTranslation } from 'react-i18next'
import { getEventCategory, type AutomationTrigger, type EventCategory } from './types'
import { Info_Badge, type BadgeColor } from '@/components/info'

const CATEGORY_BADGE: Record<EventCategory, { labelKey: string; color: BadgeColor }> = {
  'scheduled':   { labelKey: 'sidebar.scheduled', color: 'success' },
  'agent-pre':   { labelKey: 'automations.phaseBefore', color: 'warning' },
  'agent-post':  { labelKey: 'automations.phaseAfter', color: 'success' },
  'agent-error': { labelKey: 'automations.phaseOnError', color: 'destructive' },
  'label':       { labelKey: 'automations.labelEvent', color: 'default' },
  'permission':  { labelKey: 'automations.labelEvent', color: 'default' },
  'flag':        { labelKey: 'automations.labelEvent', color: 'default' },
  'todo':        { labelKey: 'automations.labelEvent', color: 'default' },
  'session':     { labelKey: 'automations.labelEvent', color: 'default' },
  'other':       { labelKey: 'automations.labelEvent', color: 'default' },
}

export interface PhaseBadgeProps {
  event: AutomationTrigger
  className?: string
}

export function PhaseBadge({ event, className }: PhaseBadgeProps) {
  const { t } = useTranslation()
  const category = getEventCategory(event)
  const badge = CATEGORY_BADGE[category]

  return (
    <Info_Badge color={badge.color} className={className}>
      {t(badge.labelKey)}
    </Info_Badge>
  )
}
