/**
 * ROX2-040: native voice overlay surface.
 * Overlay host is independent of Conation. Fixture transcripts are not live.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  queuedResult,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const VOICE_OVERLAY_SURFACE_ID = 'voice-overlay' as const

/** Voice overlay is reachable without Conation flags. */
export const VOICE_OVERLAY_REQUIRES_CONATION_FLAG = false as const

export function voiceOverlaySurfaceResult(source: 'native' | 'fixture' | 'conation'): Rox2Result {
  if (source === 'fixture') {
    return fixtureResult('voice-overlay.fixture', 'Fixture transcripts are not a live overlay result')
  }
  if (source === 'conation') {
    return queuedResult('voice-overlay.conation', 'Conation is not the native voice overlay')
  }
  return { ok: true, state: 'live', entityId: formatRox2EntityId('call', 'overlay') }
}
