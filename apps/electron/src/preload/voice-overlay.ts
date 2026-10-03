import { contextBridge, ipcRenderer } from 'electron'
import type { OverlayState } from '@rox/shared/voice/overlay-types'

// This child window receives no RPC credential, filesystem API, or general Electron bridge.
contextBridge.exposeInMainWorld('voiceOverlay', {
  onState(callback: (state: OverlayState) => void) {
    let active = true, events = 0
    const listener = (_event: Electron.IpcRendererEvent, state: OverlayState) => { events++; callback(state) }
    ipcRenderer.on('rox:owned-voice-overlay:state', listener)
    void ipcRenderer.invoke('rox:owned-voice-overlay:command', 'snapshot', null).then(reply => {
      if (active && events === 0 && reply?.ok && reply.state) { callback(reply.state) }
    }).catch(() => {})
    return () => { active = false; ipcRenderer.removeListener('rox:owned-voice-overlay:state', listener) }
  },
  stop: (recordingId: string | null) => ipcRenderer.invoke('rox:owned-voice-overlay:command', 'stop', recordingId),
  cancel: (recordingId: string | null) => ipcRenderer.invoke('rox:owned-voice-overlay:command', 'cancel', recordingId),
})
