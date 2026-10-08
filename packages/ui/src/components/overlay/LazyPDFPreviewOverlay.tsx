/**
 * PDFPreviewOverlay entry that keeps react-pdf + pdf.js (~0.8 MB) out of the
 * startup bundle (PERF-04). The real overlay loads the first time a PDF
 * preview opens; until then nothing is rendered (the overlay is closed).
 * Once loaded it stays mounted exactly like the eager component did, so
 * open/close animations and state are unchanged.
 */
import * as React from 'react'
import type { PDFPreviewOverlayProps } from './PDFPreviewOverlay'

export type { PDFPreviewOverlayProps } from './PDFPreviewOverlay'

const loadPdfPreviewOverlay = () =>
  import('./PDFPreviewOverlay').then((module) => ({ default: module.PDFPreviewOverlay }))

const PDFPreviewOverlayImpl = React.lazy(loadPdfPreviewOverlay)

export function PDFPreviewOverlay(props: PDFPreviewOverlayProps) {
  const [requested, setRequested] = React.useState(props.isOpen)
  React.useEffect(() => {
    if (props.isOpen) setRequested(true)
  }, [props.isOpen])
  if (!requested && !props.isOpen) return null
  return (
    <React.Suspense fallback={null}>
      <PDFPreviewOverlayImpl {...props} />
    </React.Suspense>
  )
}

/** Start fetching the PDF viewer chunk ahead of time. */
PDFPreviewOverlay.preload = loadPdfPreviewOverlay
