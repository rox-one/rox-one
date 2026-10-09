import { describe, expect, it } from 'bun:test'
import type { ClipChangedPayload, ClipSettings } from '@rox/shared/clipboard-history'
import {
  ClipboardMonitor,
  GIF_FORMAT,
  type ClipboardAdapter,
  type ClipboardImagePreview,
  type MonitorTimerHandle,
} from '../monitor'
import { DEFAULT_CLIP_SETTINGS, MAX_TEXT_BYTES, type ClipEntryInput, type ClipboardEntrySink, type InsertResult } from '../store'

/** Deterministic clock + timer queue; the monitor never touches the real event loop. */
class FakeClock {
  time = 1_000_000
  readonly delays: number[] = []
  private readonly timers = new Map<number, { at: number; run: () => void }>()
  private nextId = 1

  now = (): Date => new Date(this.time)
  setTimeout = (run: () => void, delay: number): MonitorTimerHandle => {
    const id = this.nextId++
    this.delays.push(delay)
    this.timers.set(id, { at: this.time + delay, run })
    return id as unknown as MonitorTimerHandle
  }

  clearTimeout = (handle: MonitorTimerHandle): void => { this.timers.delete(handle as unknown as number) }

  advance(ms: number): void {
    const target = this.time + ms
    for (;;) {
      let dueId = -1
      let dueAt = Infinity
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < dueAt) { dueAt = timer.at; dueId = id }
      }
      if (dueId === -1) break
      const timer = this.timers.get(dueId)!
      this.timers.delete(dueId)
      this.time = timer.at
      timer.run()
    }
    this.time = target
  }
}

