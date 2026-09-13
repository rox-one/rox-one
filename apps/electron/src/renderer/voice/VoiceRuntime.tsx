import { useEffect } from 'react'
import { voiceCaptureSession } from './capture-session'

/** Installs global voice commands once per main renderer. Overlay uses a separate entry. */
export function VoiceRuntime() {
  useEffect(() => {
    voiceCaptureSession.installCommandListener()
    void window.electronAPI.getVoicePrefs?.().then((prefs) => {
      voiceCaptureSession.setPrefs(prefs)
    }).catch(() => {})
    const off = window.electronAPI.onVoiceChanged?.((prefs) => {
      voiceCaptureSession.setPrefs(prefs)
      void window.electronAPI.rebindVoiceHotkeys?.()
    })
    const halt = () => {
      void voiceCaptureSession.cancel()
    }
    window.addEventListener('pagehide', halt)
    window.addEventListener('beforeunload', halt)
    return () => {
      off?.()
      window.removeEventListener('pagehide', halt)
      window.removeEventListener('beforeunload', halt)
      halt()
    }
  }, [])
  return null
}
