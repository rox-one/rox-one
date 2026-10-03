import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Mount on first use, then retain local drafts while responsive chrome is hidden. */
export function RetainedSurface({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [hasOpened, setHasOpened] = useState(visible)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) setHasOpened(true)
  }, [visible])

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    element.inert = !visible
    if (!visible && element.contains(document.activeElement)) {
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
  }, [visible])

  if (!visible && !hasOpened) return null
  return (
    <div ref={container} aria-hidden={!visible || undefined} style={{ display: visible ? 'contents' : 'none' }}>
      {children}
    </div>
  )
}
