import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { connect } from '@tursodatabase/database'
import { afterEach, describe, expect, it } from 'bun:test'

import { assertCredentialRefId, createWorkGraphKernel } from './index'

const CRED = 'cred_123e4567-e89b-12d3-a456-426614174000'
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('assertCredentialRefId', () => {
  it('brands a UUID-shaped cred_ ref', () => {
    expect(assertCredentialRefId(CRED)).toBe(CRED)
  })

  it('rejects unbranded and malformed ids', () => {
    expect(() => assertCredentialRefId('not-a-cred')).toThrow(/credentialRefId/)
    expect(() => assertCredentialRefId('cred_not-a-uuid')).toThrow(/credentialRefId/)
    expect(() => assertCredentialRefId('')).toThrow(/credentialRefId/)
  })
})

describe('WorkGraph credentialRefId on read', () => {
  nativeIt('fails closed when a stored connection ref is malformed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-workgraph-ref-'))
    roots.push(root)
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: CRED,
      storageMode: 'copy',
    })
    await kernel.close()

    const db = await connect(join(root, 'workgraph', 'workgraph.db'), { fileMustExist: true })
    try {
      await db.run("UPDATE workgraph_connections SET credential_ref_id = 'not-a-cred' WHERE id = ?", [connection.id])
    } finally {
      await db.close()
    }

    const reader = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await expect(reader.getConnection('workspace_a', connection.id)).rejects.toThrow(/credentialRefId/)
    await reader.close()
  })
})
