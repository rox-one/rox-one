import { afterEach, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  startSourceIndexWatch,
  stopAllSourceIndexWatches,
} from '../source-index-watch.ts'
import type { SourceReindexResult } from '../source-index.ts'

const ORIGINAL_WATCH = process.env.CRAFT_FEATURE_NATIVE_INDEX_WATCH
const dirs: string[] = []

afterEach(() => {
  stopAllSourceIndexWatches()
  if (ORIGINAL_WATCH === undefined) delete process.env.CRAFT_FEATURE_NATIVE_INDEX_WATCH
  else process.env.CRAFT_FEATURE_NATIVE_INDEX_WATCH = ORIGINAL_WATCH
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

class FakeWatcher extends EventEmitter {
  closed = false
  close = (): void => {
    this.closed = true
  }
}

describe('source-index folder watch', () => {
  it('returns null when the watch flag is off', () => {
    delete process.env.CRAFT_FEATURE_NATIVE_INDEX_WATCH
    const workspace = tmp('watch-off')
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    expect(
      startSourceIndexWatch(workspace, [{ slug: 'docs', path: folder }]),
    ).toBeNull()
  })

  it('debounces change events then reindexes and pushes', async () => {
    process.env.CRAFT_FEATURE_NATIVE_INDEX_WATCH = '1'
    const workspace = tmp('watch-on')
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'seed.md'), 'seed')

    const watchers: FakeWatcher[] = []
    const reindexCalls: Array<{ workspaceRoot: string; roots: Array<{ slug: string; path: string }> }> =
      []
    const pushes: unknown[] = []
    const result: SourceReindexResult = {
      indexed: 1,
      skipped: 0,
      truncated: false,
      dbPath: '/tmp/x.sqlite',
      fts: true,
      written: 1,
      unchanged: 0,
    }

    const handle = startSourceIndexWatch(
      workspace,
      [{ slug: 'docs', path: folder }],
      {
        debounceMs: 20,
        watch: ((_path, _opts, listener) => {
          const w = new FakeWatcher()
          watchers.push(w)
          w.on('fire', (filename: string) => {
            listener('change', filename)
          })
          return w as unknown as FSWatcher
        }) as typeof import('node:fs').watch,
        reindex: async (workspaceRoot, roots) => {
          reindexCalls.push({ workspaceRoot, roots })
          return result
        },
        push: (payload) => {
          pushes.push(payload)
        },
      },
    )
    expect(handle).not.toBeNull()
    expect(watchers.length).toBe(1)

    watchers[0]!.emit('fire', 'notes.md')
    watchers[0]!.emit('fire', 'notes.md')
    expect(reindexCalls).toEqual([])
    await Bun.sleep(60)
    expect(reindexCalls).toHaveLength(1)
    expect(reindexCalls[0]?.workspaceRoot).toBe(workspace)
    expect(pushes).toEqual([
      {
        indexed: 1,
        written: 1,
        unchanged: 0,
        truncated: false,
      },
    ])
    handle?.close()
    expect(watchers[0]?.closed).toBe(true)
  })

  it('ignores node_modules and binary files', async () => {
    process.env.CRAFT_FEATURE_NATIVE_INDEX_WATCH = '1'
    const workspace = tmp('watch-ignore')
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })

    const watchers: FakeWatcher[] = []
    let reindexCount = 0
    const handle = startSourceIndexWatch(
      workspace,
      [{ slug: 'docs', path: folder }],
      {
        debounceMs: 15,
        watch: ((_path, _opts, listener) => {
          const w = new FakeWatcher()
          watchers.push(w)
          w.on('fire', (filename: string) => listener('change', filename))
          return w as unknown as FSWatcher
        }) as typeof import('node:fs').watch,
        reindex: async () => {
          reindexCount += 1
          return {
            indexed: 0,
            skipped: 0,
            truncated: false,
            dbPath: '/tmp/x.sqlite',
            fts: false,
          }
        },
      },
    )
    watchers[0]!.emit('fire', 'node_modules/pkg/x.md')
    watchers[0]!.emit('fire', '.git/HEAD')
    watchers[0]!.emit('fire', 'photo.png')
    await Bun.sleep(40)
    expect(reindexCount).toBe(0)
    handle?.close()
  })
})
