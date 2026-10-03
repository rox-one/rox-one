import { describe, expect, it } from 'bun:test'
import { attachVoiceCommandInput, matchesVoiceAccelerator, sendVoiceHotkeyToClient, voiceAcceleratorIsReserved, type VoiceKeyInput } from '../command-input'
import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'
import { VoiceCommandController } from '../../../renderer/voice/command-controller'

function keyboard() {
  let listener: ((event: { preventDefault(): void }, input: VoiceKeyInput) => void) | undefined
  let suppressed = 0
  return {
    port: {
      on(_event: 'before-input-event', next: NonNullable<typeof listener>) { listener = next },
      removeListener(_event: 'before-input-event', next: NonNullable<typeof listener>) { if (listener === next) listener = undefined },
    },
    emit(input: VoiceKeyInput) { listener?.({ preventDefault() { suppressed++ } }, input) },
    suppressed: () => suppressed,
    attached: () => Boolean(listener),
  }
}

describe('native voice command routing', () => {
  it('targets one authenticated managed client, never broadcasts or falls back to raw IPC', () => {
    const events: unknown[] = []
    const options = { webContentsId: 7, isManagedWindow: (id: number) => id === 7, resolveClient: (id: number) => id === 7 ? 'native-client' : undefined,
      channel: 'voice:hotkey', push: (...args: unknown[]) => { events.push(args) } }
    expect(sendVoiceHotkeyToClient(options, 'toggle')).toBe(true)
    expect(events).toEqual([['voice:hotkey', { to: 'client', clientId: 'native-client' }, { command: 'toggle' }]])
    expect(sendVoiceHotkeyToClient({ ...options, webContentsId: 9 }, 'toggle')).toBe(false)
    expect(sendVoiceHotkeyToClient({ ...options, resolveClient: () => undefined }, 'toggle')).toBe(false)
    expect(sendVoiceHotkeyToClient({ ...options, push: null }, 'toggle')).toBe(false)
    expect(events).toHaveLength(1)
  })

  it('pairs Right Option foreground press/release; rejects left modifier and ignores repeat', () => {
    const input = keyboard(); const commands: HotkeyCommand[] = []
    const binding = attachVoiceCommandInput(input.port, { prefs: () => ({ hotkeyMode: 'ptt', cancelAccelerator: 'Escape' }), isFocused: () => true,
      send: command => { commands.push(command); return true } })
    input.emit({ type: 'keyDown', key: 'Alt', code: 'AltLeft', location: 1 })
    input.emit({ type: 'keyUp', code: 'AltRight' })
    input.emit({ type: 'keyDown', code: 'AltRight' })
    input.emit({ type: 'keyDown', code: 'AltRight' })
    input.emit({ type: 'keyUp', code: 'AltRight' })
    expect(commands).toEqual(['ptt-down', 'ptt-up'])
    expect(input.suppressed()).toBe(3)
    binding.dispose(); expect(input.attached()).toBe(false)
  })

  it('does not reserve unrelated/unfocused/unbound input; toggle mode never captures Right Option', () => {
    for (const [focused, delivered, mode] of [[false, true, 'ptt'], [true, false, 'ptt'], [true, true, 'toggle']] as const) {
      const input = keyboard(); const commands: HotkeyCommand[] = []
      const binding = attachVoiceCommandInput(input.port, { prefs: () => ({ hotkeyMode: mode, cancelAccelerator: 'Escape' }), isFocused: () => focused,
        send: command => { if (delivered) commands.push(command); return delivered } })
      input.emit({ type: 'keyDown', code: 'AltRight' }); input.emit({ type: 'keyUp', code: 'AltRight' })
      expect(commands).toEqual([]); expect(input.suppressed()).toBe(0); binding.dispose()
    }
  })

  it('blur/disposal cancel the held owner once; preference changes cannot strand a key-up', () => {
    const input = keyboard(); const commands: HotkeyCommand[] = []; let mode: 'ptt' | 'toggle' = 'ptt'
    const binding = attachVoiceCommandInput(input.port, { prefs: () => ({ hotkeyMode: mode, cancelAccelerator: 'Escape' }), isFocused: () => true,
      send: command => { commands.push(command); return true } })
    input.emit({ type: 'keyDown', key: 'Alt', location: 2 }); mode = 'toggle'
    input.emit({ type: 'keyUp', key: 'Alt', location: 2 }); mode = 'ptt'
    input.emit({ type: 'keyDown', code: 'AltRight' }); binding.cancelHeld(); binding.cancelHeld(); binding.dispose()
    expect(commands).toEqual(['ptt-down', 'ptt-up', 'ptt-down', 'cancel'])
  })

  it('matches configured foreground cancel with exact modifiers, including platform aliases', () => {
    expect(matchesVoiceAccelerator({ type: 'keyDown', key: 'Escape' }, 'Escape')).toBe(true)
    expect(matchesVoiceAccelerator({ type: 'keyDown', key: 'Escape', shift: true }, 'Escape')).toBe(false)
    expect(matchesVoiceAccelerator({ type: 'keyDown', key: 'Escape', meta: true, shift: true }, 'CommandOrControl+Shift+Escape', 'darwin')).toBe(true)
    expect(matchesVoiceAccelerator({ type: 'keyDown', key: 'Escape', control: true, shift: true }, 'CommandOrControl+Shift+Escape', 'win32')).toBe(true)
    expect(matchesVoiceAccelerator({ type: 'keyUp', key: 'Escape' }, 'Escape')).toBe(false)
  })

  it('preserves idle Escape behavior and refuses reserved application accelerators', () => {
    const input = keyboard(); const commands: HotkeyCommand[] = []
    const binding = attachVoiceCommandInput(input.port, { prefs: () => ({ hotkeyMode: 'ptt', cancelAccelerator: 'Escape' }), isFocused: () => true,
      send: command => { commands.push(command); return true } })
    input.emit({ type: 'keyDown', key: 'Escape' }); expect(input.suppressed()).toBe(0)
    input.emit({ type: 'keyDown', code: 'AltRight' }); input.emit({ type: 'keyDown', key: 'Escape' }); input.emit({ type: 'keyUp', code: 'AltRight' })
    expect(commands).toEqual(['cancel', 'ptt-down', 'cancel']); expect(input.suppressed()).toBe(2)
    expect(voiceAcceleratorIsReserved('CmdOrCtrl+Q')).toBe(true)
    expect(voiceAcceleratorIsReserved('Cmd+Q', 'darwin')).toBe(true)
    expect(voiceAcceleratorIsReserved('Ctrl+Q', 'win32')).toBe(true)
    expect(voiceAcceleratorIsReserved('Alt+F4')).toBe(true)
    expect(voiceAcceleratorIsReserved('CommandOrControl+Shift+D')).toBe(false)
    binding.dispose()
  })

  it('actual input-to-client-to-current-controller path starts/stops exactly one capture', async () => {
    const input = keyboard(); let recording = false; const actions: string[] = []
    const controller = new VoiceCommandController({ disabled: () => false, recording: () => recording,
      async start() { actions.push('permission/start'); recording = true }, stop() { actions.push('stop'); recording = false }, cancel() { actions.push('cancel'); recording = false } })
    const binding = attachVoiceCommandInput(input.port, { prefs: () => ({ hotkeyMode: 'ptt', cancelAccelerator: 'Escape' }), isFocused: () => true,
      send: command => sendVoiceHotkeyToClient({ webContentsId: 1, isManagedWindow: id => id === 1, resolveClient: () => 'bound-client', channel: 'voice:hotkey',
        push: (_channel, target, payload) => { expect(target.clientId).toBe('bound-client'); void controller.handle(payload.command) } }, command) })
    input.emit({ type: 'keyDown', code: 'AltRight' }); await Promise.resolve()
    input.emit({ type: 'keyDown', code: 'AltRight' }); input.emit({ type: 'keyUp', code: 'AltRight' })
    expect(actions).toEqual(['permission/start', 'stop']); binding.dispose()
  })
})
