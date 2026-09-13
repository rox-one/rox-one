import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const SUPPORTED_ARTIFACT_FORMATS = ['md', 'csv', 'txt'] as const
export type ArtifactFormat = (typeof SUPPORTED_ARTIFACT_FORMATS)[number]

export type ArtifactBuildResult =
  | { status: 'ok'; path: string; format: ArtifactFormat; sha256: string; bytes: number }
  | { status: 'failed'; code: string }

export function buildMeetingArtifact(input: {
  dir: string
  format: string
  body: string
  allowTools?: readonly string[]
  tool?: string
  sourceAllowed?: boolean
  secretAccess?: boolean
}): ArtifactBuildResult {
  if (input.secretAccess) return { status: 'failed', code: 'secret-denied' }
  if (input.sourceAllowed === false) return { status: 'failed', code: 'source-denied' }
  if (input.tool && input.allowTools && !input.allowTools.includes(input.tool)) {
    return { status: 'failed', code: 'unsupported-tool' }
  }
  if (!(SUPPORTED_ARTIFACT_FORMATS as readonly string[]).includes(input.format)) {
    return { status: 'failed', code: 'unsupported-format' }
  }
  if (!input.body.trim()) return { status: 'failed', code: 'empty-file' }
  mkdirSync(input.dir, { recursive: true })
  const path = join(input.dir, `artifact.${input.format}`)
  writeFileSync(path, input.body)
  const bytes = readFileSync(path)
  if (bytes.byteLength === 0) return { status: 'failed', code: 'empty-file' }
  try {
    const text = bytes.toString('utf8')
    if (input.format === 'csv' && !text.includes(',')) return { status: 'failed', code: 'corrupt-file' }
  } catch {
    return { status: 'failed', code: 'corrupt-file' }
  }
  return {
    status: 'ok',
    path,
    format: input.format as ArtifactFormat,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  }
}

export function readbackArtifact(path: string): { sha256: string; exists: boolean } {
  if (!existsSync(path)) return { sha256: '', exists: false }
  const bytes = readFileSync(path)
  return { sha256: createHash('sha256').update(bytes).digest('hex'), exists: true }
}
