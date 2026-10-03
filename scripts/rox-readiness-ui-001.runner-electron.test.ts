import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as harness from '../tests/e2e/meeting-agents/harness'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('meeting executable override is exact and refuses absent or non-executable native payloads before spawn', () => {
  const resolve = (harness as unknown as Record<string, unknown>).resolveMeetingElectronExecutable as ((env?: NodeJS.ProcessEnv) => string) | undefined
  expect(typeof resolve).toBe('function')
  if (!resolve) return
  const root = mkdtempSync(join(tmpdir(), 'rox-native-path-'))
  roots.push(root)
  const executable = join(root, 'Electron payload')
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', {mode: 0o700})
  expect(resolve({ ROX_MEETING_ELECTRON_EXECUTABLE: executable })).toBe(executable)
  chmodSync(executable, 0o600)
  if (process.platform !== 'win32') expect(() => resolve({ ROX_MEETING_ELECTRON_EXECUTABLE: executable })).toThrow(harness.BootMeetingAppError)
  expect(() => resolve({ ROX_MEETING_ELECTRON_EXECUTABLE: join(root, 'missing') })).toThrow(harness.BootMeetingAppError)
  expect(() => resolve({ ROX_MEETING_ELECTRON_EXECUTABLE: './relative-electron' })).toThrow(harness.BootMeetingAppError)
})
