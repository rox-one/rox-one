import { describe, expect, it } from 'bun:test'
import { formatConflictList, showStorageMigrationNotice } from '../StorageMigrationNotices'

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key)
const recorder = () => {
  const calls: Array<[string, string, { description?: string } | undefined]> = []
  return {
    calls,
    success: (message: string, options?: { description?: string }) => calls.push(['success', message, options]),
    warning: (message: string, options?: { description?: string }) => calls.push(['warning', message, options]),
  }
}

describe('W1-13 storage migration notices', () => {
  it('migrated: the existing toast + compat-link strings', () => {
    const notify = recorder()
    showStorageMigrationNotice({ kind: 'migrated', conflicts: [] }, t, notify)
    expect(notify.calls).toEqual([['success', 'storage.migratedToast', { description: 'storage.legacySymlink' }]])
  })

  it('merged with conflicts: toast plus the conflicts notice', () => {
    const notify = recorder()
    showStorageMigrationNotice({ kind: 'merged', conflicts: ['config.json', 'workspaces/a/x.json'] }, t, notify)
    expect(notify.calls[0]?.[1]).toBe('storage.migratedToast')
    expect(notify.calls[1]?.[0]).toBe('warning')
    expect(notify.calls[1]?.[1]).toBe('storage.notice.conflicts|{"files":"config.json, workspaces/a/x.json"}')
  })

  it('foreign ~/rox: only the deferral warning', () => {
    const notify = recorder()
    showStorageMigrationNotice({ kind: 'deferred-foreign', conflicts: [] }, t, notify)
    expect(notify.calls.map((c) => c[1])).toEqual(['storage.notice.foreignDeferred'])
  })

  it('long conflict lists are truncated', () => {
    expect(formatConflictList(['a', 'b', 'c'], 2)).toBe('a, b, +1')
    expect(formatConflictList(['a'])).toBe('a')
  })
})
