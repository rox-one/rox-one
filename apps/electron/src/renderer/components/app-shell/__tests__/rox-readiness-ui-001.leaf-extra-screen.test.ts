import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { deferred, leafClass, leafComponent, leafFunction, leafRegistry, settle } from './rox-readiness-ui-001.leaf-harness'

const hostSource = new URL('../../../pages/extra-screens/ExtraScreenHost.tsx', import.meta.url)
const panelSource = new URL('../MainContentPanel.tsx', import.meta.url)

describe('UI-001 nested extra-screen imports share route recovery attempts', () => {
  it('a failed nested import is reloaded on a new root Retry scope and preserves selected item', async () => {
    let scope = {}
    let calls = 0
    const first = deferred<{ default: React.ComponentType<any> }>()
    const second = deferred<{ default: React.ComponentType<any> }>()
    const reactSeam = { ...React, useContext: () => scope }
    const Boundary = leafClass(panelSource, 'RouteErrorBoundary', { React: reactSeam, RouteRecoveryContext: { Provider: (_props: any) => null } })
    const boundary = new Boundary({ children: null, fallback: (retry: () => void) => React.createElement('button', { onClick: retry }) })
    boundary.setState = (update: any) => { boundary.state = { ...boundary.state, ...update(boundary.state, boundary.props) } }
    scope = boundary.state.scope
    const lazyRoutePage = leafFunction(panelSource, 'lazyRoutePage', { React: reactSeam, RouteRecoveryContext: {} })
    const pages = leafRegistry(hostSource, 'PAGES', {
      React: reactSeam, lazyRoutePage, __load: (path: string) => {
        expect(path).toBe('./dossier/DossierPage')
        return ++calls === 1 ? first.promise : second.promise
      },
    })
    const Host = leafComponent(hostSource, 'ExtraScreenHost', {
      React: reactSeam, PAGES: pages, useTranslation: () => ({ t: (key: string) => key }), useAtomValue: () => true,
      extraScreenFlagAtoms: { dossier: {} }, extraScreenDef: () => ({ labelKey: 'dossier' }), EmptyState: () => null, ScreenButton: () => null,
    })
    const pageElement = (Host({ screen: 'dossier', itemId: 'record-A' }) as any).props.children as React.ReactElement<any>
    const attempt = () => {
      const Page = pageElement.type as any
      return typeof Page === 'function' ? Page(pageElement.props) : pageElement
    }
    const firstPage = attempt() as React.ReactElement<any>
    const failedLazy = firstPage.type as any
    expect(() => failedLazy._init(failedLazy._payload)).toThrow()
    expect(calls).toBe(1)
    const rejected = new Error('nested import failed')
    first.reject(rejected)
    await settle()
    expect(() => failedLazy._init(failedLazy._payload)).toThrow(rejected)
    const sameAttempt = attempt() as React.ReactElement<any>
    expect(sameAttempt.type).toBe(failedLazy)
    boundary.state = { ...boundary.state, ...Boundary.getDerivedStateFromError(rejected) }
    const fallback = boundary.render() as React.ReactElement<any>
    fallback.props.onClick()
    scope = boundary.state.scope
    expect(boundary.state.failed).toBe(false)
    const recoveredPage = attempt() as React.ReactElement<any>
    const recoveredLazy = recoveredPage.type as any
    expect(recoveredLazy).not.toBe(failedLazy)
    expect(recoveredPage.props.itemId).toBe('record-A')
    expect(() => recoveredLazy._init(recoveredLazy._payload)).toThrow()
    expect(calls).toBe(2)
    const component = (_props: any) => null
    second.resolve({ default: component })
    await settle()
    expect(recoveredLazy._init(recoveredLazy._payload)).toBe(component)
    expect(calls).toBe(2)
  })
})
