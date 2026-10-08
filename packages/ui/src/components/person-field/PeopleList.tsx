/**
 * PeopleList — searchable, keyboard-navigable people listbox shared by
 * PersonField (single select) and SubscribersPicker (multi select).
 *
 * Directory search is supplied by the host (`people` prop); this component
 * only filters locally by name/title so it stays transport-agnostic.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, SELECTED_TINT, initialsOf } from '../primitives/tokens'

export interface PersonOption {
  id: string
  name: string
  title?: string
  avatarUrl?: string
  /** Invitee who has not activated yet (UI-SPEC §14 "Placeholder"). */
  placeholder?: boolean
}

export function filterPeople(people: readonly PersonOption[], query: string): PersonOption[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return [...people]
  return people.filter((p) => p.name.toLocaleLowerCase().includes(q) || (p.title ?? '').toLocaleLowerCase().includes(q))
}

export function PersonAvatar({ person, size = 32 }: { person: Pick<PersonOption, 'name' | 'avatarUrl' | 'placeholder'>; size?: 20 | 24 | 32 }) {
  const dims = size === 32 ? 'size-8 text-[12px]' : size === 24 ? 'size-6 text-[10px]' : 'size-5 text-[9px]'
  if (person.avatarUrl) {
    return <img src={person.avatarUrl} alt="" aria-hidden="true" className={cn('shrink-0 rounded-full object-cover', dims, person.placeholder && 'opacity-60')} />
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-text-secondary',
        dims,
        person.placeholder ? 'border border-dashed border-border' : 'bg-foreground/[0.08]',
      )}
    >
      {initialsOf(person.name)}
    </span>
  )
}

export interface PeopleListProps {
  people: readonly PersonOption[]
  /** Ids rendered as selected (`aria-selected`). */
  selectedIds?: ReadonlySet<string>
  multi?: boolean
  onPick: (person: PersonOption) => void
  onEscape?: () => void
  autoFocus?: boolean
  className?: string
}

export function PeopleList({ people, selectedIds, multi = false, onPick, onEscape, autoFocus, className }: PeopleListProps) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const listId = React.useId()
  const visible = React.useMemo(() => filterPeople(people, query), [people, query])
  const clampedActive = Math.min(active, Math.max(0, visible.length - 1))

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(0, visible.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      const person = visible[clampedActive]
      if (person) {
        event.preventDefault()
        onPick(person)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onEscape?.()
    }
  }

  return (
    <div className={cn('flex w-[280px] flex-col gap-1 p-1', className)}>
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={onKeyDown}
        placeholder={t('entities.ui.person.search')}
        aria-label={t('entities.ui.person.search')}
        aria-controls={listId}
        aria-activedescendant={visible[clampedActive] ? `${listId}-${visible[clampedActive]!.id}` : undefined}
        className={cn('h-8 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] placeholder:text-text-muted', FOCUS_RING)}
      />
      <ul id={listId} role="listbox" aria-multiselectable={multi || undefined} aria-label={t('entities.ui.person.search')} className="max-h-[240px] overflow-y-auto">
        {visible.length === 0 ? (
          <li role="presentation" className="px-2 py-2 text-[12px] text-text-muted">{t('entities.ui.person.noResults')}</li>
        ) : visible.map((person, index) => {
          const selected = selectedIds?.has(person.id) ?? false
          return (
            <li
              key={person.id}
              id={`${listId}-${person.id}`}
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => { e.preventDefault(); onPick(person) }}
              className={cn('flex h-9 cursor-default items-center gap-2 rounded-[6px] px-2', HOVER_TINT, index === clampedActive && SELECTED_TINT)}
            >
              <PersonAvatar person={person} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{person.name}</span>
                {person.title ? <span className="block truncate text-[11px] text-text-muted">{person.title}</span> : null}
              </span>
              {person.placeholder ? <span className="shrink-0 text-[10px] text-text-muted">{t('entities.ui.person.invited')}</span> : null}
              {multi ? <span aria-hidden="true" className={cn('shrink-0 text-[12px]', selected ? 'text-accent' : 'text-transparent')}>✓</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
