/**
 * e2.4 (part 2) — node-mode coordinator, end to end over the real node plane.
 *
 * A fake permission surface stands in for the live TCC probes. The coordinator
 * resolves the advertisement, declares it on a REAL `NodeClient`, and the REAL
 * `NodeRegistry` (behind a real loopback `WsRpcServer`) records exactly the
 * confirmed grant set — never a `denied` or `unknown` capability.
 *
 * `electron` is mocked before the module graph loads, because the default
 * permission surface imports it; the tests always inject a surface.
 */
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'

import type { NodeView } from '@rox/server-core/nodes'
import type { OnboardingPermissionsSnapshot } from '@rox/server-core/handlers/rpc/onboarding-permissions'
import { advertisedPermissions } from '@rox/shared/device/capabilities'
import type {
  NodeModeCoordinator as NodeModeCoordinatorInstance,
  NodeModeOptions,
} from '../node-mode'

mock.module('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: () => 'unknown',
    isTrustedAccessibilityClient: () => false,
    askForMediaAccess: async () => false,
  },
  desktopCapturer: { getSources: async () => [] },
  shell: { openExternal: async () => {} },
}))

import { NodeRegistry } from '@rox/server-core/nodes'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { WsRpcClient } from '../../../../../packages/server-core/src/transport/client.ts'
import { WsRpcServer } from '../../../../../packages/server-core/src/transport/server.ts'
import { registerNodeHandlers } from '../../../../../packages/server-core/src/handlers/rpc/nodes.ts'
import type { HandlerDeps } from '../../../../../packages/server-core/src/handlers/handler-deps.ts'

let NodeModeCoordinator: new (options: NodeModeOptions) => NodeModeCoordinatorInstance

beforeAll(async () => {
  // The `electron` mock must be installed before the module graph loads, so
  // `node-mode` (and its default permission surface) cannot be a static import.
  ;({ NodeModeCoordinator } = await import('../node-mode'))
})

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * Frames cross a real loopback socket, so a falsified timer cannot drive it;
 * completion is observed by polling the awaited condition, not a guessed delay.
 */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

function spinUp() {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
  const registry = new NodeRegistry({ presenceTtlMs: 30_000, invokeTimeoutMs: 60_000 })
  registerNodeHandlers(server, { nodes: registry } as unknown as HandlerDeps)
  cleanups.push(() => { server.close() })
  return { server, registry }
}

function connect(url: string): WsRpcClient {
  const rpc = new WsRpcClient(url, { autoReconnect: false, connectTimeout: 1_000, requestTimeout: 5_000 })
  cleanups.push(() => rpc.destroy())
  return rpc
}

/** A permission surface whose answer the test can flip between probes. */
function surface(statuses: OnboardingPermissionsSnapshot['statuses']) {
  return {
    calls: 0,
    current: statuses,
    async probePermissions(): Promise<OnboardingPermissionsSnapshot> {
      this.calls += 1
      return { platform: 'darwin', statuses: this.current }
    },
  }
}

const ADVERTISE_SUMMARY = {
  accessibility: 'granted',
  fullDiskAccess: 'granted',
  screenRecording: 'denied',
  audioRecording: 'unknown',
  automation: 'unsupported',
} as const

describe('node-mode capability advertisement', () => {
  it('declares exactly the resolved probed grant set — denied and unknown stay out', async () => {
    const { server, registry } = spinUp()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const permissions = surface({ ...ADVERTISE_SUMMARY })
    const coordinator = new NodeModeCoordinator({
      url,
      nodeId: 'probe-node',
      permissions,
      handlers: {},
      autoReconnect: false,
      heartbeatIntervalMs: 60_000,
    })
    cleanups.push(() => coordinator.destroy())

    const view: NodeView = await coordinator.start()

    // The registered caps equal the pure resolver's view of the probed statuses.
    expect(view.declaredCaps).toEqual(advertisedPermissions(ADVERTISE_SUMMARY))
    expect(view.declaredCaps).toEqual(['accessibility', 'fullDiskAccess'])
    expect(registry.getNode('probe-node')?.declaredCaps).toEqual(['accessibility', 'fullDiskAccess'])

    expect(view.declaredCaps).toContain('accessibility') // granted → present
    expect(view.declaredCaps).not.toContain('screenRecording') // denied → absent
    expect(view.declaredCaps).not.toContain('audioRecording') // unknown → absent, not `false`
    expect(view.declaredCaps).not.toContain('automation') // unsupported → absent

    expect(coordinator.registered?.denied).toEqual(['screenRecording'])
    expect(coordinator.registered?.granted).toEqual(['accessibility', 'fullDiskAccess'])
  })

  it('treats a later permission change as advisory: a denied capability is never silently upgraded', async () => {
    const { server } = spinUp()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const permissions = surface({ screenRecording: 'denied', accessibility: 'granted' })
    const coordinator = new NodeModeCoordinator({
      url,
      nodeId: 'latch-node',
      permissions,
      handlers: {},
      autoReconnect: false,
      heartbeatIntervalMs: 60_000,
    })
    cleanups.push(() => coordinator.destroy())

    const view = await coordinator.start()
    expect(view.declaredCaps).toEqual(['accessibility'])

    // The user later grants screen recording; the re-probe reports it, but the
    // advertised registration must not upgrade in place.
    permissions.current = { screenRecording: 'granted', accessibility: 'granted' }
    const refreshed = await coordinator.refreshAdvertisement()

    expect(refreshed.granted).toEqual(['accessibility']) // denial is final
    expect(refreshed.denied).toEqual(['screenRecording'])
    expect(coordinator.advertisedCaps).toEqual(['accessibility']) // unchanged, no silent upgrade
    expect(permissions.calls).toBe(2) // the re-probe really happened
  })
})

describe('node-mode invoke routing', () => {
  it('answers a declared command and refuses one the node never declared', async () => {
    const { server, registry } = spinUp()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`
    // The server allowlists both, but the node only backs `sys.echo`: the
    // declaration can never widen its own authority.
    registry.setAllowlist('invoke-node', { commands: ['sys.echo', 'sys.secret'] })

    const coordinator = new NodeModeCoordinator({
      url,
      nodeId: 'invoke-node',
      permissions: surface({ accessibility: 'granted' }),
      handlers: {
        'sys.echo': (request) => ({ echoed: request.payload }),
      },
      autoReconnect: false,
      heartbeatIntervalMs: 60_000,
    })
    cleanups.push(() => coordinator.destroy())
    await coordinator.start()

    const requester = connect(url)

    const declared = await requester.invoke(RPC_CHANNELS.nodes.INVOKE, {
      nodeId: 'invoke-node', command: 'sys.echo', payload: { n: 7 },
    })
    expect(declared).toMatchObject({ status: 'ok', nodeId: 'invoke-node', payload: { echoed: { n: 7 } } })

    // `sys.secret` is allowlisted but NOT declared → the registry refuses it
    // before any push, with a typed terminal error.
    const refused = await requester.invoke(RPC_CHANNELS.nodes.INVOKE, {
      nodeId: 'invoke-node', command: 'sys.secret',
    })
    expect(refused).toMatchObject({ status: 'error', error: { code: 'NOT_DECLARED' } })

    // A command neither allowlisted nor declared is refused too; nothing leaked.
    expect(registry.isCommandAuthorized('invoke-node', 'sys.secret')).toBe(false)
    await until(() => registry.pendingCountFor('invoke-node') === 0)
  })
})