/**
 * Content-addressed canvas asset blobs under `<workspaceRoot>/canvas/assets/<sha256>`.
 * Metadata lives in the board Y.Doc (`assets` map); bytes stay outside the CRDT.
 * Clean-room — no HyCanvas code or assets.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  ASSET_HASH_RE, isValidAssetHash, MAX_ASSET_BYTES, normalizeAssetMime, sanitizeAssetName,
} from '../asset-meta.ts'
import { atomicWrite } from './file-store.ts'

export { ASSET_HASH_RE, isValidAssetHash, MAX_ASSET_BYTES, normalizeAssetMime, sanitizeAssetName }

export type AssetMeta = { hash: string; mime: string; size: number; name: string }

export function hashAssetBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class CanvasAssetStore {
  readonly dir: string
  constructor(workspaceRoot: string) {
    this.dir = join(workspaceRoot, 'canvas', 'assets')
  }

  pathFor(hash: string): string {
    if (!isValidAssetHash(hash)) throw new Error('canvas: invalid asset hash')
    return join(this.dir, hash)
  }

  async put(bytes: Uint8Array, mime: string, name: string): Promise<AssetMeta> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('canvas: empty asset')
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('canvas: asset too large')
    const norm = normalizeAssetMime(mime)
    if (!norm) throw new Error('canvas: bad asset mime')
    const hash = hashAssetBytes(bytes)
    await fs.mkdir(this.dir, { recursive: true })
    const path = this.pathFor(hash)
    try {
      await fs.access(path)
    } catch {
      await atomicWrite(path, bytes, this.dir)
    }
    return { hash, mime: norm, size: bytes.byteLength, name: sanitizeAssetName(name) }
  }

  async get(hash: string): Promise<Uint8Array> {
    if (!isValidAssetHash(hash)) throw new Error('canvas: invalid asset hash')
    try {
      const buf = await fs.readFile(this.pathFor(hash))
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('canvas: asset not found')
      throw e
    }
  }

  async has(hash: string): Promise<boolean> {
    if (!isValidAssetHash(hash)) return false
    try { await fs.access(this.pathFor(hash)); return true } catch { return false }
  }
}
