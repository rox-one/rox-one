/**
 * PersonField (W1-08, UI-SPEC §4; Operately sidebar person field).
 *
 * Avatar 32 + bold name + dimmed title. Empty state is a "Set ⟨role⟩"
 * button. Clicking opens a PeopleList picker fed by the host directory
 * (`candidates`). An optional ⓘ help text explains the role (Champion /
 * Reviewer). Read-only fields render without any interactive control.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST, POPOVER_SURFACE } from '../primitives/tokens'
import { PeopleList, PersonAvatar, type PersonOption } from './PeopleList'

export type PersonRole = 'champion' | 'reviewer'

export interface PersonFieldProps {
  /** Built-in Operately role (drives label + help) or a custom label. */
  role: PersonRole | { label: string; help?: string }
  person?: PersonOption | null
  candidates?: readonly PersonOption[]
  onChange?: (person: PersonOption | null) => void
  readOnly?: boolean
  /** Start with the picker open (stories / tests). */
  defaultOpen?: boolean
  className?: string
}

export function PersonField({ role, person, candidates = [], onChange, readOnly, defaultOpen = false, className }: PersonFieldProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(defaultOpen)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const roleLabel = typeof role === 'string' ? t(`entities.ui.person.${role}`) : role.label
  const help = typeof role === 'string' ? t(`entities.ui.person.${role}Help`) : role.help
  const interactive = !readOnly && !!onChange

  const close = () => { setOpen(false); triggerRef.current?.focus() }

  const body = person ? (
    <span className="flex min-w-0 items-center gap-2">
      <PersonAvatar person={person} />
      <span className="min-w-0 text-left">
        <span className="block truncate text-[13px] font-semibold">{person.name}</span>
        {person.placeholder
          ? <span className="block truncate text-[11px] text-text-muted">{t('entities.ui.person.invited')}</span>
          : person.title ? <span className="block truncate text-[11px] text-text-muted">{person.title}</span> : null}
      </span>
    </span>
  ) : (
    <span className="text-[13px] text-text-muted">{interactive ? t('entities.ui.person.set', { role: roleLabel }) : t('entities.ui.person.empty')}</span>
  )

  return (
    <div className={cn('relative flex flex-col gap-1', className)} data-person-role={typeof role === 'string' ? role : 'custom'}>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span>{roleLabel}</span>
        {help ? (
          <button
            type="button"
            aria-label={help}
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Escape') setHelpOpen(false) }}
            className={cn('inline-flex size-4 items-center justify-center rounded-full text-[10px] text-text-muted hover:text-text-secondary', FOCUS_RING)}
          >
            ⓘ
          </button>
        ) : null}
      </div>
      {helpOpen && help ? <div role="note" className="max-w-[320px] text-[12px] normal-case text-text-secondary">{help}</div> : null}
      {interactive ? (
        <div className="flex items-center gap-1">
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={person ? t('entities.ui.person.change', { role: roleLabel }) : t('entities.ui.person.set', { role: roleLabel })}
            onClick={() => setOpen((v) => !v)}
            className={cn('flex min-h-10 min-w-0 flex-1 items-center rounded-[6px] px-1.5 py-1', HOVER_TINT, MOTION_FAST, FOCUS_RING)}
          >
            {body}
          </button>
          {person ? (
            <button
              type="button"
              aria-label={t('entities.ui.person.clear')}
              onClick={() => onChange?.(null)}
              className={cn('size-6 shrink-0 rounded-[6px] text-text-muted hover:text-foreground', FOCUS_RING)}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-10 items-center px-1.5 py-1">{body}</div>
      )}
      {open && interactive ? (
        <div className={cn('absolute left-0 top-full z-20 mt-1', POPOVER_SURFACE)}>
          <PeopleList
            people={candidates}
            selectedIds={person ? new Set([person.id]) : undefined}
            autoFocus
            onEscape={close}
            onPick={(picked) => { onChange?.(picked); close() }}
          />
        </div>
      ) : null}
    </div>
  )
}
