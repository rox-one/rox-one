import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { FadingText } from '@/components/ui/fading-text'
import { cn } from '@/lib/utils'

export interface FreeFormInputContextBadgeProps {
  /** Left area - fully customizable (icon, avatar stack, etc.) */
  icon: React.ReactNode
  /** Label text - shown in expanded state or collapsed with selection */
  label: string
  /** Whether to show expanded state (icon + label + chevron) vs collapsed */
  isExpanded?: boolean
  /** Whether there's an active selection (affects collapsed state styling and shows label) */
  hasSelection?: boolean
  /** Show chevron indicator (for dropdowns) - only visible in expanded state */
  showChevron?: boolean
  /** Click handler */
  onClick?: () => void
  /** Tooltip content - can be string or ReactNode for rich content */
  tooltip?: React.ReactNode
  /** Whether the badge is currently "open" (e.g., dropdown is shown) */
  isOpen?: boolean
  /** Whether the badge is disabled */
  disabled?: boolean
  /** Additional className for the button */
  className?: string
  /** Ref forwarding for positioning dropdowns */
  buttonRef?: React.RefObject<HTMLButtonElement>
  /** Data attribute for tutorials */
  'data-tutorial'?: string
  'aria-pressed'?: boolean
  /**
   * Current 0..1 dictation level. When provided, a decorative live wave is
   * rendered at the dictation spot; `undefined` (not recording) hides it.
   */
  liveLevel?: number
}

/**
 * FreeFormInputContextBadge - Unified context badge for Sources, Files, and Folder selectors
 *
 * Visual States:
 * - Expanded: Icon + Label + Chevron, no background, hover shows background
 * - Collapsed (no selection): Icon only, no background, hover shows background
 * - Collapsed (has selection): Icon + Label (fading), bg-background + shadow-minimal
 * - Open: bg-foreground/5 (like hover)
 */
function DictationWave({ level }: { level: number }) {
  const centred = Math.min(1, Math.max(0, level))
  return (
    <span aria-hidden="true" className="pointer-events-none shrink-0">
      <span className="flex h-3 w-8 items-center justify-between motion-reduce:hidden">
        {[0, 1, 2, 3, 4].map((bar) => {
          const distance = Math.abs(bar - 2) / 2
          const scale = 0.25 + (1 - distance) * 0.75 * Math.max(0.2, centred)
          return (
            <span
              key={bar}
              className="w-0.5 rounded-full bg-[var(--accent)] transition-transform duration-[120ms] ease-linear"
              style={{ height: '100%', transform: `scaleY(${Number(scale.toFixed(3))})` }}
            />
          )
        })}
      </span>
      <span className="hidden h-3 w-8 items-center justify-between motion-reduce:flex">
        {[0.4, 0.7, 1, 0.7, 0.4].map((scale, bar) => (
          <span
            key={bar}
            className="w-0.5 rounded-full bg-[var(--accent)]"
            style={{ height: '100%', transform: `scaleY(${scale})` }}
          />
        ))}
      </span>
    </span>
  )
}

export const FreeFormInputContextBadge = React.forwardRef<HTMLButtonElement, FreeFormInputContextBadgeProps>(
  function FreeFormInputContextBadge(
    {
      icon,
      label,
      isExpanded = false,
      hasSelection = false,
      showChevron = false,
      onClick,
      tooltip,
      isOpen = false,
      disabled = false,
      className,
      buttonRef,
      'data-tutorial': dataTutorial,
      'aria-pressed': ariaPressed,
      liveLevel,
    },
    ref
  ) {
    // Merge refs if both are provided
    const mergedRef = buttonRef || ref

    // Show label in expanded state OR in collapsed state with selection
    const showLabel = isExpanded || hasSelection

    const button = (
      <button
        ref={mergedRef as React.Ref<HTMLButtonElement>}
        type="button"
        aria-label={label}
        aria-pressed={ariaPressed}
        onClick={onClick}
        disabled={disabled}
        data-tutorial={dataTutorial}
        className={cn(
          // Base styles - shrink + min-w-0 allows badge to compress in tight layouts
          "input-toolbar-btn inline-flex items-center gap-1.5 h-6 rounded-[var(--radius-control)] text-[9px] text-foreground transition-colors select-none shrink min-w-0",
          "disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
          // Padding: more padding when showing label
          showLabel ? "px-2" : "px-1.5",
          // Collapsed with selection: visible background + thin 1px border + margin
          !isExpanded && hasSelection && "bg-background border border-foreground/5 mx-0.5",
          // Hover state (when not already showing background from selection)
          !(!isExpanded && hasSelection) && "hover:bg-foreground/5",
          // Open state (dropdown shown)
          isOpen && "bg-foreground/5",
          className
        )}
      >
        {/* Icon area */}
        <span className="shrink-0 flex items-center">
          {icon}
        </span>

        {/* Label - in expanded state or collapsed with selection */}
        {showLabel && (
          isExpanded ? (
            // Expanded: simple truncate, placeholder (no selection) gets 60% opacity
            <span className={cn("truncate max-w-[120px] min-w-0 shrink", !hasSelection && "opacity-50")}>
              {label}
            </span>
          ) : (
            // Collapsed with selection: fading text with max width
            <FadingText className="max-w-[140px] min-w-0 shrink" fadeWidth={20}>
              {label}
            </FadingText>
          )
        )}

        {/* Decorative live dictation wave - only while recording (level provided) */}
        {liveLevel !== undefined && <DictationWave level={liveLevel} />}

        {/* Optional chevron - only in expanded state */}
        {isExpanded && showChevron && (
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        )}
      </button>
    )

    // Wrap with tooltip if provided (skip when dropdown is open to avoid showing tooltip)
    if (tooltip && !isOpen) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {button}
          </TooltipTrigger>
          <TooltipContent side="top">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )
    }

    return button
  }
)
