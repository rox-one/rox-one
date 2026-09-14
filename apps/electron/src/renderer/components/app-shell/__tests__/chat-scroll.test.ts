import { describe, expect, it } from 'bun:test'
import { followChatOutput } from '../chat-scroll'

describe('retained chat reading position', () => {
  const options = { stickToBottom: true, focused: true, reducedMotion: false, documentVisible: true }
  function viewport() {
    const calls: ScrollToOptions[] = []
    return { clientHeight: 600, scrollHeight: 1900, scrollTo: (value: ScrollToOptions) => calls.push(value), calls }
  }

  it('keeps a scrolled-back panel in place after focus moves to another panel', () => {
    const chat = viewport()
    expect(followChatOutput(chat, { ...options, stickToBottom: false, focused: false })).toBe(false)
    expect(chat.calls).toEqual([])
  })

  it('follows streaming only in the owning chat viewport', () => {
    const chat = viewport()
    const otherChat = viewport()
    expect(followChatOutput(chat, options)).toBe(true)
    expect(chat.calls).toEqual([{ top: 1900, behavior: 'smooth' }])
    expect(otherChat.calls).toEqual([])
  })

  it('uses an immediate update for unfocused or reduced-motion panels', () => {
    const chat = viewport()
    followChatOutput(chat, { ...options, focused: false })
    followChatOutput(chat, { ...options, reducedMotion: true })
    expect(chat.calls).toEqual([
      { top: 1900, behavior: 'instant' },
      { top: 1900, behavior: 'instant' },
    ])
  })

  it('defers hidden-window updates and uses current height when visible again', () => {
    const chat = viewport()
    expect(followChatOutput(chat, { ...options, documentVisible: false })).toBe(false)
    chat.scrollHeight = 2400
    followChatOutput(chat, options)
    expect(chat.calls).toEqual([{ top: 2400, behavior: 'smooth' }])
    expect(followChatOutput(null, options)).toBe(false)
  })

  it('does not reset a retained viewport while its panel has no visible height', () => {
    const chat = viewport()
    chat.clientHeight = 0
    chat.scrollHeight = 0
    expect(followChatOutput(chat, { ...options, focused: false })).toBe(false)
    expect(chat.calls).toEqual([])
    chat.clientHeight = 600
    chat.scrollHeight = 2100
    expect(followChatOutput(chat, options)).toBe(true)
    expect(chat.calls).toEqual([{ top: 2100, behavior: 'smooth' }])
  })
})
