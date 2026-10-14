/**
 * Date value editor for LabelValuePopover: natural-language input (chrono-node)
 * plus a nested react-day-picker calendar. Split out and loaded lazily (WP7) so
 * chrono-node, react-day-picker and the calendar do not ride the session list
 * into index.html's startup closure.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './popover'
import { Calendar } from './calendar'
import { cn } from '@/lib/utils'
import { parseDate } from 'chrono-node'
import { format, parse } from 'date-fns'
import { getDateLocale } from '@rox/shared/i18n/date-locale'

export interface LabelDateEditorProps {
  inputRef: React.RefObject<HTMLInputElement>
  draft: string
  setDraft: (draft: string) => void
  value?: string
  onValueChange?: (newValue: string | undefined) => void
  onOpenChange: (open: boolean) => void
  calendarOpen: boolean
  setCalendarOpen: (open: boolean) => void
}

export default function LabelDateEditor({
  inputRef,
  draft,
  setDraft,
  value,
  onValueChange,
  onOpenChange,
  calendarOpen,
  setCalendarOpen,
}: LabelDateEditorProps) {
  const { t, i18n } = useTranslation()
  const dateLocale = getDateLocale(i18n.language)

  // The popover focuses the input on open; on a cold first open this chunk
  // mounts after that, so take focus here once.
  React.useEffect(() => {
    if (document.activeElement !== inputRef.current) inputRef.current?.focus()
  }, [inputRef])

  /**
   * For date labels: parse the draft text with chrono-node to get a resolved Date.
   * Returns null if the text can't be parsed as a date.
   */
  const parsedDate = React.useMemo(() => {
    if (!draft.trim()) return null
    return parseDate(draft.trim())
  }, [draft])

  // The date to highlight in the calendar: prefer the live-parsed draft,
  // fall back to the committed value prop (YYYY-MM-DD format).
  const calendarDate = React.useMemo(() => {
    if (parsedDate) return parsedDate
    if (value) {
      try {
        return parse(value, 'yyyy-MM-dd', new Date())
      } catch {
        return undefined
      }
    }
    return undefined
  }, [parsedDate, value])

  /** Handle keyboard in the date input */
  const handleDateKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (parsedDate) {
        // Commit the resolved date and close
        onValueChange?.(format(parsedDate, 'yyyy-MM-dd'))
        onOpenChange(false)
      } else if (!draft.trim()) {
        // Empty input clears the value
        onValueChange?.(undefined)
        onOpenChange(false)
      }
      // If unparseable non-empty text, keep popover open
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value ?? '')
      onOpenChange(false)
    }
  }, [parsedDate, draft, onOpenChange, onValueChange, value])

  return (
<div className="px-1.5 py-1.5 border-b border-border/50">
            {/* Text input with calendar popover trigger on the right */}
            <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    // ArrowDown opens the calendar (matches shadcn pattern)
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setCalendarOpen(true)
                    } else {
                      handleDateKeyDown(e)
                    }
                  }}
                  onBlur={() => {
                    // Commit parsed date on blur, or clear if empty
                    if (parsedDate) {
                      onValueChange?.(format(parsedDate, 'yyyy-MM-dd'))
                    } else if (!draft.trim()) {
                      onValueChange?.(undefined)
                    }
                  }}
                  placeholder={t('labels.datePlaceholder')}
                  className={cn(
                    'flex-1 h-7 px-2 text-base',
                    'bg-transparent',
                    'text-foreground placeholder:text-muted-foreground',
                    'outline-none'
                  )}
                />
                {/* Calendar icon opens a nested popover with the date picker */}
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('labels.selectDate')}
                      className={cn(
                        'flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)]',
                        'hover:bg-surface-hover transition-colors cursor-pointer',
                        'outline-none',
                        calendarOpen && 'bg-surface-selected'
                      )}
                    >
                      <CalendarDays className="icon-caption text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[220px] overflow-hidden p-0"
                    side="top"
                    align="end"
                    sideOffset={8}
                  >
                    <Calendar
                      mode="single"
                      selected={calendarDate}
                      captionLayout="dropdown"
                      defaultMonth={calendarDate}
                      onSelect={(date) => {
                        if (date) {
                          // Commit directly and update draft for display
                          onValueChange?.(format(date, 'yyyy-MM-dd'))
                          setDraft(format(date, 'MMMM d, yyyy'))
                          setCalendarOpen(false)
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
            </div>
            {/* Show the resolved date below the input when parsing succeeds */}
            {parsedDate && (
              <div className="px-2 text-xs text-muted-foreground">
                {format(parsedDate, 'EEE, MMM d, yyyy', { locale: dateLocale })}
              </div>
            )}
          </div>
  )
}
