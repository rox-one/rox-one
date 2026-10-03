import type { OverlayState } from '@rox/shared/voice/overlay-types'
const listeners = new Set<(state: OverlayState) => void>()
const calls: string[] = []
let denied = false
window.voiceOverlay = {
  onState(callback) { listeners.add(callback); return () => { listeners.delete(callback) } },
  async stop() { calls.push('stop'); return { ok: !denied } },
  async cancel() { calls.push('cancel'); return { ok: !denied } },
}
Object.assign(window, { __overlayFixture: {
  publish: (state: OverlayState) => listeners.forEach(callback => callback(state)),
  calls, deny: () => { denied = true }, subscriptions: () => listeners.size,
} })
localStorage.setItem('i18nextLng', 'en')
await import('../../../voice-overlay')
