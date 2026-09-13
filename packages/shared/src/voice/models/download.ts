import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { ModelFile } from './manifest-schema.ts'
export class ModelDownloadError extends Error {
  readonly code: 'hash' | 'disk' | 'cancel' | 'redirect' | 'archive' | 'signature'
  constructor(code: ModelDownloadError['code'], message: string) { super(message); this.name = 'ModelDownloadError'; this.code = code }
}
export function safeJoin(root: string, relative: string): string {
  if (relative.includes('..') || relative.startsWith('/') || relative.includes('\\')) throw new ModelDownloadError('archive', 'Path traversal rejected')
  const next = resolve(root, relative)
  if (!next.startsWith(resolve(root))) throw new ModelDownloadError('archive', 'Path traversal rejected')
  return next
}
export function verifySha256(bytes: Uint8Array, expected: string): void {
  const actual = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  if (actual !== expected) throw new ModelDownloadError('hash', 'SHA-256 mismatch')
}
export function partPath(dest: string): string { return `${dest}.part` }
export function ensureSpace(_dir: string, needed: number, freeBytes: number): void {
  if (freeBytes < needed) throw new ModelDownloadError('disk', 'Not enough disk space')
}
export async function writeAtomicFile(dest: string, bytes: Uint8Array, expectedSha: string): Promise<void> {
  verifySha256(bytes, expectedSha)
  mkdirSync(dirname(dest), { recursive: true })
  const part = partPath(dest)
  await pipeline(Readable.from(Buffer.from(bytes)), createWriteStream(part))
  renameSync(part, dest)
}
export function resumeOffset(dest: string): number {
  const part = partPath(dest)
  if (existsSync(part)) return statSync(part).size
  if (existsSync(dest)) return statSync(dest).size
  return 0
}
export function cancelPart(dest: string): void {
  const part = partPath(dest)
  if (existsSync(part)) unlinkSync(part)
}
export function fileDest(root: string, file: ModelFile): string { return safeJoin(root, file.path) }
export function downloadRoot(configDir: string): string { return join(configDir, 'voice', 'models') }
