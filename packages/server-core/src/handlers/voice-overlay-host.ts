import type { RequestContext } from '../transport'
import type { OverlayState } from '@rox/shared/voice/overlay-types'

/** Native host composition only: the server owns both identity and phase. */
export interface NativeVoiceOverlayHost {
  publish(input: {
    context: RequestContext
    state: OverlayState
    position: 'top' | 'bottom'
    assertCurrent(): void
  }): void
  retire(clientId: string): void
}
