import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../MeetingsWorkspace.tsx'), 'utf8')
const ipc = readFileSync(join(import.meta.dir, '../../../../main/meetings/ipc.ts'), 'utf8')

describe('meetings workspace (I029 / I012 wiring)', () => {
  test('uses existing meetings RPC and device capture IPC, not server-core or localStorage', () => {
    expect(source).toContain('RPC_CHANNELS.meetings.LIST')
    expect(source).toContain('startMeetingCapture')
    expect(source).toContain('MeetingsPage')
    expect(source).not.toContain('@craft-agent/server-core')
    expect(source).not.toContain('localStorage')
    expect(ipc).toContain('meeting-capture:start')
    expect(ipc).toContain('grants: []')
    expect(ipc).not.toContain('new BrowserWindow')
    expect(ipc).not.toContain('localStorage')
  })
})