/** Manual async gate so a tick can be held open across a second `captureNow`. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(resolved => { resolve = resolved })
  return { promise, resolve }
}

class FakeAdapter implements ClipboardAdapter {
  types: string[] = []
  text = ''
  rawFormats: Record<string, boolean> = {}
  bytes: Record<string, Buffer> = {}
  preview: ClipboardImagePreview | null = null
  failReadTypes = false
  failReadText = false
  failHasRawFormat = false
  failDecode = false
  failReadTypeBytesFor: string | null = null
  readTextCalls = 0
  textGate: { promise: Promise<void>; resolve: () => void } | null = null

  async readTypes(): Promise<string[]> {
    if (this.failReadTypes) throw new Error('adapter read failed')
    return this.types
  }

  async readText(): Promise<string> {
    this.readTextCalls += 1
    if (this.textGate) await this.textGate.promise
    if (this.failReadText) throw new Error('readText failed')
    return this.text
  }

  async hasRawFormat(rawFormat: string): Promise<boolean> {
    if (this.failHasRawFormat) throw new Error('hasRawFormat failed')
    return this.rawFormats[rawFormat] === true
  }

  async readTypeBytes(mimeType: string): Promise<Buffer | null> {
    if (this.failReadTypeBytesFor === mimeType || this.failReadTypeBytesFor === '*') throw new Error('readTypeBytes failed')
    return this.bytes[mimeType] ?? null
  }

  async writeText(): Promise<void> {}
  async writeTypeBytes(): Promise<void> {}

  async decodeImage(): Promise<ClipboardImagePreview | null> {
    if (this.failDecode) throw new Error('decode failed')
    return this.preview
  }
}

class FakeSink implements ClipboardEntrySink {
  entries: ClipEntryInput[] = []
  settings: ClipSettings = { ...DEFAULT_CLIP_SETTINGS }
  failWrite = false
  private readonly seen = new Set<string>()
  insertOrResurface(entry: ClipEntryInput): InsertResult {
    if (this.failWrite) throw new Error('store write failed')
    const key = entry.kind === 'text' ? `text:${entry.text}` : `image:${entry.imageBytes?.toString('base64') ?? ''}`
    const inserted = !this.seen.has(key)
    this.seen.add(key)
    this.entries.push(entry)
    return { id: this.entries.length, inserted }
  }
  getSettings(): ClipSettings { return this.settings }
}

function setup(): { monitor: ClipboardMonitor; adapter: FakeAdapter; sink: FakeSink; clock: FakeClock; changes: ClipChangedPayload[]; errors: unknown[] } {
  const adapter = new FakeAdapter()
  const sink = new FakeSink()
  const clock = new FakeClock()
  const changes: ClipChangedPayload[] = []
  const errors: unknown[] = []
  const monitor = new ClipboardMonitor({
    adapter,
    sink,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChanged: payload => changes.push(payload),
    onError: error => errors.push(error),
  })
  return { monitor, adapter, sink, clock, changes, errors }
}

describe('ClipboardMonitor', () => {
  it('captures changed text and resurfaces repeated content', async () => {
    const { monitor, adapter, sink, changes } = setup()
    adapter.types = ['public.utf8-plain-text']
    adapter.text = 'hello'
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0]).toEqual({ kind: 'text', text: 'hello' })
    expect(changes).toEqual([{ reason: 'captured' }])

    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)

    adapter.text = 'world'
    await monitor.captureNow()
    adapter.text = 'hello'
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(3)
    expect(changes[2]).toEqual({ reason: 'updated' })
  })

  it('skips concealed formats only while hideSensitive is on', async () => {
    const { monitor, adapter, sink, changes } = setup()
    adapter.rawFormats['org.nspasteboard.ConcealedType'] = true
    adapter.types = ['text/plain']
    adapter.text = 'secret'
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(0)

    sink.settings.hideSensitive = false
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    expect(changes).toEqual([{ reason: 'captured' }])
  })

  it('probes concealment before reading any payload', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.rawFormats['org.nspasteboard.TransientType'] = true
    adapter.types = ['text/plain', 'image/png']
    adapter.text = 'secret'
    adapter.bytes['image/png'] = Buffer.from('png-bytes')

    await monitor.captureNow()

    expect(sink.entries).toHaveLength(0)
    expect(adapter.readTextCalls).toBe(0)
  })

  it('captures an image once and stores a thumbnail', async () => {
    const { monitor, adapter, sink } = setup()
    const png = Buffer.from('png-bytes')
    adapter.types = ['image/png', 'public.tiff']
    adapter.bytes['image/png'] = png
    adapter.preview = { width: 1024, height: 768, thumbnailPng: Buffer.from('thumb-240x160') }
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0]).toEqual({
      kind: 'image',
      imageBytes: png,
      imageFormat: 'png',
      imageWidth: 1024,
      imageHeight: 768,
      thumbnailPng: Buffer.from('thumb-240x160'),
    })

    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
  })

  it('prefers GIF bytes over a raster MIME when both are present', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.rawFormats[GIF_FORMAT] = true
    adapter.types = ['image/png']
    adapter.bytes[GIF_FORMAT] = Buffer.from('gif-bytes')
    adapter.bytes['image/png'] = Buffer.from('png-bytes')
    adapter.preview = { width: 10, height: 10, thumbnailPng: Buffer.from('thumb') }

    await monitor.captureNow()

    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0]).toMatchObject({ kind: 'image', imageFormat: 'gif' })
    expect(sink.entries[0].imageBytes?.toString()).toBe('gif-bytes')
  })

  it('stores a GIF without a thumbnail when the decoder cannot read it', async () => {
    const { monitor, adapter, sink, errors } = setup()
    adapter.rawFormats[GIF_FORMAT] = true
    adapter.bytes[GIF_FORMAT] = Buffer.from('gif-bytes')
    adapter.preview = null

    await monitor.captureNow()

    expect(errors).toHaveLength(0)
    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0]).toEqual({ kind: 'image', imageBytes: Buffer.from('gif-bytes'), imageFormat: 'gif' })
  })

  it('skips a non-portable image format instead of mislabeling it', async () => {
    const { monitor, adapter, sink, errors } = setup()
    adapter.types = ['image/webp', 'image/tiff']
    adapter.bytes['image/webp'] = Buffer.from('webp-bytes')
    adapter.bytes['image/tiff'] = Buffer.from('tiff-bytes')
    adapter.preview = { width: 4, height: 4, thumbnailPng: Buffer.from('thumb') }

    await monitor.captureNow()

    expect(sink.entries).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  it('skips a raster image whose bytes cannot be decoded', async () => {
    const { monitor, adapter, sink, errors } = setup()
    adapter.types = ['image/png']
    adapter.bytes['image/png'] = Buffer.from('not-an-image')
    adapter.preview = null

    await monitor.captureNow()

    expect(sink.entries).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  it('skips single-line image filenames and oversized text', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.types = ['text/plain']
    adapter.text = '/Users/me/Pictures/screenshot.PNG'
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(0)

    adapter.text = 'x'.repeat(MAX_TEXT_BYTES + 1)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(0)

    adapter.text = 'a\nscreenshot.png\nmore'
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
  })

  it('treats whitespace-only text as no text and falls through to the image branch', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.types = ['text/plain', 'image/png']
    adapter.text = '   \n  '
    adapter.bytes['image/png'] = Buffer.from('png-bytes')
    adapter.preview = { width: 2, height: 2, thumbnailPng: Buffer.from('thumb') }

    await monitor.captureNow()

    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0].kind).toBe('image')
  })

  it('suppresses the tick after an own write', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.types = ['text/plain']
    adapter.text = 'copied from history'
    monitor.notifyOwnWrite()
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(0)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
  })

  it('does not capture while capture is disabled', async () => {
    const { monitor, adapter, sink } = setup()
    sink.settings.captureEnabled = false
    adapter.types = ['text/plain']
    adapter.text = 'ignored'
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(0)
  })

  it('captures two different images that share an identical format list', async () => {
    const { monitor, adapter, sink, clock } = setup()
    adapter.types = ['image/png']
    adapter.preview = { width: 1, height: 1, thumbnailPng: Buffer.from('thumb') }
    adapter.bytes['image/png'] = Buffer.from('first-png')
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    adapter.bytes['image/png'] = Buffer.from('second-png')
    clock.advance(1_200)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(2)
    expect(sink.entries[0].imageBytes?.toString()).toBe('first-png')
    expect(sink.entries[1].imageBytes?.toString()).toBe('second-png')
  })

  it('captures the same image only once (no second row, no double resurface)', async () => {
    const { monitor, adapter, sink, changes, clock } = setup()
    adapter.types = ['image/png']
    adapter.bytes['image/png'] = Buffer.from('stable-png')
    adapter.preview = { width: 1, height: 1, thumbnailPng: Buffer.from('thumb') }
    await monitor.captureNow()
    clock.advance(5_000)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    expect(changes).toEqual([{ reason: 'captured' }])
  })

  it('retries a failed image read on a later tick and captures on success', async () => {
    const { monitor, adapter, sink, clock } = setup()
    adapter.types = ['image/png']
    adapter.preview = { width: 1, height: 1, thumbnailPng: Buffer.from('thumb') }
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(0)
    adapter.bytes['image/png'] = Buffer.from('recovered-png')
    clock.advance(1_200)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
  })

  it('throttles the text-free image branch to one read per interval (injected clock)', async () => {
    const { monitor, adapter, sink, clock } = setup()
    adapter.types = ['image/png']
    adapter.preview = { width: 1, height: 1, thumbnailPng: Buffer.from('thumb') }
    adapter.bytes['image/png'] = Buffer.from('one')
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)

    adapter.bytes['image/png'] = Buffer.from('two')
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    clock.advance(1_000)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    clock.advance(300)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(2)
  })

  it('resync forgets fingerprints so cleared content is re-recorded once', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.types = ['text/plain']
    adapter.text = 'same'
    await monitor.captureNow()
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(1)
    await monitor.resync()
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(2)
    await monitor.captureNow()
    expect(sink.entries).toHaveLength(2)
  })

  it('switches to the slow interval after the activity window', async () => {
    const { monitor, clock } = setup()
    monitor.start()
    expect(clock.delays[0]).toBe(300)
    expect(monitor.getIntervalMs()).toBe(300)
    clock.advance(31_000)
    expect(monitor.getIntervalMs()).toBe(750)
    expect(clock.delays.at(-1)).toBe(750)
    monitor.stop()
  })

  it('swallows a rejected readText into onError', async () => {
    const { monitor, adapter, sink, errors } = setup()
    adapter.types = ['text/plain']
    adapter.failReadText = true
    await expect(monitor.captureNow()).resolves.toBeUndefined()
    expect(sink.entries).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it('swallows a rejected readTypeBytes into onError', async () => {
    const { monitor, adapter, errors } = setup()
    adapter.types = ['image/png']
    adapter.failReadTypeBytesFor = 'image/png'
    await expect(monitor.captureNow()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  it('swallows a failing store write into onError', async () => {
    const { monitor, adapter, sink, errors } = setup()
    adapter.types = ['text/plain']
    adapter.text = 'hello'
    sink.failWrite = true
    await expect(monitor.captureNow()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  it('discards overlapping ticks so content is captured only once', async () => {
    const { monitor, adapter, sink } = setup()
    adapter.types = ['text/plain']
    adapter.text = 'once'
    const gate = deferred()
    adapter.textGate = gate

    const first = monitor.captureNow()
    const second = monitor.captureNow()
    gate.resolve()
    await first
    await second

    expect(sink.entries).toHaveLength(1)
  })
})