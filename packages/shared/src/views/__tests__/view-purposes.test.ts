import { describe, expect, it } from 'bun:test'
import { getDefaultViews } from '../defaults.ts'

describe('P35-10 session view purposes', () => {
  it('gives plan, overview, and process a one-line purpose', () => {
    const views = getDefaultViews()
    expect(views.find((v) => v.id === 'view-plan')?.description).toContain('plan')
    expect(views.find((v) => v.id === 'view-new')?.description).toContain('unread')
    expect(views.find((v) => v.id === 'view-processing')?.description).toContain('running')
    for (const view of views) {
      expect((view.description ?? '').length).toBeGreaterThan(8)
    }
  })
})
