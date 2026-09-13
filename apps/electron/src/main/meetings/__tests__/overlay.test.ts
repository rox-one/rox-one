import { describe, expect, test } from 'bun:test'
import { bindMeetingHotkey, createMeetingOverlay, mapOverlayError, openMeetingOverlay, overlayFocusContract } from '../overlay.ts'

describe('meeting overlay (RMA-I013)', () => {
  test('lifecycle, hidden/show, error mapping, duplicate open, hotkey conflict', () => {
    const hidden = createMeetingOverlay()
    expect(overlayFocusContract(hidden.phase)).toEqual({ visible: false, stealFocus: false })
    const open = openMeetingOverlay(hidden, 'rec-1')
    expect(open.phase).toBe('recording')
    expect(overlayFocusContract(open.phase).stealFocus).toBe(false)
    const dup = openMeetingOverlay(open, 'rec-2')
    expect(dup.error).toBe('duplicate-open')
    expect(mapOverlayError('fail')).toBe('error')
    expect(bindMeetingHotkey(['Command+Shift+M'], 'Command+Shift+M')).toEqual({ ok: false, code: 'conflict' })
    expect(bindMeetingHotkey(['Command+Shift+M'], 'Command+Shift+N')).toEqual({ ok: true })
  })
})
