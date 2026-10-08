import { describe, expect, test } from 'bun:test'
import { NotesRequestTracker, noteSaveAcknowledgesCurrentDraft } from '../request-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Notes read ownership', () => {
  test('a slow first note cannot replace the note selected afterwards', async () => {
    const requests = new NotesRequestTracker()
    requests.setScope('workspace')
    const slow = deferred<string>()
    const fast = deferred<string>()
    let shown = ''
    const read = async (response: Promise<string>) => {
      const request = requests.begin('document', 'workspace')
      const note = await response
      if (request.isCurrent()) shown = note
    }
    const first = read(slow.promise)
    const second = read(fast.promise)
    fast.resolve('Second note')
    await second
    slow.resolve('First note')
    await first
    expect(shown).toBe('Second note')
  })

  test('returning to a workspace cannot revive reads from its previous visit', () => {
    const requests = new NotesRequestTracker()
    requests.setScope('a')
    const document = requests.begin('document', 'a')
    const catalog = requests.begin('catalog', 'a')
    requests.setScope('b')
    requests.setScope('a')
    expect(document.isCurrent()).toBe(false)
    expect(catalog.isCurrent()).toBe(false)
    expect(requests.begin('document', 'a').isCurrent()).toBe(true)
  })

  test('an old action continuing after a workspace switch cannot displace current work', () => {
    const requests = new NotesRequestTracker()
    requests.setScope('b')
    const current = requests.begin('catalog', 'b')
    const stale = requests.begin('catalog', 'a')
    expect(stale.isCurrent()).toBe(false)
    expect(current.isCurrent()).toBe(true)
  })

  test('clearing selection or unmounting invalidates outstanding reads', () => {
    const requests = new NotesRequestTracker()
    requests.setScope('workspace')
    const document = requests.begin('document')
    const catalog = requests.begin('catalog')
    requests.cancel('document')
    expect(document.isCurrent()).toBe(false)
    expect(catalog.isCurrent()).toBe(true)
    requests.cancelAll()
    expect(catalog.isCurrent()).toBe(false)
  })

  test('unrelated document and asset reads do not cancel each other', () => {
    const requests = new NotesRequestTracker()
    requests.setScope('workspace')
    const document = requests.begin('document')
    const assets = requests.begin('assets')
    requests.setScope('workspace')
    expect(document.isCurrent()).toBe(true)
    expect(assets.isCurrent()).toBe(true)
  })
})

describe('Notes save acknowledgements', () => {
  test('typing while the save is pending leaves the new text dirty', async () => {
    const response = deferred<void>()
    const saved = { workspaceId: 'workspace', noteId: 'note', content: 'First paragraph' }
    let current = { ...saved }
    let dirty = true
    const save = async () => {
      await response.promise
      if (noteSaveAcknowledgesCurrentDraft(saved, current)) dirty = false
    }
    const pending = save()
    current = { ...current, content: 'First paragraph\nSecond paragraph' }
    response.resolve()
    await pending
    expect(dirty).toBe(true)
    expect(current.content).toContain('Second paragraph')
    expect(noteSaveAcknowledgesCurrentDraft(current, current)).toBe(true)
  })

  test('identical paths and text in different workspaces are separate drafts', () => {
    const saved = { workspaceId: 'a', noteId: 'daily/today', content: 'Draft' }
    expect(noteSaveAcknowledgesCurrentDraft(saved, { ...saved, workspaceId: 'b' })).toBe(false)
    expect(noteSaveAcknowledgesCurrentDraft(saved, { ...saved, noteId: 'daily/yesterday' })).toBe(false)
    expect(noteSaveAcknowledgesCurrentDraft(saved, { ...saved, noteId: null })).toBe(false)
    expect(noteSaveAcknowledgesCurrentDraft(saved, saved)).toBe(true)
  })
})
