import type { ElectronAPI } from '../../../shared/types'
import type { VoiceHealth, VoicePrefs } from '@craft-agent/shared/voice'

type RuntimeCapability = { getRuntimeEnvironment?: () => 'electron' | 'web' }

export type VoiceSettingsSnapshot = {
  prefs: VoicePrefs
  health: VoiceHealth
}
export type VoiceSettingsHistory = Array<{ id: string; favorite: boolean; state: string }> | null

/** History has its own lifecycle and never delays the required voice prefs. */
export async function readVoiceSettingsHistory(api: Partial<Pick<ElectronAPI, 'listVoiceHistory'>>): Promise<VoiceSettingsHistory> {
  if (!api.listVoiceHistory) return null
  try {
    const result = await api.listVoiceHistory({ limit: 20 })
    if (!result || !Array.isArray(result.page) || !result.page.every((item): item is NonNullable<VoiceSettingsHistory>[number] =>
        typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
        && typeof (item as { favorite?: unknown }).favorite === 'boolean' && typeof (item as { state?: unknown }).state === 'string')) return null
    return result.page
  } catch { return null }
}

export async function readVoiceSettingsSnapshot(api: Pick<ElectronAPI, 'getVoicePrefs' | 'getVoiceHealth'>): Promise<VoiceSettingsSnapshot> {
  const [prefs, health] = await Promise.all([
    (async () => api.getVoicePrefs())(),
    (async () => api.getVoiceHealth())(),
  ])
  return { prefs, health }
}

/** Own one mounted desktop settings section, including its outstanding replies. */
export function createDesktopSettingsSession<T>(
  api: RuntimeCapability | undefined,
  onValue: (value: T) => void,
  onUnavailable: (error?: unknown) => void,
) {
  let disposed = false
  let generation = 0
  const subscriptions = new Set<() => void>()
  const isDesktop = () => api?.getRuntimeEnvironment?.() === 'electron'
  const capability = () => {
    try { return { ready: isDesktop(), error: undefined as unknown } }
    catch (error) { return { ready: false, error } }
  }

  async function run(operation: (isCurrent: () => boolean) => T | Promise<T>): Promise<boolean> {
    if (disposed) return false
    const request = ++generation
    const isCurrent = () => !disposed && request === generation
    let available = capability()
    if (!available.ready) { onUnavailable(available.error); return false }
    // Cleanup before dispatch must also prevent a host write from starting.
    await Promise.resolve()
    if (!isCurrent()) return false
    available = capability()
    if (!available.ready) { onUnavailable(available.error); return false }
    let value: T
    try {
      value = await operation(() => isCurrent() && isDesktop())
    } catch (error) {
      if (isCurrent()) onUnavailable(error)
      return false
    }
    if (!isCurrent()) return false
    available = capability()
    if (!available.ready) { onUnavailable(available.error); return false }
    onValue(value)
    return true
  }

  function subscribe(register: (onChange: () => void) => void | (() => void), onChange: () => void): () => void {
    if (disposed) return () => {}
    const available = capability()
    if (!available.ready) { onUnavailable(available.error); return () => {} }
    let callbackFailed = false
    try {
      const off = register(() => {
        if (disposed) return
        try {
          const current = capability()
          if (current.ready) onChange()
          else onUnavailable(current.error)
        } catch (error) { callbackFailed = true; throw error }
      })
      if (!off) return () => {}
      let active = true
      const cancel = () => {
        if (!active) return
        active = false
        subscriptions.delete(cancel)
        try { off() } catch (error) { if (!disposed) onUnavailable(error) }
      }
      subscriptions.add(cancel)
      return cancel
    } catch (error) {
      if (callbackFailed) throw error
      onUnavailable(error)
      return () => {}
    }
  }

  return {
    run,
    subscribe,
    dispose() {
      disposed = true
      generation++
      for (const cancel of subscriptions) cancel()
    },
  }
}
