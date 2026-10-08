import { describe, expect, it } from 'bun:test'
import { localWorkspacesForSkillsBroadcast } from '../headless-start.ts'

describe('localWorkspacesForSkillsBroadcast (PERF-02 review)', () => {
  it('skips remote workspaces in the post-sync skills broadcast', () => {
    const local = { id: 'a', rootPath: '/tmp/a' }
    const remote = { id: 'b', rootPath: '/remote/b', remoteServer: { url: 'wss://example.invalid', token: 'x' } }
    const unsetRemote = { id: 'c', rootPath: '/tmp/c', remoteServer: undefined }
    expect(localWorkspacesForSkillsBroadcast([local, remote, unsetRemote]).map(w => w.id)).toEqual(['a', 'c'])
  })
})
