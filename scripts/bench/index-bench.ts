#!/usr/bin/env bun
/**
 * Baseline: walk + index + search on synthetic trees of 1k / 5k / 20k files.
 *
 * Usage:
 *   bun scripts/bench/index-bench.ts
 *   node --experimental-strip-types scripts/bench/index-bench.ts  (documents bun:sqlite miss)
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  closeAllSourceIndexes,
  isSourceIndexFtsAvailable,
  reindexWorkspaceSources,
  searchSourceIndex,
  walkSourceTree,
} from '../../packages/server-core/src/sources/source-index-facade.ts'

const SIZES = [1_000, 5_000, 20_000] as const

function makeTree(root: string, n: number): void {
  mkdirSync(root, { recursive: true })
  for (let i = 0; i < n; i++) {
    const dir = join(root, `d${Math.floor(i / 100)}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `f${i}.md`), `# doc ${i}\nkeyword craft fox ${i}\n${'word '.repeat(40)}`)
  }
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6
}

async function main(): Promise<void> {
  const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node'
  const results: Array<Record<string, unknown>> = []

  for (const n of SIZES) {
    const workspace = mkdtempSync(join(tmpdir(), `craft-index-bench-${runtime}-${n}-`))
    const folder = join(workspace, 'docs')
    try {
      makeTree(folder, n)
      const t0 = nowMs()
      const walked = walkSourceTree(folder)
      const walkMs = nowMs() - t0
      const t1 = nowMs()
      const indexed = await reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
      const indexMs = nowMs() - t1
      const t2 = nowMs()
      const search = await searchSourceIndex(workspace, 'fox', { limit: 10 })
      const searchMs = nowMs() - t2
      const filesPerSec = walkMs > 0 ? walked.files.length / (walkMs / 1000) : 0
      results.push({
        runtime,
        requestedFiles: n,
        walked: walked.files.length,
        truncated: walked.truncated || indexed.truncated,
        indexed: indexed.indexed,
        ftsAvailable: isSourceIndexFtsAvailable(),
        fts: indexed.fts,
        walkMs,
        indexMs,
        searchMs,
        filesPerSec,
        searchHits: search.hits.length,
      })
    } finally {
      closeAllSourceIndexes()
      if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
    }
  }

  const out = { generatedAt: new Date().toISOString(), runtime, results }
  console.log(JSON.stringify(out, null, 2))
}

await main()
