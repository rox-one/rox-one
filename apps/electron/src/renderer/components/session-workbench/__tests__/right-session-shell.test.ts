import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bindSurfaceContext, sameContextSnapshot } from '@craft-agent/core/rox2'
import {
  RIGHT_SESSION_FOCUS_TARGET,
  RIGHT_SESSION_PROMPT_TEST_ID,
  RIGHT_SESSION_SHELL_TEST_ID,
  bindRightSessionContext,
  describeRightSessionOpen,
  revisionByEntityId,
} from '../right-session-shell.ts'

const rendererRoot = join(import.meta.dir, '../../../')
const read = (rel: string) => readFileSync(join(rendererRoot, rel), 'utf8')

const notesSurface = {
  workspaceId: 'ws-1',
  surfaceId: 'notes',
  entityRefs: ['note:daily'] as const,
  permissionMode: 'allow-all' as const,
}

describe('right session shell', () => {
  test('binds via bindSurfaceContext and copies revision when present', () => {
    const ctx = bindRightSessionContext({
      ...notesSurface,
      sessionId: 's1',
      revisionByEntityId: { 'note:daily': 'rev-9' },
    })
    const expected = bindSurfaceContext({
      ...notesSurface,
      sessionId: 's1',
      revisionByEntityId: { 'note:daily': 'rev-9' },
    })
    expect(ctx.binding?.revisionByEntityId['note:daily']).toBe('rev-9')
    expect(ctx.binding?.snapshotPolicy).toBe('snapshot')
    expect(sameContextSnapshot(ctx, expected)).toBe(true)
  })

  test('omits revision map when none is present', () => {
    const ctx = bindRightSessionContext({
      ...notesSurface,
      sessionId: 's2',
    })
    expect(ctx.binding?.revisionByEntityId).toEqual({})
    expect(revisionByEntityId('note:daily', undefined)).toBeUndefined()
    expect(revisionByEntityId('note:daily', 0)).toBeUndefined()
    expect(revisionByEntityId('note:daily', 171)).toEqual({ 'note:daily': '171' })
  })

  test('repeated open of the same snapshot reuses the session', () => {
    const current = bindRightSessionContext({
      ...notesSurface,
      sessionId: 's1',
      revisionByEntityId: { 'note:daily': '171' },
    })
    expect(describeRightSessionOpen(current, {
      ...notesSurface,
      revisionByEntityId: { 'note:daily': '171' },
    })).toBe('reuse')
    expect(describeRightSessionOpen(current, {
      ...notesSurface,
      entityRefs: ['note:other'],
      revisionByEntityId: { 'note:other': '171' },
    })).toBe('open')
    expect(describeRightSessionOpen(null, notesSurface)).toBe('open')
  })

  test('snapshot policy does not silently follow a later document revision', () => {
    const current = bindRightSessionContext({
      ...notesSurface,
      sessionId: 's1',
      revisionByEntityId: { 'note:daily': 'rev-1' },
    })
    expect(describeRightSessionOpen(current, {
      ...notesSurface,
      revisionByEntityId: { 'note:daily': 'rev-2' },
    })).toBe('open')
  })

  test('focus target is the session shell', () => {
    expect(RIGHT_SESSION_FOCUS_TARGET).toBe('session')
    expect(RIGHT_SESSION_SHELL_TEST_ID).toBe('right-session-shell')
    expect(RIGHT_SESSION_PROMPT_TEST_ID).toBe('right-session-prompt')
  })

  test('Notes keeps the left surface and opens the reusable right shell', () => {
    const notes = read('pages/NotesPage.tsx')
    const shell = read('components/session-workbench/RightSessionShell.tsx')
    expect(notes).toContain('RightSessionShell')
    expect(notes).toContain('bindRightSessionContext')
    expect(notes).toContain('describeRightSessionOpen')
    expect(notes).toContain('revisionByEntityId')
    expect(notes).toContain('NOTES_SURFACE_ID')
    expect(notes).not.toMatch(/navigate\(routes\.view\.allSessions\(sessionId\)\)/)
    expect(shell).toContain('data-testid={RIGHT_SESSION_SHELL_TEST_ID}')
    expect(shell).toContain('data-testid={RIGHT_SESSION_PROMPT_TEST_ID}')
    expect(shell).toContain("t('notes.sideSession.title')")
    expect(shell).toContain('.focus(')
  })
})
