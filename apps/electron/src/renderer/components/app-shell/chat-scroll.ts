interface ChatScrollViewport {
  clientHeight: number
  scrollHeight: number
  scrollTo(options: ScrollToOptions): void
}

/** Follow output inside this chat, without scrolling the surrounding workspace. */
export function followChatOutput(viewport: ChatScrollViewport | null, options: {
  stickToBottom: boolean
  focused: boolean
  reducedMotion: boolean
  documentVisible: boolean
}): boolean {
  if (!viewport || !options.stickToBottom || !options.documentVisible || viewport.clientHeight <= 0) return false
  viewport.scrollTo({
    top: viewport.scrollHeight,
    behavior: options.focused && !options.reducedMotion ? 'smooth' : 'instant',
  })
  return true
}
