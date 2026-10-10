import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeDriveImportEngine } from '../register'

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
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-drive-compose-'))
  tempDirs.push(dir)
  return dir
}

describe('composeDriveImportEngine target resolution', () => {
  test('composes from <configDir>/drive-s3.env when env vars are absent', () => {
    const configDir = makeConfigDir()
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

    const runner = composeDriveImportEngine({ configDir, forceImportComposition: true })
    expect(runner).not.toBeNull()
  })

  test('returns null without throwing when neither env nor file is configured', () => {
    const configDir = makeConfigDir()

    const runner = composeDriveImportEngine({ configDir, forceImportComposition: true })
    expect(runner).toBeNull()
  })
})