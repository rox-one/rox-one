/**
 * ROX2-034: native Web UI surface.
 * Web client stays native. Conation is not this surface. Drive/Mail are not live.
 */
import {
  fixtureResult,
  formatRox2EntityId,
  queuedResult,
  type Rox2Result,
} from '@craft-agent/core/rox2'

export const WEBUI_SURFACE_ID = 'webui' as const

/** Web UI is reachable without Conation flags. */
export const WEBUI_REQUIRES_CONATION_FLAG = false as const

export function webuiSurfaceResult(source: 'native' | 'fixture' | 'conation'): Rox2Result {
  if (source === 'fixture') {
    return fixtureResult('webui.fixture', 'Playground webui stories are fixture, not live')
  }
  if (source === 'conation') {
    return queuedResult('webui.conation', 'Conation is not the native web UI')
  }
  return { ok: true, state: 'live', entityId: formatRox2EntityId('session', 'webui-surface') }
}
