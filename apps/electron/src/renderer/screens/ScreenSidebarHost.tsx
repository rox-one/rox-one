import { lazy, Suspense } from 'react'

/**
 * Mounts the active screen's sidebar publisher. Each publisher calls
 * useScreenSidebar(config) and renders nothing; the shell renders the config.
 * Screens are lazy so only the active one's data hooks run.
 */
const PUBLISHERS: Record<string, React.LazyExoticComponent<() => React.ReactElement | null>> = {
  sessions: lazy(() => import('./sessions/SessionsScreenSidebar').then((m) => ({ default: m.SessionsScreenSidebar }))),
  browser: lazy(() => import('./browser/BrowserScreenSidebar').then((m) => ({ default: m.BrowserScreenSidebar }))),
}

export function hasScreenSidebarPublisher(screenId: string | null | undefined): boolean {
  return !!screenId && screenId in PUBLISHERS
}

export function ScreenSidebarHost({ screenId }: { screenId: string | null | undefined }) {
  const Publisher = screenId ? PUBLISHERS[screenId] : undefined
  if (!Publisher) return null
  return <Suspense fallback={null}><Publisher key={screenId} /></Suspense>
}
