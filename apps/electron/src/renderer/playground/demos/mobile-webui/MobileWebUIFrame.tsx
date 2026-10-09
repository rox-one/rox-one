import * as React from 'react'
import { cn } from '@/lib/utils'

export type MobileDevice = 'iphone-15' | 'iphone-se' | 'pixel-8' | 'custom'

export interface MobileWebUIFrameProps {
  /** Preset phone width × height. iPhone 15 is the default. */
  device?: MobileDevice
  /** Override width/height when device='custom'. */
  width?: number
  height?: number
  /**
   * Adds a thin bezel + status-bar strip for visual context. Opt-in marketing
   * variant — the 390×844 baseline renders without it so the shell/panel
   * container queries evaluate against the true content box (P-10-32).
   */
  showBezel?: boolean
  className?: string
  children: React.ReactNode
}

const DEVICE_SIZES: Record<Exclude<MobileDevice, 'custom'>, { width: number; height: number; label: string }> = {
  'iphone-15': { width: 390, height: 844, label: 'iPhone 15' },
  'iphone-se': { width: 375, height: 667, label: 'iPhone SE' },
  'pixel-8': { width: 412, height: 915, label: 'Pixel 8' },
}

/**
 * Constrains its child to a phone-shaped viewport. Default 390×844 (iPhone 15).
 *
 * The inner content div names the `shell` and `panel` containers used by
 * AppShell / PanelSlot, so internal compact-mode container queries fire
 * naturally when their layout reads `@container/shell` or `@container/panel`.
 */
export function MobileWebUIFrame({
  device = 'iphone-15',
  width,
  height,
  showBezel = false,
  className,
  children,
}: MobileWebUIFrameProps) {
  const size = device === 'custom'
    ? { width: width ?? 390, height: height ?? 844, label: `${width ?? 390}×${height ?? 844}` }
    : DEVICE_SIZES[device]

  const contentRef = React.useRef<HTMLDivElement>(null)
  // Real content box (the `shell`/`panel` container) — never the nominal frame
  // size. Measured so the readout stays honest with or without the bezel.
  const [contentBox, setContentBox] = React.useState<{ width: number; height: number } | null>(null)

  React.useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const measure = () => {
      const next = { width: Math.round(element.clientWidth), height: Math.round(element.clientHeight) }
      setContentBox((current) =>
        current && current.width === next.width && current.height === next.height ? current : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        className={cn(
          'relative bg-background overflow-hidden flex flex-col',
          showBezel
            ? 'rounded-[36px] border-[10px] border-foreground/80 shadow-2xl'
            : 'rounded-lg ring-1 ring-border',
        )}
        style={{ width: size.width, height: size.height }}
      >
        {showBezel && (
          <div className="h-7 shrink-0 flex items-center justify-center bg-foreground/95 text-background text-[11px] font-medium tabular-nums">
            <span>9:41</span>
          </div>
        )}
        <div
          ref={contentRef}
          data-mobile-menu-root="true"
          className="@container/shell @container/panel relative flex-1 min-h-0 overflow-hidden bg-background"
        >
          {children}
        </div>
      </div>
      <span className="text-[11px] font-mono text-muted-foreground">
        {size.label} — {contentBox ? `${contentBox.width}×${contentBox.height}` : `${size.width}×${size.height}`}
      </span>
    </div>
  )
}
