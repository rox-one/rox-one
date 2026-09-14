import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('meetings.ts Mail/CRM/calendar/room shells stay fail-closed', () => {
  test('RPC handlers gate mail/crm/calendar/room and do not embed Conation iframe', () => {
    const rpc = source('packages/server-core/src/handlers/rpc/meetings.ts')
    expect(rpc).toContain('gateMeetingConationShell')
    expect(rpc).toContain("gateMeetingConationShell('mail'")
    expect(rpc).toMatch(/gateMeetingConationShell\(\s*'crm'/)
    expect(rpc).toMatch(/gateMeetingConationShell\(\s*'calendar'/)
    expect(rpc).toContain("gateMeetingConationShell('room'")
    expect(rpc).not.toContain('conation.dev')
    expect(rpc).not.toMatch(/<iframe\b/i)
    expect(rpc).not.toContain('CompleteMutationRoot')
  })

  test('electronAPI has no fake-live mailSend method', () => {
    const types = source('apps/electron/src/shared/types.ts')
    expect(types).not.toMatch(/\bmailSend\s*\(/)
    expect(types).not.toMatch(/\bmailSend\s*:/)
    const rpc = source('packages/server-core/src/handlers/rpc/meetings.ts')
    expect(rpc).toContain('MAIL_SEND')
    expect(rpc).toContain('gateMeetingConationShell')
  })
})
