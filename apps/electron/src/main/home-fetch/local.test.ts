import { describe, expect, it } from 'bun:test'
import { dockerSocketPath, mapContainers, readSystemStats } from './local'

describe('home-fetch local data', () => {
  it('maps docker containers to the minimal view', () => {
    expect(mapContainers([{ Id: '0123456789abcdef', Names: ['/web'], Image: 'nginx', State: 'running', Status: 'Up 2 hours', Env: ['SECRET=x'], Mounts: [{}] }, 'junk', {}])).toEqual([
      { id: '0123456789ab', name: 'web', image: 'nginx', state: 'running', status: 'Up 2 hours' },
    ])
    expect(mapContainers({ message: 'no' })).toBeNull()
  })
  it('finds a docker socket', () => {
    expect(dockerSocketPath('linux', '/h', (p) => p === '/h/.colima/default/docker.sock')).toBe('/h/.colima/default/docker.sock')
    expect(dockerSocketPath('darwin', '/h', () => false)).toBeNull()
  })
  it('reads system stats', async () => {
    const a = await readSystemStats()
    expect(a.cpus).toBeGreaterThan(0)
    expect(a.memUsed).toBeLessThanOrEqual(a.memTotal)
    expect(a.load).toHaveLength(3)
  })
})
