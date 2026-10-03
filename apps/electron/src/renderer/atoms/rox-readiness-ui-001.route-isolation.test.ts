import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import { parseSessionIdFromRoute, panelStackAtom, focusedPanelIdAtom, focusedSessionIdAtom, visibleSessionIdsAtom, pushPanelAtom } from './panel-stack'
import type { ViewRoute } from '../../shared/routes'
import { buildSemanticHistoryKey } from '../contexts/navigation-history'
import { encodePanelEntries, decodePanelEntries } from '../lib/panel-url'

describe('UI-001 invalid raw route isolation',()=>{
  it('new panels stay visible and survive URL restore while preserving existing size ratios',()=>{
    const store=createStore()
    store.set(panelStackAtom,[
      {id:'a',route:'home' as ViewRoute,proportion:0.75,panelType:'other',laneId:'main'},
      {id:'b',route:'notes' as ViewRoute,proportion:0.25,panelType:'other',laneId:'main'},
    ])
    store.set(pushPanelAtom,{route:'unknown/a,b:0.25?x=%ZZ' as ViewRoute})
    const panels=store.get(panelStackAtom)
    expect(panels.map(panel=>panel.proportion)).toEqual([0.5,1/6,1/3])
    expect(panels[0].proportion/panels[1].proportion).toBe(3)
    expect(decodePanelEntries(encodePanelEntries(panels)).map(panel=>panel.route)).toEqual(['home','notes','unknown/a,b:0.25?x=%ZZ'])
    expect(store.get(focusedPanelIdAtom)).toBe(panels[2].id)
  })
  it('invalid prefixes/shapes cannot impersonate a visible or focused session',()=>{
    for(const route of ['unknown/session/first-a','allSessions/session/first-a/extra','allSessions/session/%ZZ','knowledge/unknown/session/first-a']) {
      expect(parseSessionIdFromRoute(route as ViewRoute)).toBeNull()
      const store=createStore()
      store.set(panelStackAtom,[{id:'p',route:route as ViewRoute,proportion:1,panelType:'other',laneId:'main'}])
      store.set(focusedPanelIdAtom,'p')
      expect(store.get(focusedSessionIdAtom)).toBeNull()
      expect([...store.get(visibleSessionIdsAtom)]).toEqual([])
    }
    expect(parseSessionIdFromRoute('allSessions/session/first-a?foo=bar' as ViewRoute)).toBe('first-a')
  })
  it('raw delimiters cannot collide between distinct panel histories',()=>{
    const key=(panelRoutes:string[])=>buildSemanticHistoryKey({workspaceSlug:'ws',panelRoutes,focusedPanelIndex:0,sidebarParam:''})
    expect(key(['bad/a|b','bad/c'])).not.toBe(key(['bad/a','b|bad/c']))
    expect(key(['bad/a::b'])).not.toBe(buildSemanticHistoryKey({workspaceSlug:'ws::bad/a',panelRoutes:['b'],focusedPanelIndex:0,sidebarParam:''}))
  })
})
