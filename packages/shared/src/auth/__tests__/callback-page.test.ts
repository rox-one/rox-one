import { describe, expect, it } from 'bun:test'
import { escapeHtml, generateCallbackPage, isSafeDeeplinkUrl } from '../callback-page.ts'

describe('generateCallbackPage XSS', () => {
  it('escapes errorDetail in the HTML body', () => {
    const html = generateCallbackPage({
      title: 'Authorization Failed',
      isSuccess: false,
      errorDetail: '<script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain(escapeHtml('<script>alert(1)</script>'))
  })

  it('escapes title', () => {
    const html = generateCallbackPage({
      title: '</title><script>alert(1)</script>',
      isSuccess: true,
    })
    expect(html).not.toContain('</title><script>alert(1)</script>')
  })

  it('does not embed javascript: deeplinks', () => {
    const html = generateCallbackPage({
      title: 'Authorization Successful',
      isSuccess: true,
      deeplinkUrl: "javascript:alert('xss')",
    })
    expect(html).not.toContain("javascript:alert('xss')")
    expect(html).not.toContain('window.location.href')
  })

  it('embeds a custom-scheme deeplink via JSON.stringify', () => {
    const html = generateCallbackPage({
      title: 'Authorization Successful',
      isSuccess: true,
      deeplinkUrl: 'craft://allSessions/session/abc',
    })
    expect(html).toContain('window.location.href = "craft://allSessions/session/abc"')
    expect(html).toContain('href="craft://allSessions/session/abc"')
  })
})

describe('isSafeDeeplinkUrl', () => {
  it('allows custom schemes and blocks web/script protocols', () => {
    expect(isSafeDeeplinkUrl('craft://x')).toBe(true)
    expect(isSafeDeeplinkUrl('rox://allSessions/session/1')).toBe(true)
    expect(isSafeDeeplinkUrl('https://evil.example')).toBe(false)
    expect(isSafeDeeplinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeDeeplinkUrl('data:text/html,hi')).toBe(false)
  })
})
