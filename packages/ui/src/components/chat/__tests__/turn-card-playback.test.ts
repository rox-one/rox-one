import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TurnCard, type TurnCardProps } from '../TurnCard'

const compare = (TurnCard as unknown as {
  compare: (previous: TurnCardProps, next: TurnCardProps) => boolean
}).compare

describe('completed turn playback controls', () => {
  const base: TurnCardProps = {
    sessionId: 'qa-session', turnId: 'qa-turn', activities: [],
    isStreaming: false, isComplete: true, isExpanded: false,
    onExpandedChange() {},
  }

  it('updates completed cards when playback starts and stops', () => {
    expect(compare({ ...base, isListening: false }, { ...base, isListening: true })).toBe(false)
    expect(compare({ ...base, isListening: true }, { ...base, isListening: false })).toBe(false)
    expect(compare({ ...base, isListening: false }, { ...base, isListening: false })).toBe(true)
  })

  it('retains the completed card session and turn identity fences', () => {
    expect(compare(base, { ...base, sessionId: 'other-session' })).toBe(false)
    expect(compare(base, { ...base, turnId: 'other-turn' })).toBe(false)
  })

  it('allows synthesized Blob audio in the Electron content security policy', () => {
    const html = readFileSync(join(import.meta.dir, '../../../../../../apps/electron/src/renderer/index.html'), 'utf8')
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!
    const media = policy.split(';').find((part) => part.trim().startsWith('media-src'))!
    expect(media.trim().split(/\s+/)).toEqual(['media-src', "'self'", 'blob:'])
  })
})
