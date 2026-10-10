import { useRef, useState, useLayoutEffect } from 'react'
import { cn } from '@/lib/utils'

interface FadingTextProps {
  children: React.ReactNode
  className?: string
  /** Width of the fade gradient in pixels (default: 24) */
  fadeWidth?: number
}

/**
 * FadingText - Text that fades with gradient only when overflowing
 *
 * Uses CSS mask-image to create a gradient fade effect on the right edge
 * when the text content overflows its container. Only applies the mask
 * when overflow is detected.
 *
 * @example
 * <FadingText>Long text that might overflow</FadingText>
 * <FadingText fadeWidth={36}>Custom fade width</FadingText>
 */
export function FadingText({ children, className, fadeWidth = 24 }: FadingTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  // A masked (clipped) label must still be reachable in full — only plain
  // string children can be mirrored onto a native `title`.
  const titleText = typeof children === 'string' ? children : undefined

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setIsOverflowing(el.scrollWidth > el.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={ref}
      title={isOverflowing ? titleText : undefined}
      className={cn("overflow-hidden whitespace-nowrap min-w-0", className)}
      style={isOverflowing ? {
        maskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}px), transparent)`
      } : undefined}
    >
      {children}
    </span>
  )
}
