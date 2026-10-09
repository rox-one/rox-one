import { describe, expect, it } from 'bun:test'
import {
  installServiceArtifacts,
  removeServiceArtifacts,
  type ServiceArtifact,
  type ServiceFilesystem,
} from '../launchd-install.ts'

interface FakeEntry { content: string; mode: number }

function createFakeFs(initial: Record<string, FakeEntry> = {}, failWriteAt?: number, failUnlinkAt?: number) {
  const files = new Map<string, FakeEntry>(Object.entries(initial))
  let writes = 0
  let unlinks = 0
  const fs: ServiceFilesystem = {
    readFile: async path => files.get(path)?.content ?? null,
    statMode: async path => files.get(path)?.mode ?? null,
    writeFile: async (path, content, mode) => {
      writes += 1
      if (writes === failWriteAt) throw new Error('disk full')
      files.set(path, { content, mode })
    },
    mkdir: async () => {},
    unlink: async path => {
      unlinks += 1
      if (unlinks === failUnlinkAt) throw new Error('busy')
      files.delete(path)
    },
  }
  return { fs, files, writes: () => writes }
}

const artifacts: ServiceArtifact[] = [
  { path: '/svc/service.env', content: 'ENV=1\n', mode: 0o600 },
  { path: '/svc/wrapper.sh', content: '#!/bin/sh\n', mode: 0o700 },
  { path: '/launch/com.rox.service.plist', content: '<plist/>\n', mode: 0o600 },
]

describe('transactional launchd install', () => {
  it('publishes every artifact with its declared mode', async () => {
    const { fs, files } = createFakeFs()
    await installServiceArtifacts({ artifacts, directories: ['/svc', '/launch'], fs })
    expect([...files.keys()].sort()).toEqual(['/launch/com.rox.service.plist', '/svc/service.env', '/svc/wrapper.sh'])
    expect(files.get('/svc/service.env')).toEqual({ content: 'ENV=1\n', mode: 0o600 })
    expect(files.get('/svc/wrapper.sh')).toEqual({ content: '#!/bin/sh\n', mode: 0o700 })
  })

  it('rolls back to the exact prior state when a later publish step fails', async () => {
    const { fs, files } = createFakeFs({
      '/svc/service.env': { content: 'OLD_ENV=1\n', mode: 0o600 },
      '/launch/com.rox.service.plist': { content: '<old/>\n', mode: 0o644 },
    }, 3)
    await expect(installServiceArtifacts({ artifacts, directories: ['/svc', '/launch'], fs })).rejects.toMatchObject({
      code: 'INSTALL_FAILED',
    })
    expect(files.get('/svc/service.env')).toEqual({ content: 'OLD_ENV=1\n', mode: 0o600 })
    expect(files.get('/launch/com.rox.service.plist')).toEqual({ content: '<old/>\n', mode: 0o644 })
    // The wrapper did not exist before and must not survive the rollback.
    expect(files.has('/svc/wrapper.sh')).toBe(false)
  })

  it('removes every artifact and restores them if an unlink fails midway', async () => {
    const { fs, files } = createFakeFs({
      '/svc/service.env': { content: 'ENV=1\n', mode: 0o600 },
      '/svc/wrapper.sh': { content: '#!/bin/sh\n', mode: 0o700 },
      '/launch/com.rox.service.plist': { content: '<plist/>\n', mode: 0o600 },
    }, undefined, 2)
    await expect(removeServiceArtifacts({ paths: artifacts.map(a => a.path), fs })).rejects.toMatchObject({
      code: 'UNINSTALL_FAILED',
    })
    expect(files.get('/svc/service.env')).toEqual({ content: 'ENV=1\n', mode: 0o600 })
    expect(files.get('/svc/wrapper.sh')).toEqual({ content: '#!/bin/sh\n', mode: 0o700 })
    expect(files.get('/launch/com.rox.service.plist')).toEqual({ content: '<plist/>\n', mode: 0o600 })
  })

  it('removes absent-safe and leaves no artifact behind', async () => {
    const { fs, files } = createFakeFs({
      '/svc/service.env': { content: 'ENV=1\n', mode: 0o600 },
    })
    await removeServiceArtifacts({ paths: [...artifacts.map(a => a.path)], fs })
    expect(files.size).toBe(0)
  })
})