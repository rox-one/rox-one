/**
 * ⌘K «Переместить»: filterable list of destinations — lists, areas,
 * projects (personal and workspace) and headings. ↑/↓ + Enter.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Overlay } from './parts'

export interface MoveDestination {
  id: string
  label: string
  group: string
  hint?: string
  indent?: boolean
}

export function MoveDialog({
  title,
  destinations,
  onPick,
  onClose,
}: {
  title: string
  destinations: MoveDestination[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? destinations.filter((d) => `${d.label} ${d.group} ${d.hint ?? ''}`.toLowerCase().includes(q)) : destinations
  }, [destinations, query])
  React.useEffect(() => { setActive(0) }, [query])
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  let lastGroup = ''
  return (
    <Overlay onClose={onClose} label={title} width={420} testId="tasks-move-dialog">
      <div className="px-3 pb-2 pt-3">
        <div className="pb-1.5 text-[11px] uppercase tracking-wide text-text-muted">{title}</div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((i) => Math.min(filtered.length - 1, i + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const pick = filtered[active]
              if (pick) onPick(pick.id)
            }
          }}
          placeholder={t('tasks.move.placeholder')}
          aria-label={t('tasks.move.placeholder')}
          className="h-8 w-full rounded-[var(--radius-overlay)] bg-foreground/[0.05] px-2 text-[13px] outline-none placeholder:text-text-muted"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" role="listbox" aria-label={title}>
        {filtered.length === 0 ? <div className="px-2 py-3 text-[12px] text-text-muted">{t('tasks.move.none')}</div> : null}
        {filtered.map((dest, index) => {
          const header = dest.group !== lastGroup ? dest.group : null
          lastGroup = dest.group
          return (
            <React.Fragment key={dest.id}>
              {header ? <div className="px-2 pb-0.5 pt-2 text-[11px] uppercase tracking-wide text-text-muted">{header}</div> : null}
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                data-index={index}
                onMouseEnter={() => setActive(index)}
                onClick={() => onPick(dest.id)}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] outline-none',
                  dest.indent && 'pl-6',
                  index === active ? 'bg-accent/15 font-semibold ring-2 ring-inset ring-accent' : 'hover:bg-foreground/[0.05]',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{dest.label}</span>
                {dest.hint ? <span className="shrink-0 text-[11px] text-text-muted">{dest.hint}</span> : null}
              </button>
            </React.Fragment>
          )
        })}
      </div>
    </Overlay>
  )
}
