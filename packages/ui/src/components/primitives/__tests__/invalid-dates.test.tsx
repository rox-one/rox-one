/**
 * W1-08 (#1505 fix1) — a missing/invalid ISO date must not throw a
 * RangeError and take down CommentsThread / ActivityTimeline.
 */
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommentsThread } from '../../comments'
import { ActivityTimeline } from '../../activity-timeline'
import { formatInstant } from '../tokens'

const author = { id: 'u1', name: 'Анна' }

describe('invalid dates', () => {
  it('formatInstant returns "" for missing or invalid values', () => {
    const fmt = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'UTC' })
    expect(formatInstant(fmt, 'not a date')).toBe('')
    expect(formatInstant(fmt, '')).toBe('')
    expect(formatInstant(fmt, undefined)).toBe('')
    expect(formatInstant(fmt, null)).toBe('')
    expect(formatInstant(fmt, '2026-10-08T05:00:00Z')).toBe('2026')
  })

  it('CommentsThread renders a comment with an invalid createdAt', () => {
    const render = () => renderToStaticMarkup(
      <CommentsThread
        comments={[
          { id: 'c1', author, body: 'Привет', createdAt: 'garbage' },
          { id: 'c2', author, body: 'Ok', createdAt: '2026-10-08T05:00:00Z' },
        ] as never}
        timeZone="UTC"
        onCreate={() => {}}
      />,
    )
    expect(render).not.toThrow()
    const html = render()
    expect(html).toContain('Привет')
    expect(html.match(/<time /g)?.length).toBe(1)
  })

  it('ActivityTimeline renders events with an invalid `at`', () => {
    const render = () => renderToStaticMarkup(
      <ActivityTimeline
        events={[
          { id: 'e1', type: 'task.updated', at: 'garbage', actor: author, summary: 'Broken date' },
          { id: 'e2', type: 'task.updated', at: '2026-10-01T05:00:00Z', actor: author, summary: 'Good date' },
        ]}
        now={Date.parse('2026-10-08T05:00:00Z')}
        timeZone="UTC"
      />,
    )
    expect(render).not.toThrow()
    const html = render()
    expect(html).toContain('Broken date')
    expect(html).toContain('Good date')
  })
})
