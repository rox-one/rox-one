/**
 * Small flat primitives for the Project roadmap screen: sections, borderless
 * auto-growing fields, compact buttons and editable checklists. No borders, no
 * hardcoded fonts — radius tokens (rounded-md/lg) and the 4px grid only.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { roadmapId, type RoadmapItem } from '@craft-agent/shared/projects/roadmap'

export function Section({
  id,
  title,
  count,
  hint,
  actions,
  children,
  className,
}: {
  id: string
  title: React.ReactNode
  count?: number
  hint?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={`project-section-${id}`} data-testid={`project-section-${id}`} className={cn('min-w-0 scroll-mt-4', className)}>
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="text-[13px] font-semibold text-foreground/90">{title}</h3>
        {typeof count === 'number' && count > 0 ? (
          <span className="text-[12px] tabular-nums text-muted-foreground">{count}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {hint ? <p className="mb-2 text-[12px] leading-5 text-muted-foreground">{hint}</p> : null}
      <div className="mt-1 min-w-0">{children}</div>
    </section>
  )
}

/** Borderless textarea that grows with its content. Commits on blur. */
export function AutoTextarea({
  value,
  onCommit,
  placeholder,
  className,
  minRows = 1,
  ariaLabel,
  testId,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  className?: string
  minRows?: number
  ariaLabel?: string
  testId?: string
}) {
  const [draft, setDraft] = React.useState(value)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => setDraft(value), [value])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={draft}
      aria-label={ariaLabel}
      data-testid={testId}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft.trim())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
      className={cn(
        'block w-full resize-none overflow-hidden rounded-md bg-transparent px-2 py-1.5 text-[13px] leading-5 text-foreground outline-none transition-colors',
        'placeholder:text-muted-foreground/70 hover:bg-foreground/[0.03] focus:bg-foreground/[0.04]',
        className,
      )}
    />
  )
}

/** Borderless single-line input. Enter/blur commits, Escape reverts. */
export function InlineInput({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
  testId,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
  autoFocus?: boolean
  testId?: string
}) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  return (
    <input
      value={draft}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      data-testid={testId}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value) onCommit(draft.trim())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={cn(
        'h-7 min-w-0 w-full rounded-md bg-transparent px-2 text-[13px] text-foreground outline-none transition-colors',
        'placeholder:text-muted-foreground/70 hover:bg-foreground/[0.03] focus:bg-foreground/[0.04]',
        className,
      )}
    />
  )
}

/** Input that adds an entry on Enter and clears itself. */
export function AddRow({
  placeholder,
  onAdd,
  className,
  testId,
}: {
  placeholder: string
  onAdd: (text: string) => void
  className?: string
  testId?: string
}) {
  const [draft, setDraft] = React.useState('')
  return (
    <div className={cn('flex items-center gap-1 rounded-md px-1 text-muted-foreground focus-within:bg-foreground/[0.04] hover:bg-foreground/[0.03]', className)}>
      <Plus className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <input
        value={draft}
        data-testid={testId}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onAdd(draft.trim())
            setDraft('')
          }
          if (e.key === 'Escape') setDraft('')
        }}
        className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  )
}

export function IconButton({
  label,
  onClick,
  children,
  className,
  disabled,
  testId,
}: {
  label: string
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function TextButton({
  onClick,
  children,
  className,
  disabled,
  tone = 'default',
  testId,
  title,
  type = 'button',
}: {
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  tone?: 'default' | 'primary' | 'ghost' | 'danger'
  testId?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      title={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        tone === 'default' && 'bg-foreground/[0.05] text-foreground hover:bg-foreground/[0.09]',
        tone === 'primary' && 'bg-foreground text-background hover:bg-foreground/90',
        tone === 'ghost' && 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
        tone === 'danger' && 'text-destructive hover:bg-destructive/10',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs transition-colors',
        checked ? 'bg-success text-background' : 'bg-foreground/[0.08] hover:bg-foreground/[0.14]',
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  )
}

/** Editable list of checkable lines (definition of done, risks, open questions). */
export function EditableItemList({
  items,
  onChange,
  addPlaceholder,
  checkable = true,
  testId,
}: {
  items: RoadmapItem[]
  onChange: (next: RoadmapItem[]) => void
  addPlaceholder: string
  checkable?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  return (
    <div data-testid={testId} className="flex flex-col">
      {items.map((item) => (
        <div key={item.id} className="group flex min-w-0 items-center gap-1 pl-1">
          {checkable ? (
            <CheckBox
              checked={item.done}
              label={item.text}
              onChange={(done) => onChange(items.map((x) => (x.id === item.id ? { ...x, done } : x)))}
            />
          ) : (
            <span className="mx-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
          )}
          <InlineInput
            value={item.text}
            ariaLabel={item.text}
            className={cn(item.done && 'text-muted-foreground line-through')}
            onCommit={(text) =>
              onChange(text ? items.map((x) => (x.id === item.id ? { ...x, text } : x)) : items.filter((x) => x.id !== item.id))
            }
          />
          <IconButton
            label={t('projectRoadmap.remove')}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={() => onChange(items.filter((x) => x.id !== item.id))}
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
      <AddRow
        placeholder={addPlaceholder}
        onAdd={(text) => onChange([...items, { id: roadmapId('it'), text, done: false }])}
      />
    </div>
  )
}

/** Honest, compact empty state line — one sentence, optional single action. */
export function EmptyLine({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-foreground/[0.025] px-3 py-2.5 text-[12px] leading-5 text-muted-foreground">
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
