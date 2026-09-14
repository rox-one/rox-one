/**
 * Client capture honesty for meetings (I031).
 * Web and headless clients do not get a local microphone via gateway presence.
 */

export type MeetingCaptureCapability = {
  supported: boolean
  code: 'ok' | 'web-unsupported' | 'no-device'
}

export function meetingCaptureCapability(input: {
  isWebui?: boolean
  hasDeviceIpc?: boolean
}): MeetingCaptureCapability {
  if (input.isWebui === true) return { supported: false, code: 'web-unsupported' }
  if (input.hasDeviceIpc === false) return { supported: false, code: 'no-device' }
  return { supported: true, code: 'ok' }
}
