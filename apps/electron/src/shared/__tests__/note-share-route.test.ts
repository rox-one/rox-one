import { describe, expect, it } from 'bun:test'
import { parseRouteToNavigationStateOrUnavailable } from '../route-parser'

describe('note share deep link route', () => {
  it('carries the untrusted share token and drops the URL role', () => {
    const state = parseRouteToNavigationStateOrUnavailable('notes/note/Daily?share=aaaaaaaaaaaaaaaaaaaaaaaa&role=edit')
    expect(state).toEqual({ navigator: 'notes', details: { type: 'note', noteId: 'Daily', shareToken: 'aaaaaaaaaaaaaaaaaaaaaaaa' } })
  })
  it('plain note routes carry no token', () => {
    expect(parseRouteToNavigationStateOrUnavailable('notes/note/Daily')).toEqual({ navigator: 'notes', details: { type: 'note', noteId: 'Daily' } })
  })
})
