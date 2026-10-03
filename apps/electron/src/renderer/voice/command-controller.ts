import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'

/** Route every command through the current composer's permission/request fences. */
export class VoiceCommandController {
  private held = false
  private pending = false

  constructor(private readonly port: {
    disabled(): boolean
    recording(): boolean
    active?(): boolean
    start(): Promise<void>
    stop(): void
    cancel(): void
  }) {}

  async handle(command: HotkeyCommand): Promise<void> {
    if (!['toggle', 'ptt-down', 'ptt-up', 'cancel'].includes(command)) return
    if (command === 'cancel') {
      this.held = false
      if (this.pending || this.port.recording() || this.port.active?.()) this.port.cancel()
      return
    }
    if (command === 'ptt-up') {
      if (!this.held) return
      this.held = false
      // Release during a microphone prompt revokes the pending request.
      if (this.pending) this.port.cancel()
      else if (this.port.recording()) this.port.stop()
      return
    }
    if (command === 'toggle' && (this.pending || (this.port.active?.() && !this.port.recording()))) {
      this.held = false
      this.port.cancel()
      return
    }
    if (command === 'toggle' && this.port.recording()) {
      this.held = false
      this.port.stop()
      return
    }
    if (this.pending || this.port.disabled() || this.port.recording() || this.port.active?.() || this.held) return
    this.held = command === 'ptt-down'
    this.pending = true
    try { await this.port.start() }
    finally { this.pending = false }
  }
}
