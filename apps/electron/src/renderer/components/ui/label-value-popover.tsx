/**
 * LabelValuePopover - Popover for editing a label's typed value or removing it.
 *
 * Opens when clicking a LabelBadge. Shows:
 * - Value editor input adapted to the label's valueType (number/string/date)
 * - "Remove" button to detach the label from the session
 *
 * Value changes are committed on Enter or blur; Escape cancels and closes.
 * Boolean labels (no valueType) show only the remove button.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, ExternalLink } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './popover'
import { cn } from '@/lib/utils'
import { openLabelLink } from '@/lib/open-label-link'
import { format, parse } from 'date-fns'
import { getDateLocale } from '@rox/shared/i18n/date-locale'
import type { LabelConfig } from '@rox/shared/labels'
import { loadLabelDateEditor } from './label-date-editor-loader'

const LabelDateEditor = React.lazy(loadLabelDateEditor)

export interface LabelValuePopoverProps {
  /** Label configuration (color, name, valueType) */
  label: LabelConfig
  /** Current raw value string */
  value?: string
  /** Called when user commits a new value (Enter or blur) */
  onValueChange?: (newValue: string | undefined) => void
  /** Called when user clicks "Remove" */
  onRemove?: () => void
  /** Controlled open state */
  open: boolean
  /** Open state change handler */
  onOpenChange: (open: boolean) => void
  /** Session identifier for scoped focus restoration */
  sessionId?: string
  /** The trigger element (typically a LabelBadge) */
  children: React.ReactNode
}

export function LabelValuePopover({
  label,
  value,
  onValueChange,
  onRemove,
  open,
  onOpenChange,
  sessionId,
  children,
}: LabelValuePopoverProps) {
  const { t, i18n } = useTranslation()
  const dateLocale = getDateLocale(i18n.language)
  // Local draft value — resets to prop value when popover opens
  const [draft, setDraft] = React.useState(value ?? '')
  // Whether the inline calendar picker is visible (date labels only)
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const removeButtonRef = React.useRef<HTMLButtonElement>(null)

  // Sync draft when popover opens or value prop changes.
  // For date labels with an existing YYYY-MM-DD value, show a human-readable form.
  React.useEffect(() => {
    if (open) {
      setCalendarOpen(false)
      if (label.valueType === 'date' && value) {
        try {
          const parsed = parse(value, 'yyyy-MM-dd', new Date())
          setDraft(format(parsed, 'PPP', { locale: dateLocale }))
        } catch {
          setDraft(value)
        }
      } else {
        setDraft(value ?? '')
      }
    }
  }, [open, value, label.valueType, dateLocale])

  /** Move focus into the popover when it opens.
   *  Labels with valueType → focus the value input; boolean labels → focus remove button.
   *  Prevents Radix default so we control exactly what gets focused. */
  const handleOpenAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault()
    if (label.valueType) {
      inputRef.current?.focus()
    } else {
      removeButtonRef.current?.focus()
    }
  }, [label.valueType])

  /** Restore focus to chat input after popover closes.
   *  Matches the pattern used in ActiveOptionBadges. */
  const handleCloseAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('craft:focus-input', {
      detail: { sessionId }
    }))
  }, [sessionId])

  /** Commit the current draft value */
  const commitValue = React.useCallback(() => {
    const trimmed = draft.trim()
    // Empty string means remove value (label becomes boolean-only)
    onValueChange?.(trimmed || undefined)
  }, [draft, onValueChange])

  /** Handle keyboard in the value input */
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitValue()
      onOpenChange(false)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value ?? '')
      onOpenChange(false)
    }
  }, [commitValue, onOpenChange, value])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-56 p-0"
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        // Stop pointer events from bubbling through React's synthetic event system.
        // Without this, events inside the portaled popover bubble up the React tree
        // to the session button's onMouseDown handler, causing unintended session selection.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Date value editor (chrono-node + react-day-picker): lazy so the date
            stack stays out of index.html's startup closure (WP7); warmed on idle. */}
        {label.valueType === 'date' && (
          <React.Suspense fallback={<div className="h-10 border-b border-border/50" />}>
            <LabelDateEditor
              inputRef={inputRef}
              draft={draft}
              setDraft={setDraft}
              value={value}
              onValueChange={onValueChange}
              onOpenChange={onOpenChange}
              calendarOpen={calendarOpen}
              setCalendarOpen={setCalendarOpen}
            />
          </React.Suspense>
        )}

        {/* Non-date value editor (number/string) */}
        {label.valueType && label.valueType !== 'date' && (
          <div className="px-1.5 py-1.5 border-b border-border/50">
            <input
              ref={inputRef}
              type={label.valueType === 'number' ? 'number' : 'text'}
              step={label.valueType === 'number' ? 'any' : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitValue}
              placeholder={
                label.valueType === 'number'
                  ? t('labels.numberPlaceholder')
                  : label.valueType === 'link'
                    ? t('labels.urlPlaceholder')
                    : t('labels.valuePlaceholder')
              }
              className={cn(
                'w-full h-7 px-2 text-base',
                'bg-transparent',
                'text-foreground placeholder:text-foreground/30',
                'outline-none'
              )}
            />
          </div>
        )}

        {/* Actions — "Open link" (link labels only) shown above Remove */}
        <div className="p-1">
          {label.valueType === 'link' && value && (
            <button
              type="button"
              onClick={() => {
                openLabelLink(value)
                onOpenChange(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-control)]',
                'text-base text-foreground',
                'hover:bg-foreground/[0.03] focus:bg-foreground/[0.03]',
                'transition-colors cursor-pointer outline-none'
              )}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t('common.openLink')}</span>
            </button>
          )}
          <button
            ref={removeButtonRef}
            type="button"
            onClick={() => {
              onRemove?.()
              onOpenChange(false)
            }}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-control)]',
              'text-base text-destructive',
              'hover:bg-foreground/[0.03] focus:bg-foreground/[0.03]',
              'transition-colors cursor-pointer outline-none'
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('common.remove')}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
