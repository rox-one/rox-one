import { useDomForFile, resetDom } from '../../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProfilePermissionsColumn as ProfilePermissionsColumnComponent } from '../ProfilePermissionsColumn'
import {
  canOpenPermissionSettings,
  defaultPermissionValues,
  mergePermissionStatuses,
  type PermissionKey,
  type PermissionStatus,
  type PermissionStatusSnapshot,
  type PermissionValues,
} from '../permission-model'

useDomForFile()

// The UI package pulls browser-only assets and i18n; stub both like the sibling
// onboarding suites so the component renders under Bun.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let ProfilePermissionsColumn: typeof ProfilePermissionsColumnComponent

// Static import cannot work: the component graph must load after the
// browser-only pdfjs/i18n mocks above are registered.
beforeAll(async () => {
  ({ ProfilePermissionsColumn } = await import('../ProfilePermissionsColumn'))
})

afterEach(() => {
  resetDom()
  delete (window as unknown as Record<string, unknown>).electronAPI
})

function values(overrides: Partial<PermissionValues> = {}): PermissionValues {
  return {
    fullDiskAccess: false,
    automation: false,
    accessibility: false,
    screenRecording: false,
    audioRecording: false,
    inputMonitoring: false,
    keepAwake: true,
    importAiHistory: true,
    installedAppsInfo: true,
    launchAgent: true,
    browserAutomation: true,
    ...overrides,
  }
}

function snapshot(statuses: Partial<Record<PermissionKey, PermissionStatus>>): PermissionStatusSnapshot {
  return { platform: 'darwin', statuses }
}

function setApi(api: Record<string, unknown>): void {
  Object.assign(window, { electronAPI: api })
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  return { container, root }
}

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => {
    await promise
  })
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

