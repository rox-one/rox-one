import { describe, expect, it } from 'bun:test'
import {
  PUBLIC_PUBLICATION_ENABLED,
  PUBLICATION_GATE,
  createPublicPublication,
  isCollaborationCard,
  isPublicationCard,
  redactForPublication,
} from '../index.ts'

describe('publication vs collaboration', () => {
  it('keeps the two card kinds distinct', () => {
    expect(isCollaborationCard('collaboration')).toBe(true)
    expect(isPublicationCard('collaboration')).toBe(false)
    expect(isPublicationCard('publication')).toBe(true)
  })

  it('redacts secrets in the local publication preview', () => {
    const source = 'token=sk-abcdefghijkl password: hunter2 Bearer abc.def'
    const preview = redactForPublication(source)
    expect(preview.redactedCount).toBeGreaterThan(0)
    expect(preview.preview).not.toContain('sk-abcdefghijkl')
    expect(preview.preview).not.toContain('hunter2')
    expect(preview.preview).not.toContain('Bearer abc.def')
  })

  it('fail-closes public publication while DG-03 is open', () => {
    expect(PUBLIC_PUBLICATION_ENABLED).toBe(false)
    const result = createPublicPublication({
      sessionId: 'sess-1',
      preview: redactForPublication('hello'),
    })
    expect(result).toEqual({ ok: false, error: PUBLICATION_GATE })
  })
})
