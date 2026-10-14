import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANVAS_IPC, readCanvasFlag, registerCanvasIpc } from '../canvas-ipc'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'canvas-ipc-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function fakeSender(id = 1) {
  const listeners: Record<string, () => void> = {}
  return { id, sent: [] as unknown[][], isDestroyed: () => false, send(...a: unknown[]) { this.sent.push(a) }, once(ev: string, cb: () => void) { listeners[ev] = cb }, destroy() { listeners.destroyed?.() } }
}
export function setup(opts: { configDir?: string; root?: string; resolve?: (ws: string) => string | null } = {}) {
  const handlers = new Map<string, (...a: any[]) => any>()
  const root = opts.root ?? tmp()
  const senders = new Map<number, ReturnType<typeof fakeSender>>()
  const registry = registerCanvasIpc({ handle: (ch: string, fn: any) => { handlers.set(ch, fn) } } as any, {
    resolveWorkspaceRoot: opts.resolve ?? (() => root),
    configDir: opts.configDir,
    rendererById: id => senders.get(id) as any,
  })
  const call = (ch: string, sender: ReturnType<typeof fakeSender>, ...a: unknown[]) => { senders.set(sender.id, sender); return handlers.get(ch)!({ sender }, ...a) }
  return { call, registry, root, fakeSender }
}

describe('canvas flag sync to main (S5)', () => {
  it('reads the persisted value at init and gates handlers on false', async () => {
    const cfg = tmp()
    const a = setup({ configDir: cfg })
    const s = fakeSender()
    expect((await a.call(CANVAS_IPC.list, s, 'ws')).length).toBe(0) // default ON
    await a.call(CANVAS_IPC.setEnabled, s, false)
    expect(readCanvasFlag(cfg)).toBe(false)
    await expect(a.call(CANVAS_IPC.list, s, 'ws')).rejects.toThrow('CANVAS_DISABLED')
    const b = setup({ configDir: cfg })
    await expect(b.call(CANVAS_IPC.list, s, 'ws')).rejects.toThrow('CANVAS_DISABLED')
    await b.call(CANVAS_IPC.setEnabled, s, true)
    expect(readCanvasFlag(cfg)).toBe(true)
    expect(Array.isArray(await b.call(CANVAS_IPC.list, s, 'ws'))).toBe(true)
  })
  it('rejects non-boolean flag values', async () => {
    const a = setup({ configDir: tmp() })
    await expect(a.call(CANVAS_IPC.setEnabled, fakeSender(), 'yes')).rejects.toThrow('CANVAS_BAD_FLAG')
  })
})
