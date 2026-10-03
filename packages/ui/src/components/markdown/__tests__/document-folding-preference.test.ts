import { expect, test } from 'bun:test'
import { readFoldingPreference, writeFoldingPreference } from '../TiptapMarkdownEditor'

test('folding preferences survive reload and are isolated by workspace/document key', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } } })
  try {
    const state = { version: 1 as const, foldedIds: ['heading:1:title'] }
    writeFoldingPreference('workspace-a:note-a', state)
    expect(readFoldingPreference('workspace-a:note-a')).toEqual(state)
    expect(readFoldingPreference('workspace-a:note-b')).toBeNull()
    expect(readFoldingPreference('workspace-b:note-a')).toBeNull()
    values.set('broken', '{')
    expect(readFoldingPreference('broken')).toBeNull()
    values.set('unknown-version', '{"version":2,"foldedIds":[]}')
    expect(readFoldingPreference('unknown-version')).toBeNull()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('unavailable preference storage cannot stop document editing', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('denied') } } })
  try {
    expect(readFoldingPreference('document')).toBeNull()
    expect(() => writeFoldingPreference('document', { version: 1, foldedIds: [] })).not.toThrow()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
