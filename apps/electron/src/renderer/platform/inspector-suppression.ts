/**
 * Routes that own their full width and never show the right inspector.
 * The Project screen (projects/project/{slug}) is a one-surface roadmap whose
 * metadata lives in its own header, so the Инфо inspector is suppressed there.
 */
import { useAtomValue } from 'jotai'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'

export function isInspectorSuppressedRoute(route: string | null | undefined): boolean {
  return typeof route === 'string' && route.startsWith('projects/project/')
}

export function useInspectorSuppressed(): boolean {
  return isInspectorSuppressedRoute(useAtomValue(focusedPanelRouteAtom))
}
