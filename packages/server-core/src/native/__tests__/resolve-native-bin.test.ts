import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { resolveNativeBin } from '../supervisor.ts'

const isWindows = process.platform === 'win32'
const exe = isWindows ? 'craft-native.exe' : 'craft-native'

let tmpDir: string
let prevBin: string | undefined

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-native-bin-'))
  prevBin = process.env.CRAFT_NATIVE_BIN
  delete process.env.CRAFT_NATIVE_BIN
})

afterAll(() => {
  if (prevBin === undefined) delete process.env.CRAFT_NATIVE_BIN
  else process.env.CRAFT_NATIVE_BIN = prevBin
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function putExecutable(file: string, body = '#!/bin/sh\ntrue\n'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  if (!isWindows) fs.chmodSync(file, 0o755)
}

describe('resolveNativeBin', () => {
  it('prefers CRAFT_NATIVE_BIN when the file exists', () => {
    const cwd = path.join(tmpDir, 'cwd-env')
    const envBin = path.join(tmpDir, 'from-env', exe)
    putExecutable(envBin)
    expect(resolveNativeBin(cwd, { env: { CRAFT_NATIVE_BIN: envBin } })).toBe(envBin)
  })

  it('skips a missing CRAFT_NATIVE_BIN and uses toolchain current', () => {
    const cwd = path.join(tmpDir, 'cwd-toolchain')
    const configDir = path.join(tmpDir, 'cfg-toolchain')
    const seeded = path.join(configDir, 'toolchain', 'craft-native', 'current', 'bin', exe)
    putExecutable(seeded, '#!/bin/sh\necho toolchain\n')
    expect(
      resolveNativeBin(cwd, {
        env: { CRAFT_NATIVE_BIN: path.join(tmpDir, 'missing-bin') },
        configDir,
      }),
    ).toBe(seeded)
  })

  it('falls back to cargo debug under cwd when toolchain is empty', () => {
    const cwd = path.join(tmpDir, 'cwd-cargo')
    const debug = path.join(cwd, 'native', 'target', 'debug', exe)
    putExecutable(debug, '#!/bin/sh\necho debug\n')
    expect(resolveNativeBin(cwd, { env: {}, configDir: path.join(tmpDir, 'empty-cfg') })).toBe(
      debug,
    )
  })

  it('returns null when env, toolchain, and cargo bins are absent', () => {
    const cwd = path.join(tmpDir, 'cwd-empty')
    fs.mkdirSync(cwd, { recursive: true })
    expect(resolveNativeBin(cwd, { env: {}, configDir: path.join(tmpDir, 'empty-cfg-2') })).toBeNull()
  })
})
