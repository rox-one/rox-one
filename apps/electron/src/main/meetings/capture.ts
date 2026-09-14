/**
 * Meeting capture session (issue #360 / I004).
 * Native loopback is not faked: denied/dead streams fail closed.
 * Mic denial does not block import (see import-media).
 */

import {
  authorizeMeetingAction,
  type MeetingActionRequest,
  type MeetingGrant,
  type MeetingActor,
} from '@craft-agent/shared/meeting-agents'

export type CaptureStream = 'microphone' | 'system'
export type MeetingCaptureState = 'idle' | 'recording' | 'paused' | 'stopped' | 'denied' | 'dead'

export type MeetingCaptureStatus = {
  state: MeetingCaptureState
  mic: boolean
  system: boolean
  startedAt?: number
  pausedAt?: number
  error?: string
}

export class MeetingCaptureSession {
  private status: MeetingCaptureStatus = { state: 'idle', mic: false, system: false }

  snapshot(): MeetingCaptureStatus {
    return { ...this.status }
  }

  start(input: {
    actor: MeetingActor
    grants: readonly MeetingGrant[]
    mic: boolean
    system: boolean
    now: number
    streamAlive?: { microphone?: boolean; system?: boolean }
  }): MeetingCaptureStatus {
    if (input.mic) {
      const auth = authorize(input, 'microphone', 'capture.microphone')
      if (!auth.ok) {
        this.status = { state: 'denied', mic: false, system: false, error: auth.code }
        return this.snapshot()
      }
      if (input.streamAlive?.microphone === false) {
        this.status = { state: 'dead', mic: false, system: false, error: 'dead-mic' }
        return this.snapshot()
      }
    }
    if (input.system) {
      const auth = authorize(input, 'system', 'capture.system')
      if (!auth.ok) {
        this.status = { state: 'denied', mic: false, system: false, error: auth.code }
        return this.snapshot()
      }
      if (input.streamAlive?.system === false) {
        this.status = { state: 'dead', mic: false, system: false, error: 'dead-system' }
        return this.snapshot()
      }
    }
    if (!input.mic && !input.system) {
      this.status = { state: 'denied', mic: false, system: false, error: 'no-stream' }
      return this.snapshot()
    }
    this.status = {
      state: 'recording',
      mic: input.mic,
      system: input.system,
      startedAt: input.now,
    }
    return this.snapshot()
  }

  pause(now: number): MeetingCaptureStatus {
    if (this.status.state !== 'recording') return this.snapshot()
    this.status = { ...this.status, state: 'paused', pausedAt: now }
    return this.snapshot()
  }

  resume(): MeetingCaptureStatus {
    if (this.status.state !== 'paused') return this.snapshot()
    this.status = { ...this.status, state: 'recording', pausedAt: undefined }
    return this.snapshot()
  }

  unplug(stream: CaptureStream): MeetingCaptureStatus {
    if (this.status.state !== 'recording' && this.status.state !== 'paused') return this.snapshot()
    this.status = { ...this.status, state: 'dead', error: `unplug-${stream}`, mic: false, system: false }
    return this.snapshot()
  }

  stop(): MeetingCaptureStatus {
    if (this.status.state === 'idle') return this.snapshot()
    this.status = { ...this.status, state: 'stopped', mic: false, system: false }
    return this.snapshot()
  }
}

function authorize(
  input: {
    actor: MeetingActor
    grants: readonly MeetingGrant[]
    now: number
  },
  source: 'microphone' | 'system',
  capability: 'capture.microphone' | 'capture.system',
) {
  const request: MeetingActionRequest = {
    actor: input.actor,
    capability,
    operation: 'start-capture',
    source,
    payloadHash: 'capture',
    now: input.now,
    permissionMode: 'ask',
    grants: input.grants,
  }
  return authorizeMeetingAction(request)
}
