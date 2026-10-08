/**
 * MultiDiffPreviewOverlay entry that keeps the @pierre/diffs renderer and
 * Shiki out of the startup bundle (PERF-04). The real overlay loads the first
 * time a diff preview opens; until then nothing is rendered (the overlay is
 * closed). Once loaded it stays mounted exactly like the eager component did,
 * so open/close animations and state are unchanged.
 */
import * as React from 'react'
import type { MultiDiffPreviewOverlayProps } from './MultiDiffPreviewOverlay'

export type { MultiDiffPreviewOverlayProps, FileChange, DiffViewerSettings } from './MultiDiffPreviewOverlay'

const loadMultiDiffPreviewOverlay = () =>
  import('./MultiDiffPreviewOverlay').then((module) => ({ default: module.MultiDiffPreviewOverlay }))

const MultiDiffPreviewOverlayImpl = React.lazy(loadMultiDiffPreviewOverlay)

export function MultiDiffPreviewOverlay(props: MultiDiffPreviewOverlayProps) {
  const [requested, setRequested] = React.useState(props.isOpen)
  React.useEffect(() => {
    if (props.isOpen) setRequested(true)
  }, [props.isOpen])
  if (!requested && !props.isOpen) return null
  return (
    <React.Suspense fallback={null}>
      <MultiDiffPreviewOverlayImpl {...props} />
    </React.Suspense>
  )
}

/** Start fetching the diff viewer chunk ahead of time. */
MultiDiffPreviewOverlay.preload = loadMultiDiffPreviewOverlay
