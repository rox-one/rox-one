import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PermissionsColumn as PermissionsColumnComponent } from '../PermissionsColumn'
import * as model from '../permissions-model'

useDomForFile()

// The UI package pulls browser-only assets; stub them like the sibling
// onboarding suites so the component renders under Bun.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
mock.module('sonner', () => ({ toast: () => {} }))

let PermissionsColumn: typeof PermissionsColumnComponent

// Static import cannot work: the component graph must load after the
// browser-only pdfjs/i18n mocks above are registered.
beforeAll(async () => {
  ;({ PermissionsColumn } = await import('../PermissionsColumn'))
})

afterEach(() => { resetDom() })

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

function row(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="permission-row-${id}"]`)
  if (!el) throw new Error(`row ${id} not rendered`)
  return el
}

function switchFor(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="permission-switch-${id}"]`)
  if (!el) throw new Error(`switch ${id} not rendered`)
  return el
}

describe('PermissionsColumn', () => {
  it('preselects every visible entry as on by default', async () => {
    const { container, root } = await render(<PermissionsColumn platform="mac" />)

    const switches = container.querySelectorAll('[role="switch"]')
    expect(switches.length).toBe(model.entriesForPlatform('mac').length)
    for (const node of Array.from(switches)) {
      expect(node.getAttribute('aria-checked')).toBe('true')
    }
    expect(row(container, 'installedApps').getAttribute('data-blocked')).toBe('true')
    await unmount(root)
  })

  it('blocks installed-apps without full disk access and unblocks it once granted', async () => {
    const blocked = await render(<PermissionsColumn platform="mac" defaultGrants={{}} />)
    expect(row(blocked.container, 'installedApps').getAttribute('data-blocked')).toBe('true')
    expect(switchFor(blocked.container, 'installedApps').hasAttribute('disabled')).toBe(true)
    await unmount(blocked.root)

    const granted = await render(
      <PermissionsColumn platform="mac" defaultGrants={{ fullDiskAccess: 'granted' }} />,
    )
    expect(row(granted.container, 'installedApps').getAttribute('data-blocked')).toBeNull()
    expect(switchFor(granted.container, 'installedApps').hasAttribute('disabled')).toBe(false)
    await unmount(granted.root)
  })

  it('reports blocked clicks and request-grant separately', async () => {
    const notified: string[] = []
    const requested: string[] = []
    const { container, root } = await render(
      <PermissionsColumn
        platform="mac"
        defaultGrants={{}}
        onRequestGrant={(id) => requested.push(id)}
        onNotifyBlocked={(id) => notified.push(id)}
      />,
    )

    await act(async () => { row(container, 'installedApps').click() })
    expect(notified).toEqual(['installedApps'])

    const grant = container.querySelector<HTMLButtonElement>('[data-testid="permission-grant-audioRecording"]')
    expect(grant).not.toBeNull()
    await act(async () => { grant?.click() })
    expect(requested).toEqual(['audioRecording'])
    await unmount(root)
  })

  it('exposes a continue-state helper for the column', () => {
    expect(model.isPermissionsColumnComplete(model.initialPermissionsState('mac'))).toBe(true)
    const undecided = model.initialPermissionsState('mac')
    delete undecided.enabled.inputMonitoring
    expect(model.isPermissionsColumnComplete(undecided)).toBe(false)
  })
})