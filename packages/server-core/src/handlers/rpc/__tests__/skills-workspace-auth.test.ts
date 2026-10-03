import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RpcServer } from '@rox/server-core/transport'
import { registerSkillsHandlers } from '../skills.ts'

describe('skills RPC workspace authorization', () => {
  test('authenticated native client cannot address a different workspace', async () => {
    const handlers = new Map<string, HandlerFn>()
    const server = {
      handle(channel: string, handler: HandlerFn) {
        handlers.set(channel, handler)
      },
    } as unknown as RpcServer
    registerSkillsHandlers(server, { platform: {} } as never)

    const get = handlers.get(RPC_CHANNELS.skills.GET)
    expect(get).toBeDefined()
    await expect(get!({
      clientId: 'native-client',
      workspaceId: 'workspace-a',
      webContentsId: null,
      principal: {
        issuer: 'native-authority',
        subject: 'user-a',
        credentialId: 'credential-a',
        credentialVersion: 1,
      },
    }, 'workspace-b')).rejects.toThrow('Workspace access denied')
  })
})
