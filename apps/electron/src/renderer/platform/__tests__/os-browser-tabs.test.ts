import { describe, expect, it } from 'bun:test'
import { osBrowserSurfaceTabs, type OsBrowserInstanceLike } from '../os-browser-tabs'

function instance(partial: Partial<OsBrowserInstanceLike> & { id: string }): OsBrowserInstanceLike {
  return {
    title: '',
    url: 'https://example.com',
    boundSessionId: null,
    ownerSessionId: null,
    agentControlActive: false,
    ...partial,
  }
}

describe('osBrowserSurfaceTabs', () => {
  it('drops embedded panes and keeps OS windows', () => {
    const tabs = osBrowserSurfaceTabs(
      [
        instance({ id: 'os-1', title: 'Docs', embedded: false }),
        instance({ id: 'embed-1', title: 'Panel', embedded: true }),
      ],
      'os-1',
      'Browser',
    )
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toEqual({
      instanceId: 'os-1',
      title: 'Docs',
      focused: true,
      boundSessionId: null,
      agentControlActive: false,
    })
  })

  it('falls back to the i18n browser label and prefers boundSessionId', () => {
    const [tab] = osBrowserSurfaceTabs(
      [
        instance({
          id: 'os-2',
          title: '   ',
          boundSessionId: 'sess-bound',
          ownerSessionId: 'sess-owner',
          agentControlActive: true,
        }),
      ],
      null,
      'Browser',
    )
    expect(tab?.title).toBe('Browser')
    expect(tab?.boundSessionId).toBe('sess-bound')
    expect(tab?.focused).toBe(false)
    expect(tab?.agentControlActive).toBe(true)
  })
})
