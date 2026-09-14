import { describe, expect, it } from 'bun:test'
import { appendDictationTranscript, createDictationRequestGuard } from '../voice-dictation-state'

describe('dictation draft delivery', () => {
  it('appends to edits made while transcription was pending', async () => {
    const guard = createDictationRequestGuard()
    const request = guard.begin('session-a')
    let currentDraft = 'Original draft'
    const transcript = Promise.resolve(' spoken continuation ')
    currentDraft = 'Draft edited during recording'
    const text = await transcript
    if (guard.isCurrent(request, 'session-a')) currentDraft = appendDictationTranscript(currentDraft, text)
    expect(currentDraft).toBe('Draft edited during recording spoken continuation')
  })

  it('rejects a late result after session switch, cancellation, or a newer recording', () => {
    const guard = createDictationRequestGuard()
    const first = guard.begin('session-a')
    expect(guard.isCurrent(first, 'session-b')).toBe(false)
    guard.cancel()
    expect(guard.isCurrent(first, 'session-a')).toBe(false)
    const second = guard.begin('session-a')
    const third = guard.begin('session-a')
    expect(guard.isCurrent(second, 'session-a')).toBe(false)
    expect(guard.isCurrent(third, 'session-a')).toBe(true)
  })

  it('preserves deliberate spacing, newlines, and drafts when transcription is empty', () => {
    expect(appendDictationTranscript('Notes:\n', 'next line')).toBe('Notes:\nnext line')
    expect(appendDictationTranscript('Draft ', ' words ')).toBe('Draft words')
    expect(appendDictationTranscript('', ' words ')).toBe('words')
    expect(appendDictationTranscript('  draft\n', '  ')).toBe('  draft\n')
  })
})
