import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { summaryLeaksSecrets } from '@rox/shared/browser/profile-import'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

mock.module('@rox/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === 'missing' ? null : { id, rootPath: '/tmp/rox-issue15-ws' }),
}))

type Handler = (ctx: unknown, ...args: unknown[]) => unknown

describe('browser profile import RPC', () => {
  it('does not discover browser profiles before explicit consent and requires exact cookie domains', async () => {
    const { registerBrowserProfileImportHandlers } = await import('../browser-profile-import')
    const handlers = new Map<string, Handler>()
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
    } as unknown as RpcServer
    registerBrowserProfileImportHandlers(server, {} as HandlerDeps)

    const discovered = handlers.get(RPC_CHANNELS.browserProfile.DISCOVER)!({}, undefined)
    expect(discovered).toEqual([])

    expect(() =>
      handlers.get(RPC_CHANNELS.browserProfile.IMPORT)!({}, {
        workspaceId: 'missing',
        profileId: 'chromium:none',
        consent: {
          historyBookmarks: true,
          cookies: true,
          credentials: false,
          osCredentialsApproved: false,
          domains: [],
        },
      }),
    ).toThrow('Choose exact domains before importing cookies')
  })
})
