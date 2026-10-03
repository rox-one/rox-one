import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { deferred, elementIn, leafComponent, rendererEffect, settle } from './rox-readiness-ui-001.leaf-harness'

const source = new URL('../../../pages/CloudRunSurfacePage.tsx', import.meta.url)
const row = { id: 'run-A', name: 'Run A', provider: 'native', createdAt: 1, status: { id: 'run-A', state: 'running' } }

function cloudHost(api: Record<string, unknown>, initialState: any = { kind: 'loading' }) {
  const target = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  let tick: (() => void) | undefined
  let cleared = false
  const window = Object.assign(target, { electronAPI: api })
  let state = initialState
  const bindings = {
    runId: 'run-A', window, document, CLOUD_RUN_REFRESH_INTERVAL_MS: 5_000,
    setState: (value: unknown) => { state = value },
    setInterval: (callback: () => void) => { tick = callback; return 1 },
    clearInterval: () => { cleared = true },
  }
  const cleanup = rendererEffect(source, 'async function load', bindings)
  return { window, document, get state() { return state }, tick: () => tick?.(), get cleared() { return cleared }, cleanup }
}

describe('UI-001 selected cloud run refresh and recovery', () => {
  it('transport status failure after a list miss stays unavailable rather than not-found', async () => {
    const host = cloudHost({ getCloudRunsConfig: async () => ({ enabled: true }), listCloudRuns: async () => ({ enabled: true, provider: 'native', runs: [] }), getCloudRunStatus: async () => { throw new Error('transport disconnected') } })
    await settle()
    expect(host.state.kind).toBe('unavailable')
    expect(host.state.reason).toBe('error')
    host.cleanup?.()
  })

  it('a focus refresh observes selected-run deletion while retaining its exact address', async () => {
    let removed = false
    const host = cloudHost({ getCloudRunsConfig: async () => ({ enabled: true }), listCloudRuns: async () => ({ enabled: true, provider: 'native', runs: removed ? [] : [row] }), getCloudRunStatus: async (id: string) => { expect(id).toBe('run-A'); return null } })
    await settle()
    expect(host.state.kind).toBe('ready')
    removed = true
    host.window.dispatchEvent(new Event('focus'))
    await settle()
    expect(host.state.kind).toBe('not-found')
    host.cleanup?.()
  })

  it('a newer focus deletion snapshot cannot be overwritten by an old initial result', async () => {
    const old = deferred<unknown>()
    let reads = 0
    const host = cloudHost({ getCloudRunsConfig: async () => ({ enabled: true }), listCloudRuns: async () => ++reads === 1 ? old.promise : ({ enabled: true, provider: 'native', runs: [] }), getCloudRunStatus: async () => null })
    await settle()
    host.window.dispatchEvent(new Event('focus'))
    await settle()
    expect(host.state.kind).toBe('not-found')
    old.resolve({ enabled: true, provider: 'native', runs: [row] })
    await settle()
    expect(host.state.kind).toBe('not-found')
    host.cleanup?.()
  })

  it('visible periodic refresh detects removal; hidden and cleaned-up hosts stop reading', async () => {
    let removed = false
    let reads = 0
    const host = cloudHost({ getCloudRunsConfig: async () => ({ enabled: true }), listCloudRuns: async () => { reads += 1; return { enabled: true, provider: 'native', runs: removed ? [] : [row] } }, getCloudRunStatus: async () => null })
    await settle()
    expect(host.state.kind).toBe('ready')
    host.document.visibilityState = 'hidden'
    removed = true
    host.tick()
    await settle()
    expect(reads).toBe(1)
    host.document.visibilityState = 'visible'
    host.tick()
    await settle()
    expect(host.state.kind).toBe('not-found')
    host.cleanup?.()
    expect(host.cleared).toBe(true)
    host.window.dispatchEvent(new Event('focus'))
    host.tick()
    await settle()
    expect(reads).toBe(2)
  })

  it('the unavailable UI exposes a real retry callback for the same selected run', () => {
    let attempt = 0
    let stateCall = 0
    const Component = leafComponent(source, 'CloudRunSurfacePage', {
      React: { ...React, useState: () => ++stateCall === 1 ? [{ kind: 'unavailable', reason: 'error' }, () => {}] : [attempt, (update: (value: number) => number) => { attempt = update(attempt) }], useCallback: (fn: unknown) => fn, useEffect: () => {} },
      useTranslation: () => ({ t: (key: string) => key }), useNavigation: () => ({ navigate: () => {} }), routes: { view: { settings: () => 'settings/cloudRuns' } },
    })
    const tree = Component({ runId: 'run-A' })
    const retry = elementIn(tree, (element) => element.props['data-testid'] === 'cloud-run-surface-retry')
    expect(retry).toBeDefined()
    retry!.props.onClick()
    expect(attempt).toBe(1)
    expect(tree.props['data-cloud-run-id']).toBe('run-A')
  })
})
