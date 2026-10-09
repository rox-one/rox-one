import { describe, expect, it } from 'bun:test'
import { handleDeepLink } from '../deep-link'
import { RPC_CHANNELS } from '../../shared/types'
import type { EventSink } from '@rox/server-core/transport'
import type { WindowManager } from '../window-manager'

function createMockWindow(webContentsId: number) {
  return {
    isMinimized: () => false,
    restore: () => {},
    focus: () => {},
    isDestroyed: () => false,
    webContents: {
      id: webContentsId,
      isLoading: () => false,
      isDestroyed: () => false,
      once: () => {},
    },
  }
}

describe('handleDeepLink routing', () => {
  it('delivers the native search query and future parameters through the actual navigation sink', async () => {
    const targetWindow = createMockWindow(22)
    const manager = {
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager
    const sent: unknown[][] = []
    const result = await handleDeepLink('rox://search?q=two%20words&mode=future', manager,
      (_channel, _target, ...args) => { sent.push(args) }, () => 'client-target')
    expect(result.success).toBe(true)
    expect(sent).toEqual([[{ view: 'search?q=two%20words&mode=future', action: undefined, actionParams: undefined }]])
  })
  it('prefers resolved target client over preferred caller client', async () => {
    const targetWindow = createMockWindow(22)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: (webContentsId: number) => webContentsId === 22 ? 'ws-target' : 'ws-other',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'craftagents://workspace/ws-target/allSessions',
      windowManager,
      sink,
      (wcId) => wcId === 22 ? 'client-target' : undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.channel).toBe(RPC_CHANNELS.deeplink.NAVIGATE)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-target' })
  })

  it('uses preferred client only when no resolver is provided', async () => {
    const targetWindow = createMockWindow(31)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'craftagents://workspace/ws-target/allSessions',
      windowManager,
      sink,
      undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-caller' })
  })

  it('falls back to workspace routing when resolver exists but target client is unresolved', async () => {
    const targetWindow = createMockWindow(44)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'craftagents://workspace/ws-target/allSessions',
      windowManager,
      sink,
      () => undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.target).toEqual({ to: 'workspace', workspaceId: 'ws-target' })
  })

  it('routes the Rox deeplink scheme the same as the Craft-era alias', async () => {
    const targetWindow = createMockWindow(22)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: (webContentsId: number) => webContentsId === 22 ? 'ws-target' : 'ws-other',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'rox://workspace/ws-target/allSessions',
      windowManager,
      sink,
      (wcId) => wcId === 22 ? 'client-target' : undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.channel).toBe(RPC_CHANNELS.deeplink.NAVIGATE)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-target' })
  })

  it("tags pane-originated navigations with source: 'browser-pane'", async () => {
    const targetWindow = createMockWindow(22)
    const manager = {
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager
    const sent: unknown[][] = []
    const result = await handleDeepLink(
      'rox://action/new-session?input=x&send=true&mode=allow-all',
      manager,
      (_channel, _target, ...args) => { sent.push(args) },
      () => 'client-target',
      undefined,
      'browser-pane',
    )

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.[0]).toMatchObject({
      source: 'browser-pane',
      action: 'new-session',
      actionParams: { mode: 'allow-all' },
    })
  })

  it('omits source when the caller does not provide one', async () => {
    const targetWindow = createMockWindow(22)
    const manager = {
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager
    const sent: unknown[][] = []
    await handleDeepLink(
      'rox://action/new-session?input=x&send=true&mode=allow-all',
      manager,
      (_channel, _target, ...args) => { sent.push(args) },
      () => 'client-target',
    )

    const navigation = sent[0]?.[0]
    expect(typeof navigation === 'object' && navigation !== null && 'source' in navigation).toBe(false)
  })
})

describe('ROX protocol compatibility', () => {
  it('parses ROX as primary and keeps existing legacy links readable', async () => {
    const { parseDeepLink } = await import('../deep-link');
    expect(parseDeepLink('rox://allSessions/session/example')).toEqual(parseDeepLink('craftagents://allSessions/session/example'));
    expect(parseDeepLink('rox://allSessions/session/example')).not.toBeNull();
    expect(parseDeepLink('unrelated://allSessions/session/example')).toBeNull();
  });
});
