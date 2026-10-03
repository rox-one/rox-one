import { describe, expect, it, mock } from 'bun:test'
import { parseRouteToNavigationStateOrUnavailable } from '../../shared/route-parser'

// Run this file in a separate Bun process. Only logging is stubbed; the actual
// product parser, route boundary and identity protocol aliases execute below.
mock.module('../logger', () => ({ mainLog: { error: () => {} } }))
const { parseDeepLink } = await import('../deep-link')

describe('UI-001 actual deep-link view query transport', () => {
  for (const scheme of ['rox', 'craftagents']) {
    it(`${scheme}: preserves direct search and unknown query bytes`, () => {
      const target = parseDeepLink(`${scheme}://search?q=hello%20world&keep=a%2Fb%2Cc`)
      expect(target?.view).toBe('search?q=hello%20world&keep=a%2Fb%2Cc')
      expect(parseRouteToNavigationStateOrUnavailable(target!.view!)).toEqual({ navigator: 'search', query: 'hello world' })
    })
    it(`${scheme}: preserves workspace-targeted search and unknown query bytes`, () => {
      expect(parseDeepLink(`${scheme}://workspace/ws-a/search?q=a%26b&keep=x%3Ay`)).toEqual({
        workspaceId: 'ws-a', view: 'search?q=a%26b&keep=x%3Ay', windowMode: undefined, rightSidebar: undefined,
      })
    })
  }

  it('extracts window/sidebar controls without mixing them into the view query', () => {
    expect(parseDeepLink('rox://search?q=a%26b&window=focused&keep=%2F&sidebar=files%2Fsrc')).toEqual({
      workspaceId: undefined, view: 'search?q=a%26b&keep=%2F', windowMode: 'focused', rightSidebar: 'files/src',
    })
  })

  it('recognizes percent-encoded control keys while retaining duplicate query values and unknown flags', () => {
    expect(parseDeepLink('rox://workspace/ws-a/search?q=first&%77indow=full&q=second&keep&%73idebar=history')).toEqual({
      workspaceId: 'ws-a', view: 'search?q=first&q=second&keep', windowMode: 'full', rightSidebar: 'history',
    })
  })

  it('does not append an empty query when only transport controls exist', () => {
    expect(parseDeepLink('rox://home?window=full&sidebar=history')?.view).toBe('home')
  })

  it('preserves malformed percent queries for the renderer unavailable boundary', () => {
    const route = 'search?q=%E0%A4%A&keep=%ZZ'
    const target = parseDeepLink(`rox://${route}`)
    expect(target?.view).toBe(route)
    expect(parseRouteToNavigationStateOrUnavailable(target!.view!)).toEqual({ navigator: 'unavailable', route, details: null })
  })

  it('retains existing action parsing and parameter decoding, including the legacy new-chat action', () => {
    expect(parseDeepLink('craftagents://action/new-chat?input=hello%20world&window=focused&sidebar=history')).toEqual({
      workspaceId: undefined, action: 'new-chat', actionParams: { input: 'hello world' }, windowMode: 'focused', rightSidebar: 'history',
    })
  })

  for (const [url, route] of [
    ['rox://allSessions/session//selected', 'allSessions/session//selected'],
    ['rox://notes/note/selected/', 'notes/note/selected/'],
    ['rox://workspace/ws-a/notes//note/selected', 'notes//note/selected'],
    ['rox://workspace/ws-a/terminal/selected/', 'terminal/selected/'],
    ['rox://terminal/selected#fragment', 'terminal/selected#fragment'],
  ]) {
    it(`retains malformed raw view shape ${url}`, () => {
      const target = parseDeepLink(url)
      expect(target?.view).toBe(route)
      expect(parseRouteToNavigationStateOrUnavailable(target!.view!)).toEqual({ navigator: 'unavailable', route, details: null })
    })
  }

  for (const url of [
    'rox://action/delete-session//selected', 'rox://action/delete-session/selected/',
    'rox://action/delete-session/selected/extra', 'rox://workspace/ws-a/action/delete-session//selected',
    'rox://workspace//ws-a/action/delete-session/selected', 'rox://action/delete-session/%E0%A4%A',
  ]) {
    it(`rejects malformed action/workspace addressing before dispatch ${url}`, () => {
      expect(parseDeepLink(url)).toBeNull()
    })
  }

  it('keeps a canonical targeted action and a legacy settings view working', () => {
    expect(parseDeepLink('rox://workspace/ws-a/action/delete-session/selected?window=focused')).toEqual({
      workspaceId: 'ws-a', action: 'delete-session', actionParams: { id: 'selected' }, windowMode: 'focused', rightSidebar: undefined,
    })
    const target = parseDeepLink('craftagents://settings/toolchain?keep=%2F&sidebar=history')
    expect(target?.view).toBe('settings/toolchain?keep=%2F')
    expect(target?.rightSidebar).toBe('history')
    expect(parseRouteToNavigationStateOrUnavailable(target!.view!)).toEqual({ navigator: 'settings', subpage: 'runtime' })
    expect(parseDeepLink('rox://home')?.view).toBe('home')
  })
})