function switchOf(container: HTMLElement, key: PermissionKey): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="permission-switch-${key}"]`)
  if (!el) throw new Error(`switch for ${key} not rendered`)
  return el
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

describe('ProfilePermissionsColumn', () => {
  it('renders every row and shows the honest pre-hydration defaults', async () => {
    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={() => {}} />)
    await flush()

    expect(container.querySelector('[data-testid="profile-permissions-column"]')).not.toBeNull()
    for (const key of ['fullDiskAccess', 'launchAgent', 'browserAutomation', 'installedAppsInfo'] as PermissionKey[]) {
      expect(container.querySelector(`[data-testid="permission-row-${key}"]`)).not.toBeNull()
    }
    // Unknown OS statuses → rows start unchecked, app toggles stay checked.
    expect(switchOf(container, 'accessibility').getAttribute('aria-checked')).toBe('false')
    expect(switchOf(container, 'keepAwake').getAttribute('aria-checked')).toBe('true')
    await unmount(root)
  })

  it('hydrates OS rows from the probed host status through onChange', async () => {
    const onChange = mock(() => {})
    setApi({
      getOnboardingPermissionsStatus: mock(async () => snapshot({ audioRecording: 'granted', screenRecording: 'denied' })),
    })

    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={onChange} />)
    await flush()

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = (onChange.mock.calls as unknown as Array<[PermissionValues]>)[0][0]
    expect(next.audioRecording).toBe(true)
    expect(next.screenRecording).toBe(false)
    expect(next.keepAwake).toBe(true)
    expect(container.querySelector('[data-testid="permission-chip-audioRecording"]')?.getAttribute('data-status')).toBe('granted')
    expect(container.querySelector('[data-testid="permission-chip-inputMonitoring"]')?.getAttribute('data-status')).toBe('unknown')
    await unmount(root)
  })

  it('leaves installed-apps checked but inert until Full Disk Access is granted', async () => {
    const onChange = mock(() => {})
    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={onChange} />)
    await flush()

    expect(switchOf(container, 'installedAppsInfo').getAttribute('aria-checked')).toBe('true')
    expect(switchOf(container, 'installedAppsInfo').getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector('[data-testid="permission-installed-apps-notice"]')).toBeNull()

    await click(switchOf(container, 'installedAppsInfo'))

    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="permission-installed-apps-notice"]')).not.toBeNull()
    await unmount(root)
  })

  it('reveals the disk-access row from the blocked notice', async () => {
    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={() => {}} />)
    await flush()

    await click(switchOf(container, 'installedAppsInfo'))
    const fix = container.querySelector<HTMLElement>('[data-testid="permission-installed-apps-fix"]')
    expect(fix).not.toBeNull()
    await click(fix!)

    expect(container.querySelector('[data-testid="permission-row-fullDiskAccess"]')?.getAttribute('data-highlighted')).toBe('true')
    expect(container.querySelector('[data-testid="permission-installed-apps-notice"]')).toBeNull()
    await unmount(root)
  })

  it('unlocks the installed-apps toggle once Full Disk Access is on', async () => {
    const onChange = mock(() => {})
    const { container, root } = await render(
      <ProfilePermissionsColumn value={values({ fullDiskAccess: true })} onChange={onChange} />,
    )
    await flush()

    expect(switchOf(container, 'installedAppsInfo').getAttribute('aria-disabled')).toBe('false')
    await click(switchOf(container, 'installedAppsInfo'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect((onChange.mock.calls as unknown as Array<[PermissionValues]>)[0][0].installedAppsInfo).toBe(false)
    await unmount(root)
  })

  it('opens system settings from a denied OS row without mutating values', async () => {
    const onChange = mock(() => {})
    const open = mock(async () => ({ opened: true as const }))
    setApi({
      getOnboardingPermissionsStatus: mock(async () => snapshot({ accessibility: 'denied' })),
      openOnboardingPermissionSettings: open,
    })

    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={onChange} />)
    await flush()
    onChange.mockClear()

    await click(switchOf(container, 'accessibility'))
    expect(open).toHaveBeenCalledWith('accessibility')
    expect(onChange).not.toHaveBeenCalled()

    await click(container.querySelector<HTMLElement>('[data-testid="permission-open-screenRecording"]')!)
    expect(open).toHaveBeenCalledWith('screenRecording')
    await unmount(root)
  })

  it('shows an honest hint when the host cannot open system settings', async () => {
    const open = mock(async () => ({ opened: false as const, hint: 'no-deep-link' as const }))
    setApi({
      getOnboardingPermissionsStatus: mock(async () => snapshot({ automation: 'unknown' })),
      openOnboardingPermissionSettings: open,
    })

    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={() => {}} />)
    await flush()

    await click(container.querySelector<HTMLElement>('[data-testid="permission-open-automation"]')!)
    expect(container.querySelector('[data-testid="permission-open-failure-automation"]')).not.toBeNull()
    await unmount(root)
  })

  it('commits plain in-app toggles through onChange', async () => {
    const onChange = mock(() => {})
    const { container, root } = await render(<ProfilePermissionsColumn value={values()} onChange={onChange} />)
    await flush()

    await click(switchOf(container, 'keepAwake'))
    expect((onChange.mock.calls as unknown as Array<[PermissionValues]>)[0][0].keepAwake).toBe(false)
    await unmount(root)
  })
})

describe('permission-model defaults', () => {
  it('defaults in-app toggles on and OS rows off until a status proves a grant', () => {
    const bare = defaultPermissionValues()
    expect(bare.keepAwake).toBe(true)
    expect(bare.importAiHistory).toBe(true)
    expect(bare.installedAppsInfo).toBe(true)
    expect(bare.launchAgent).toBe(true)
    expect(bare.browserAutomation).toBe(true)
    expect(bare.fullDiskAccess).toBe(false)
    expect(bare.audioRecording).toBe(false)

    const probed = defaultPermissionValues({ audioRecording: 'granted', screenRecording: 'denied' })
    expect(probed.audioRecording).toBe(true)
    expect(probed.screenRecording).toBe(false)
  })

  it('merges probed OS statuses without touching user toggles', () => {
    const merged = mergePermissionStatuses(values({ keepAwake: false }), {
      accessibility: 'granted',
      inputMonitoring: 'unsupported',
    })
    expect(merged.accessibility).toBe(true)
    expect(merged.inputMonitoring).toBe(false)
    expect(merged.keepAwake).toBe(false)
  })

  it('only offers to open settings for denied/unknown OS states', () => {
    expect(canOpenPermissionSettings('denied')).toBe(true)
    expect(canOpenPermissionSettings('unknown')).toBe(true)
    expect(canOpenPermissionSettings('granted')).toBe(false)
    expect(canOpenPermissionSettings('unsupported')).toBe(false)
  })
})