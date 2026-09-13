/**
 * Isolated overlay preload. The recording pill must not inherit the full
 * bootstrap ElectronAPI — it only dispatches stop/cancel and receives meter state.
 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  VOICE_OVERLAY_IPC,
  type VoiceOverlayCommand,
  type VoiceOverlayState,
} from '../shared/voice-overlay-ipc'

const ACTIONS: readonly VoiceOverlayCommand[] = ['toggle', 'cancel']

contextBridge.exposeInMainWorld('voiceOverlay', {
  dispatch: (action: VoiceOverlayCommand) => {
    if (!ACTIONS.includes(action)) return Promise.reject(new Error('Unknown voice overlay command'))
    return ipcRenderer.invoke(VOICE_OVERLAY_IPC.COMMAND, action)
  },
  onState: (callback: (state: VoiceOverlayState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: VoiceOverlayState) => {
      callback(state)
    }
    ipcRenderer.on(VOICE_OVERLAY_IPC.STATE, handler)
    return () => {
      ipcRenderer.removeListener(VOICE_OVERLAY_IPC.STATE, handler)
    }
  },
})
