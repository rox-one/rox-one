import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '../../shared/types'
import { CHANNEL_MAP } from '../channel-map'

describe('CF-6.3 workgraph channel map', () => {
  it('nests list/get/create under workgraph.*', () => {
    expect(CHANNEL_MAP['workgraph.listConnections']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.LIST_CONNECTIONS,
    })
    expect(CHANNEL_MAP['workgraph.listConnectionAudit']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.LIST_CONNECTION_AUDIT,
    })
    expect(CHANNEL_MAP['workgraph.listConnectionBindings']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.LIST_CONNECTION_BINDINGS,
    })
    expect(CHANNEL_MAP['workgraph.convertConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.CONVERT_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.revokeConnectionBinding']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.REVOKE_CONNECTION_BINDING,
    })
    expect(CHANNEL_MAP['workgraph.getConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.GET_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.createConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.CREATE_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.grantConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.GRANT_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.previewGithubEnv']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.PREVIEW_GITHUB_ENV,
    })
    expect(CHANNEL_MAP['workgraph.importGithubEnv']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.IMPORT_GITHUB_ENV,
    })
    expect(CHANNEL_MAP['workgraph.previewGitHelper']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.PREVIEW_GIT_HELPER,
    })
    expect(CHANNEL_MAP['workgraph.importGitHelper']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.IMPORT_GIT_HELPER,
    })
    expect(CHANNEL_MAP['workgraph.revokeConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.REVOKE_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.repairConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.REPAIR_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.rotateConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.ROTATE_CONNECTION,
    })
    expect(CHANNEL_MAP['workgraph.testConnection']).toEqual({
      type: 'invoke',
      channel: RPC_CHANNELS.workgraph.TEST_CONNECTION,
    })
  })
})


describe('Connections controller transport closure', () => {
  const operations = {
    listConnectionLeases: RPC_CHANNELS.workgraph.LIST_CONNECTION_LEASES,
    inspectConnection: RPC_CHANNELS.workgraph.INSPECT_CONNECTION,
    moveConnection: RPC_CHANNELS.workgraph.MOVE_CONNECTION,
    startGithubDeviceLogin: RPC_CHANNELS.workgraph.START_GITHUB_DEVICE_LOGIN,
    pollGithubDeviceLogin: RPC_CHANNELS.workgraph.POLL_GITHUB_DEVICE_LOGIN,
    cancelGithubDeviceLogin: RPC_CHANNELS.workgraph.CANCEL_GITHUB_DEVICE_LOGIN,
    reconnectConnection: RPC_CHANNELS.workgraph.RECONNECT_CONNECTION,
  } as const
  for (const method of Object.keys(operations) as (keyof typeof operations)[]) {
    const channel = operations[method]
    it(`exposes ${method} through the generated preload API`, () => {
      expect(CHANNEL_MAP[`workgraph.${method}`]).toEqual({ type: 'invoke', channel });
    });
  }
});
