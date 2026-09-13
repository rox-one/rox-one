import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMeetingArtifact, readbackArtifact } from '../artifacts.ts'

describe('meeting artifacts (RMA-I016)', () => {
  test('empty, corrupt, unsupported tool, denied source, and secret access fail honestly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-'))
    expect(buildMeetingArtifact({ dir, format: 'md', body: '' }).status).toBe('failed')
    expect(buildMeetingArtifact({ dir, format: 'csv', body: 'not-a-row' })).toEqual({ status: 'failed', code: 'corrupt-file' })
    expect(buildMeetingArtifact({ dir, format: 'md', body: '# x', tool: 'shell', allowTools: ['write'] })).toEqual({ status: 'failed', code: 'unsupported-tool' })
    expect(buildMeetingArtifact({ dir, format: 'md', body: '# x', sourceAllowed: false })).toEqual({ status: 'failed', code: 'source-denied' })
    expect(buildMeetingArtifact({ dir, format: 'md', body: '# x', secretAccess: true })).toEqual({ status: 'failed', code: 'secret-denied' })
  })

  test('successful markdown is hashed and readable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-ok-'))
    const built = buildMeetingArtifact({ dir, format: 'md', body: '# Notes\nHello' })
    expect(built.status).toBe('ok')
    if (built.status === 'ok') {
      const back = readbackArtifact(built.path)
      expect(back.exists).toBe(true)
      expect(back.sha256).toBe(built.sha256)
      expect(built.bytes).toBeGreaterThan(0)
    }
  })
})
