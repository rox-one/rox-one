import { SpotlightOverlay, type SpotlightOverlayProps } from './SpotlightOverlay'
import { TourVignette } from './TourVignette'

export type TourPresentationProps = SpotlightOverlayProps & {
  /** Demo mode (D10): vignette + pulse. */
  readonly demo?: boolean
}

/**
 * Overlay surface kept behind import() from the boot host. The provider
 * mounts on every launch and cannot itself be React.lazy.
 */
export function TourPresentation({ demo, ...overlay }: TourPresentationProps) {
  return <>
    {demo && <TourVignette />}
    <SpotlightOverlay {...overlay} />
  </>
}
