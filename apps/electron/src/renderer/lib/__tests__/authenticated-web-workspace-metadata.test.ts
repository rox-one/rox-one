import { describe, expect, it } from 'bun:test'
import type { ElectronAPI } from '../../../shared/types'
import { loadAuthenticatedWebWorkspaceMetadata, type AuthenticatedWebTransportBootstrap } from '../authenticated-web-bootstrap'

const bootstrap: AuthenticatedWebTransportBootstrap = { kind: 'authenticated-web-transport', workspaceId: 'bound-workspace' }
type MetadataApi = Parameters<typeof loadAuthenticatedWebWorkspaceMetadata>[0]
function apiWith(rows: unknown, binding: () => Promise<string | null> = async () => bootstrap.workspaceId): MetadataApi {
  return { getRuntimeEnvironment: () => 'web', getWindowWorkspace: binding,
    getWorkspaces: async () => rows as Awaited<ReturnType<ElectronAPI['getWorkspaces']>> }
}

describe('authenticated web workspace display metadata', () => {
  it('projects the matching id/name and strips host paths, native authority and credentials', async () => {
    const rows = [
      { id: 'other-workspace', name: 'Foreign workspace', rootPath: '/host/foreign' },
      { id: bootstrap.workspaceId, name: 'Appearance acceptance', rootPath: '/host/private', slug: 'host-slug',
        createdAt: 123, kind: 'native', remoteServer: { token: 'fixture-only-credential' }, authority: 'native' },
    ]
    expect(await loadAuthenticatedWebWorkspaceMetadata(apiWith(rows), bootstrap)).toEqual([{
      id: bootstrap.workspaceId, name: 'Appearance acceptance', slug: bootstrap.workspaceId, rootPath: '', createdAt: 0,
    }])
  })

  it('filters foreign ids and invalid matching names without inventing a workspace', async () => {
    for (const rows of [[], [{ id: 'other', name: 'Foreign' }], [null],
      [{ id: bootstrap.workspaceId, name: '' }], [{ id: bootstrap.workspaceId, name: ' \t' }],
      [{ id: bootstrap.workspaceId, name: 12 }]]) {
      expect(await loadAuthenticatedWebWorkspaceMetadata(apiWith(rows), bootstrap)).toEqual([])
    }
    await expect(loadAuthenticatedWebWorkspaceMetadata(apiWith({}), bootstrap)).rejects.toThrow('metadata is unavailable')
    await expect(loadAuthenticatedWebWorkspaceMetadata(apiWith([
      { id: bootstrap.workspaceId, name: 'One' }, { id: bootstrap.workspaceId, name: 'Two' },
    ]), bootstrap)).rejects.toThrow('metadata is ambiguous')
  })

  it('rejects non-web and unbound callers before loading metadata', async () => {
    let reads = 0
    const api = apiWith([])
    api.getWorkspaces = async () => { reads++; return [] }
    api.getRuntimeEnvironment = () => 'electron'
    await expect(loadAuthenticatedWebWorkspaceMetadata(api, bootstrap)).rejects.toThrow('browser runtime')
    api.getRuntimeEnvironment = () => 'web'
    api.getWindowWorkspace = async () => 'foreign-workspace'
    await expect(loadAuthenticatedWebWorkspaceMetadata(api, bootstrap)).rejects.toThrow('binding changed')
    expect(reads).toBe(0)
  })

  it('rejects a binding change while metadata is in flight', async () => {
    let bound: string | null = bootstrap.workspaceId
    let finish!: (rows: Awaited<ReturnType<ElectronAPI['getWorkspaces']>>) => void
    let reading!: () => void
    const entered = new Promise<void>(resolve => { reading = resolve })
    const api = apiWith([], async () => bound)
    api.getWorkspaces = () => { reading(); return new Promise(resolve => { finish = resolve }) }
    const result = loadAuthenticatedWebWorkspaceMetadata(api, bootstrap)
    await entered
    bound = 'foreign-workspace'
    finish([{ id: bootstrap.workspaceId, name: 'Late original workspace' }] as Awaited<ReturnType<ElectronAPI['getWorkspaces']>>)
    await expect(result).rejects.toThrow('binding changed while reading metadata')
  })

  it('preserves metadata read errors instead of creating fallback display records', async () => {
    const api = apiWith([])
    api.getWorkspaces = async () => { throw new Error('metadata request denied') }
    await expect(loadAuthenticatedWebWorkspaceMetadata(api, bootstrap)).rejects.toThrow('metadata request denied')
  })
})
