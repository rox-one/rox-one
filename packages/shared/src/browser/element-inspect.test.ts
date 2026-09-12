import { describe, it, expect, beforeEach } from 'bun:test'
import {
  buildStableSelector,
  classifyDestructiveAction,
  getInspectSession,
  parseAnnotations,
  resetInspectSessions,
  resolveSelector,
  serializeAnnotations,
  type LiveElement,
} from './element-inspect.ts'

const PAGE = 'https://shop.example/cart'
const VERSION = 'v1'

function liveCheckout(): LiveElement[] {
  return [
    {
      selector: '[data-testid="checkout"]',
      testId: 'checkout',
      ref: '@e8',
      role: 'button',
      name: 'Checkout',
    },
  ]
}

describe('element inspect (issue 16)', () => {
  beforeEach(() => {
    resetInspectSessions()
  })

  it('builds stable selectors with fallbacks', () => {
    const selector = buildStableSelector({
      ref: '@e8',
      role: 'button',
      name: 'Checkout',
      testId: 'checkout',
    })
    expect(selector.css).toBe('[data-testid="checkout"]')
    expect(selector.fallbacks).toContain('[data-rox-ref="@e8"]')
    expect(selector.fallbacks.some((item) => item.includes('aria-label'))).toBe(true)
  })

  it('annotates a grabbed element without mutating the page', () => {
    const session = getInspectSession('s1')
    session.grab({
      node: { ref: '@e8', testId: 'checkout', role: 'button', name: 'Checkout' },
      pageUrl: PAGE,
      pageVersion: VERSION,
      screenshotBase64: 'aaa',
    })
    session.annotate({ comment: 'Use the mint CTA', pageUrl: PAGE, pageVersion: VERSION })

    const payload = session.toAgentPayload()
    expect(payload.comment).toBe('Use the mint CTA')
    expect(payload.selector.css).toBe('[data-testid="checkout"]')
    expect(payload.screenshotBase64).toBe('aaa')
    expect(session.hasMutatedPage()).toBe(false)
  })

  it('keeps preview edits staged until approval', () => {
    const session = getInspectSession('s1')
    session.grab({
      node: { ref: '@e2', id: 'price' },
      pageUrl: PAGE,
      pageVersion: VERSION,
    })
    const staged = session.stagePreviewEdit({ kind: 'text', value: '$12' })
    expect(session.getPreviewEdit()?.id).toBe(staged.id)
    expect(session.hasMutatedPage()).toBe(false)

    const applied = session.applyPreview([{ selector: '#price', id: 'price', ref: '@e2' }])
    expect(applied.value).toBe('$12')
    expect(session.getPreviewEdit()).toBeNull()
    expect(session.hasMutatedPage()).toBe(true)
  })

  it('requires approval before destructive purchase/publish/submit', () => {
    expect(classifyDestructiveAction({ name: 'Checkout', role: 'button' })).toBe('purchase')
    expect(classifyDestructiveAction({ name: 'Publish post' })).toBe('publish')
    expect(classifyDestructiveAction({ type: 'submit', name: 'Save draft' })).toBe('submit')
    expect(classifyDestructiveAction({ name: 'Open details' })).toBeNull()

    const session = getInspectSession('s1')
    session.grab({
      node: { ref: '@e8', testId: 'checkout', name: 'Checkout' },
      pageUrl: PAGE,
      pageVersion: VERSION,
    })
    session.requestDestructive({ kind: 'purchase', ref: '@e8' })
    expect(session.hasMutatedPage()).toBe(false)
    const approved = session.approveDestructive(liveCheckout())
    expect(approved.kind).toBe('purchase')
    expect(session.hasMutatedPage()).toBe(true)
  })

  it('recovers stale selectors after a page version change', () => {
    const session = getInspectSession('s1')
    session.grab({
      node: { ref: '@e8', testId: 'checkout' },
      pageUrl: PAGE,
      pageVersion: VERSION,
    })
    const annotation = session.annotate({
      comment: 'Confirm the CTA',
      pageUrl: PAGE,
      pageVersion: VERSION,
    })

    const refreshed = session.refreshStale([], PAGE, 'v2')
    expect(refreshed[0]?.stale).toBe(true)

    const recovered = session.recoverStale(annotation.id, {
      ref: '@e22',
      testId: 'checkout-v2',
    })
    expect(recovered.stale).toBe(false)
    expect(recovered.selector.css).toBe('[data-testid="checkout-v2"]')
    expect(resolveSelector(recovered.selector, [
      { testId: 'checkout-v2', ref: '@e22', selector: '[data-testid="checkout-v2"]' },
    ]).status).toBe('matched')
  })

  it('blocks applying a preview against a stale selector', () => {
    const session = getInspectSession('s1')
    session.grab({
      node: { ref: '@e1', testId: 'gone' },
      pageUrl: PAGE,
      pageVersion: VERSION,
    })
    session.stagePreviewEdit({ kind: 'style', value: 'color: red', property: 'style' })
    expect(() => session.applyPreview([])).toThrow(/stale/)
    expect(session.hasMutatedPage()).toBe(false)
  })

  it('round-trips persisted annotations with page URL and version', () => {
    const session = getInspectSession('s1')
    session.grab({
      node: { ref: '@e8', testId: 'checkout' },
      pageUrl: PAGE,
      pageVersion: VERSION,
    })
    session.annotate({ comment: 'Keep', pageUrl: PAGE, pageVersion: VERSION })
    const raw = serializeAnnotations(session.listAnnotations())
    const parsed = parseAnnotations(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.pageUrl).toBe(PAGE)
    expect(parsed[0]?.pageVersion).toBe(VERSION)
    expect(parsed[0]?.comment).toBe('Keep')
  })
})
