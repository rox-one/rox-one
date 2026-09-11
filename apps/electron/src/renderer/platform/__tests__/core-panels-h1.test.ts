import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(__dirname, '..', 'core-panels.ts'), 'utf8')

describe('core-panels session inspector registrations', () => {
  it('registers files/git/browser/context for the session surface', () => {
    expect(src).toContain("SESSION_INSPECTOR_WHEN = \"activeSurface=='session'\"")
    expect(src).toContain("'session.inspector.files'")
    expect(src).toContain("'session.inspector.git'")
    expect(src).toContain("'session.inspector.browser'")
    expect(src).toContain("'session.inspector.context'")
    expect(src).not.toContain('session.inspector.terminal')
    expect(src).toContain("id: 'session-harness'")
  })
})
