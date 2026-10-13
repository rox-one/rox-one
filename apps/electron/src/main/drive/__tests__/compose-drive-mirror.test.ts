/**
 * R13 — host composition of the app-config mirror engine.
 *
 * Same target resolution as `compose-drive-import.test.ts`: the S3 destination
 * comes from `<configDir>/drive-s3.env` (the packaged app never sees shell
 * env). Without one the engine is left uncomposed so `drive:mirror*` answers
 * `UNSUPPORTED_OPERATION` honestly.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetDriveMirror } from '@rox/server-core/handlers/rpc/drive'
import { composeDriveMirrorEngine } from '../mirror'

const S3_VARS = [
  'ROX_DRIVE_S3_ENDPOINT',
  'ROX_DRIVE_S3_BUCKET',
  'ROX_DRIVE_S3_REGION',
  'ROX_DRIVE_S3_ACCESS_KEY_ID',
  'ROX_DRIVE_S3_SECRET_ACCESS_KEY',
] as const

let savedEnv: Array<[string, string | undefined]> = []
let tempDirs: string[] = []

beforeEach(() => {
  savedEnv = S3_VARS.map(name => [name, process.env[name]])
  for (const name of S3_VARS) delete process.env[name]
})

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv = []
  resetDriveMirror()
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-drive-mirror-'))
  tempDirs.push(dir)
  return dir
}

function writeS3Env(configDir: string): void {
  writeFileSync(
    join(configDir, 'drive-s3.env'),
    [
      'ROX_DRIVE_S3_ENDPOINT=https://s3.rox.one',
      'ROX_DRIVE_S3_BUCKET=rox-drive',
      'ROX_DRIVE_S3_REGION=us-east-1',
      'ROX_DRIVE_S3_ACCESS_KEY_ID=test-access-key',
      'ROX_DRIVE_S3_SECRET_ACCESS_KEY=test-secret',
      '',
    ].join('\n'),
  )
}

describe('composeDriveMirrorEngine target resolution', () => {
  test('composes from <configDir>/drive-s3.env when env vars are absent', () => {
    const configDir = makeConfigDir()
    writeS3Env(configDir)

    const engine = composeDriveMirrorEngine({ configDir, forceMirrorComposition: true })
    expect(engine).not.toBeNull()
    expect(typeof engine?.run).toBe('function')
    expect(typeof engine?.pause).toBe('function')
    expect(typeof engine?.cancel).toBe('function')
    expect(typeof engine?.status).toBe('function')
    expect(engine?.lastResult()).toBeNull()
    // No run has happened: the queue reports an idle snapshot, not a fake one.
    expect(engine?.status().state).toBe('idle')
  })

  test('returns null without throwing when neither env nor file is configured', () => {
    const configDir = makeConfigDir()

    const engine = composeDriveMirrorEngine({ configDir, forceMirrorComposition: true })
    expect(engine).toBeNull()
  })

  test('is idempotent per process unless forced', () => {
    const configDir = makeConfigDir()
    writeS3Env(configDir)

    expect(composeDriveMirrorEngine({ configDir, forceMirrorComposition: true })).not.toBeNull()
    expect(composeDriveMirrorEngine({ configDir })).toBeNull()
  })
})