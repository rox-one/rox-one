import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  CONCEALED_CLIPBOARD_TYPE,
  CONCEALED_FORMAT,
  setConcealedClipboardItemFactory,
  writeClipboardTextConcealed,
  type ConcealedClipboard,
  type ConcealedClipboardItemFactory,
} from '../conceal'

/** Stand-in for Electron's `ClipboardItem`, exposing the single-format record. */
interface FakeClipboardItem {
  types: Record<string, string>
}

/** Installs a factory that records each built item and returns the recording list. */
function captureItems(): FakeClipboardItem[] {
  const items: FakeClipboardItem[] = []
  const factory = ((types: Record<string, string>) => {
    const item: FakeClipboardItem = { types }
    items.push(item)
    return item
  }) as unknown as ConcealedClipboardItemFactory
  setConcealedClipboardItemFactory(factory)
  return items
}

afterEach(() => setConcealedClipboardItemFactory(null))

describe('writeClipboardTextConcealed', () => {
  it('writes the text and the concealed marker in one atomic write', async () => {
    const items = captureItems()
    const clipboard: ConcealedClipboard = {
      writeText: () => { throw new Error('must not fall back to writeText') },
      write: () => {},
    }

    await writeClipboardTextConcealed('gateway-token', clipboard)

    expect(items).toHaveLength(1)
    expect(items[0]!.types).toEqual({
      'text/plain': 'gateway-token',
      [CONCEALED_CLIPBOARD_TYPE]: '1',
    })
  })

  it('exposes the ConcealedType pasteboard format under the raw osclipboard key', () => {
    expect(CONCEALED_FORMAT).toBe('org.nspasteboard.ConcealedType')
    expect(CONCEALED_CLIPBOARD_TYPE).toBe(
      'electron application/osclipboard;format="org.nspasteboard.ConcealedType"',
    )
  })

  it('falls back to writeText when the combined write rejects', async () => {
    captureItems()
    const writes: string[] = []
    const clipboard: ConcealedClipboard = {
      writeText: text => { writes.push(text) },
      write: () => { throw new Error('atomic write unavailable') },
    }

    await expect(writeClipboardTextConcealed('secret', clipboard)).resolves.toBeUndefined()
    expect(writes).toEqual(['secret'])
  })

  it('writes plain text when the clipboard has no multi-format write', async () => {
    captureItems()
    const writes: string[] = []
    await writeClipboardTextConcealed('secret', { writeText: text => { writes.push(text) } })
    expect(writes).toEqual(['secret'])
  })

  it('awaits an asynchronous writeText fallback before resolving', async () => {
    captureItems()
    const order: string[] = []
    await writeClipboardTextConcealed('secret', {
      writeText: async () => { await Promise.resolve(); order.push('text') },
    })
    expect(order).toEqual(['text'])
  })

  // Regression: Electron's main process has no `ClipboardItem` global — the
  // constructor is a module export. Using the bare global made every concealed
  // write throw and silently fall back to a plain (capturable) text write.
  it('builds the marker item from the electron module export, not a global', async () => {
    const writes: Array<Record<string, string>> = []
    const electronModule = {
      ClipboardItem: class {
        readonly items: Record<string, string>
        constructor(items: Record<string, string>) { this.items = items }
      },
    }
    mock.module('electron', () => electronModule)
    setConcealedClipboardItemFactory(null)
    const hostWithoutGlobal = globalThis as { ClipboardItem?: unknown }
    const savedGlobal = hostWithoutGlobal.ClipboardItem
    delete hostWithoutGlobal.ClipboardItem

    try {
      await writeClipboardTextConcealed('gateway-token', {
        writeText: () => { throw new Error('must not fall back to writeText') },
        write: items => { writes.push((items[0] as unknown as { items: Record<string, string> }).items) },
      })
    } finally {
      if (savedGlobal !== undefined) hostWithoutGlobal.ClipboardItem = savedGlobal
      mock.restore()
      mock.module('electron', () => ({ default: {} }))
    }

    expect(writes).toEqual([{
      'text/plain': 'gateway-token',
      [CONCEALED_CLIPBOARD_TYPE]: '1',
    }])
  })
})