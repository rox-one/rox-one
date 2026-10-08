/**
 * PrivacyField (W1-08, UI-SPEC §4 "PrivacyField").
 *
 * Operately access levels: "Only invited people" · "Everyone in ⟨space⟩ can
 * view / comment / edit" · "Everyone in the company can view / comment /
 * edit". Docs add the Lark link options (`includeLinkOptions`). Space
 * options are only shown when a space name is known.
 *
 * Native radio inputs keep arrow-key navigation and screen-reader semantics.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST, SELECTED_TINT } from '../primitives/tokens'

export const PRIVACY_LEVELS = [
  'invited',
  'space-view',
  'space-comment',
  'space-edit',
  'company-view',
  'company-comment',
  'company-edit',
  'link-view',
  'link-edit',
] as const

export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number]

const LABEL_KEY: Record<PrivacyLevel, string> = {
  invited: 'entities.ui.privacy.invited',
  'space-view': 'entities.ui.privacy.spaceView',
  'space-comment': 'entities.ui.privacy.spaceComment',
  'space-edit': 'entities.ui.privacy.spaceEdit',
  'company-view': 'entities.ui.privacy.companyView',
  'company-comment': 'entities.ui.privacy.companyComment',
  'company-edit': 'entities.ui.privacy.companyEdit',
  'link-view': 'entities.ui.privacy.linkView',
  'link-edit': 'entities.ui.privacy.linkEdit',
}

/** Levels offered for a context (pure; exported for tests). */
export function availablePrivacyLevels(opts: { spaceName?: string; includeLinkOptions?: boolean }): PrivacyLevel[] {
  return PRIVACY_LEVELS.filter((level) => {
    if (level.startsWith('space-')) return !!opts.spaceName
    if (level.startsWith('link-')) return !!opts.includeLinkOptions
    return true
  })
}

export interface PrivacyFieldProps {
  value: PrivacyLevel
  onChange?: (value: PrivacyLevel) => void
  spaceName?: string
  includeLinkOptions?: boolean
  readOnly?: boolean
  className?: string
}

export function PrivacyField({ value, onChange, spaceName, includeLinkOptions, readOnly, className }: PrivacyFieldProps) {
  const { t } = useTranslation()
  const name = React.useId()
  const levels = availablePrivacyLevels({ spaceName, includeLinkOptions })
  const labelFor = (level: PrivacyLevel) => t(LABEL_KEY[level], { space: spaceName ?? '' })

  if (readOnly || !onChange) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('entities.ui.privacy.label')}</span>
        <span className="text-[13px]">{labelFor(value)}</span>
      </div>
    )
  }

  return (
    <fieldset className={cn('flex flex-col gap-0.5', className)}>
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('entities.ui.privacy.label')}</legend>
      {levels.map((level) => {
        const checked = value === level
        return (
          <label key={level} className={cn('flex h-8 cursor-default items-center gap-2 rounded-[6px] px-2 text-[13px]', HOVER_TINT, MOTION_FAST, checked && SELECTED_TINT)}>
            <input
              type="radio"
              name={name}
              value={level}
              checked={checked}
              onChange={() => onChange(level)}
              className={cn('size-3.5 accent-[var(--accent)]', FOCUS_RING)}
            />
            <span>{labelFor(level)}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
