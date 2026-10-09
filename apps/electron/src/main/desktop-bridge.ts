/**
 * Main-process side of the embedded-surface desktop bridge.
 *
 * The Control-UI window's preload (`rox-desktop.ts`) forwards one validated
 * envelope over `ROX_DESKTOP_BRIDGE_CHANNEL`. This module re-validates that
 * envelope against the shared contract and dispatches to the handler map. The
 * map is keyed by the contract's method union, so a missing or extra handler is
 * a compile error; `__tests__/desktop-bridge.test.ts` asserts the same at runtime.
 *
 * Concrete host capabilities are injected by `index.ts`, which wires the real
 * `BrowserPaneManager`, the onboarding permission host, `shell.openExternal`,
 * the OpenClaw runtime manager and the notification service.
 */

import {
  ROX_DESKTOP_BRIDGE_CHANNEL,
  ROX_DESKTOP_BRIDGE_VERSION,
  validateRoxDesktopBridgeRequest,
  type RoxDesktopBridgeMethod,
  type RoxDesktopBridgeResponse,
} from '@rox/shared/desktop-bridge/contract'

export type DesktopBridgeHandler = (params: unknown) => Promise<unknown>

/** Browser-pane operations reused from `BrowserPaneManager`. */
export interface DesktopBridgeBrowserHost {
  openInstance(params: {
    readonly id?: string
    readonly workspaceId: string | null
    readonly url?: string
    readonly show?: boolean
  }): Promise<string>
  navigateInstance(params: {
    readonly id: string
    readonly url: string
  }): Promise<{ url: string; title: string }>
  releaseScope(params: { readonly workspaceId: string }): Promise<{ released: string[] }>
}

export interface DesktopBridgeDependencies {
  readonly browser: DesktopBridgeBrowserHost
  /** Onboarding permission probe reused from `onboarding-permissions.ts`. */
  readonly permissions: { probePermissions(): Promise<unknown> }
  readonly openExternal: (url: string) => Promise<void>
  readonly gateway: { getStatus(workspaceId: string): Promise<unknown> }
  readonly notify: (params: { readonly title: string; readonly body?: string }) => void | Promise<void>
}

function requireRecord(params: unknown, method: RoxDesktopBridgeMethod): Record<string, unknown> {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error(`${method}: params must be an object`)
  }
  return params as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string, method: RoxDesktopBridgeMethod): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${method}: "${key}" must be a non-empty string`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Builds the handler map. The `Record<RoxDesktopBridgeMethod, …>` return type
 * makes the contract registry and the handler set impossible to drift at
 * compile time.
 */
export function createDesktopBridgeHandlers(
  deps: DesktopBridgeDependencies,
): Record<RoxDesktopBridgeMethod, DesktopBridgeHandler> {
  return {
    'browser.open': async params => {
      const record = requireRecord(params, 'browser.open')
      const workspaceId = optionalString(record, 'workspaceId') ?? null
      return deps.browser.openInstance({
        id: optionalString(record, 'id'),
        workspaceId,
        url: optionalString(record, 'url'),
        show: optionalBoolean(record, 'show'),
      })
    },
    'browser.navigate': async params => {
      const record = requireRecord(params, 'browser.navigate')
      return deps.browser.navigateInstance({
        id: requireString(record, 'id', 'browser.navigate'),
        url: requireString(record, 'url', 'browser.navigate'),
      })
    },
    'browser.releaseScope': async params => {
      const record = requireRecord(params, 'browser.releaseScope')
      return deps.browser.releaseScope({ workspaceId: requireString(record, 'workspaceId', 'browser.releaseScope') })
    },
    'device.permissionStatus': async () => deps.permissions.probePermissions(),
    'app.openLink': async params => {
      const record = requireRecord(params, 'app.openLink')
      await deps.openExternal(requireString(record, 'url', 'app.openLink'))
      return { opened: true }
    },
    'gateway.status': async params => {
      const record = requireRecord(params, 'gateway.status')
      return deps.gateway.getStatus(requireString(record, 'workspaceId', 'gateway.status'))
    },
    'notifications.show': async params => {
      const record = requireRecord(params, 'notifications.show')
      await deps.notify({
        title: requireString(record, 'title', 'notifications.show'),
        body: optionalString(record, 'body'),
      })
      return { shown: true }
    },
  }
}

/**
 * Builds the dispatcher once: the handler map is constructed a single time and
 * reused for every envelope. Never throws across the IPC boundary — an invalid
 * envelope or a failing handler becomes a typed refusal.
 */
export function createDesktopBridgeDispatcher(
  deps: DesktopBridgeDependencies,
): (input: unknown) => Promise<RoxDesktopBridgeResponse> {
  const handlers = createDesktopBridgeHandlers(deps)
  return async input => {
    const validation = validateRoxDesktopBridgeRequest(input)
    if (!validation.ok) return validation
    try {
      return { ok: true, result: await handlers[validation.method](validation.params) }
    } catch {
      return {
        ok: false,
        code: 'ROX_DESKTOP_BRIDGE_HANDLER_FAILED',
        expectedVersion: ROX_DESKTOP_BRIDGE_VERSION,
        method: validation.method,
      }
    }
  }
}

/** One-shot validation + dispatch, used by tests and simple callers. */
export function dispatchDesktopBridgeRequest(
  deps: DesktopBridgeDependencies,
  input: unknown,
): Promise<RoxDesktopBridgeResponse> {
  return createDesktopBridgeDispatcher(deps)(input)
}

export interface DesktopBridgeIpcDependencies extends DesktopBridgeDependencies {
  readonly ipcMain: {
    handle(
      channel: string,
      listener: (event: { sender: { id: number } }, input: unknown) => Promise<unknown>,
    ): void
  }
}

/** Registers the single bridge IPC channel on the Control-UI host. */
export function registerDesktopBridgeIpc(deps: DesktopBridgeIpcDependencies): void {
  const dispatch = createDesktopBridgeDispatcher(deps)
  deps.ipcMain.handle(ROX_DESKTOP_BRIDGE_CHANNEL, (_event, input) => dispatch(input))
}

// Re-exported so the main-process wiring and tests share one channel constant.
export { ROX_DESKTOP_BRIDGE_CHANNEL }