import * as React from "react"
import { cn } from "@/lib/utils"

interface TopBarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The icon or content to display inside the button */
  children: React.ReactNode
  /** Whether the button is in an active/pressed state (e.g., dropdown open) */
  isActive?: boolean
  /** Additional class names */
  className?: string
}

/**
 * TopBarButton - Consistent button style for the app's top bar
 *
 * Compact 24×24 control (design-compact), centered content, soft hover.
 * Used for: Craft logo, back/forward navigation, sidebar toggle, etc.
 */
export const TopBarButton = React.forwardRef<HTMLButtonElement, TopBarButtonProps>(
  ({ children, isActive, className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "header-icon-btn h-6 w-6 flex items-center justify-center rounded-[var(--radius-control)] titlebar-no-drag",
          // Subtle glass so top buttons read as clickable (Mark, t78).
          "border border-border-subtle bg-surface-hover shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_6%,transparent)]",
          "[backdrop-filter:blur(var(--chrome-glass-blur))] [-webkit-backdrop-filter:blur(var(--chrome-glass-blur))]",
          "hover:bg-surface-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:[&_svg]:text-text-disabled disabled:pointer-events-none disabled:opacity-50",
          "transition-colors duration-[var(--motion-fast)]",
          isActive && "bg-surface-selected",
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

TopBarButton.displayName = "TopBarButton"
