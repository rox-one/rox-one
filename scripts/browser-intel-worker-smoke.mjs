#!/usr/bin/env node
/**
 * End-to-end smoke test for the Browser Intelligence unfurl worker bundle.
 *
 * Runs the compiled Worker (`apps/electron/dist/browser-intel-worker.cjs`)
 * against a throwaway intelligence database seeded with one decodable URL, and
 * asserts that the unfurl loop persists a `done` status plus a non-empty graph.
 * It then verifies the *pre-fix* regression guard: a `workerData` payload that
 * smuggles a live `DatabaseSync` handle across the thread boundary must throw
 * synchronously with `DataCloneError`, which is exactly why the payload is
 * whitelisted by `unfurlWorkerData()`.
 *
 * Builtins only, ESM, no test framework — `bun run smoke:browser-intel-worker`
 * invokes it directly after building the worker bundle.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(ROOT, 'apps', 'electron', 'dist', 'browser-intel-worker.cjs')
const SCHEMA = join(ROOT, 'packages', 'browser-intel', 'src', 'db', 'schema.sql')
// Base64 `u=` payload decodes to `https://example.org/a?t=1783901247938`, so the
// unfurl stage produces at least a root node plus one decoded child.
const SAMPLE_URL = 'https://example.com/r?u=aHR0cHM6Ly9leGFtcGxlLm9yZy9hP3Q9MTc4MzkwMTI0NzkzOA%3D%3D'
const RUN_TIMEOUT_MS = 60_000

function fail(message) {
  console.error(`browser-intel worker smoke FAILED: ${message}`)
  process.exit(1)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Spawn the worker and resolve with its final outcome. Progress frames are
 * ignored; an `error` message, a worker `error` event, a non-zero exit or the
 * 60s guard all reject (terminating the thread first).
 */
function runWorker(workerData, label) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(BUNDLE, { workerData })
    let settled = false
    const done = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        void worker.terminate().catch(() => {})
        reject(error)
        return
      }
      resolve({ worker, outcome: value })
    }
    const timer = setTimeout(() => done(new Error(`${label}: worker did not finish within ${RUN_TIMEOUT_MS} ms`)), RUN_TIMEOUT_MS)
    worker.on('message', (message) => {
      if (message?.type === 'progress') return
      if (message?.type === 'done') done(null, message.outcome)
      else if (message?.type === 'error') done(new Error(`${label}: worker reported error: ${message.message}`))
    })
    worker.on('error', (error) => done(error instanceof Error ? error : new Error(String(error))))
    worker.on('exit', (code) => {
      if (code !== 0) done(new Error(`${label}: worker exited with code ${code}`))
    })
  })
}

/**
 * Pre-fix regression guard: the old payload handed a live `DatabaseSync` to
 * `workerData`, which is not structured-cloneable, so `new Worker` throws
 * synchronously with `DataCloneError`. Assert that contract.
 */
function assertPreFixShapeThrows(dbPath) {
  const store = new DatabaseSync(dbPath)
  try {
    let thrown = null
    try {
      const stray = new Worker(BUNDLE, { workerData: { dbPath, options: { batchSize: 10, store } } })
      void stray.terminate().catch(() => {})
    } catch (error) {
      thrown = error
    }
    assert(thrown !== null, 'pre-fix workerData shape did not throw; expected synchronous DataCloneError')
    assert(
      thrown.name === 'DataCloneError',
      `pre-fix workerData shape threw ${thrown.name} (${thrown.message}), expected DataCloneError`,
    )
  } finally {
    store.close()
  }
}

async function main() {
  if (!existsSync(BUNDLE)) {
    fail(`worker bundle not found at ${BUNDLE} — build it first with \`bun run --cwd apps/electron build:main-worker\``)
  }
  if (!existsSync(SCHEMA)) {
    fail(`intelligence schema not found at ${SCHEMA}`)
  }
  process.env.ROX_BROWSER_INTEL_SCHEMA = SCHEMA

  const dir = mkdtempSync(join(tmpdir(), 'browser-intel-worker-smoke-'))
  const dbPath = join(dir, 'intelligence.db')
  try {
    const now = Date.now()
    const seed = new DatabaseSync(dbPath)
    try {
      seed.exec('PRAGMA journal_mode = WAL;')
      seed.exec(readFileSync(SCHEMA, 'utf8'))
      seed
        .prepare('INSERT INTO dim_urls (url, raw_url, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)')
        .run(SAMPLE_URL, SAMPLE_URL, now, now)
    } finally {
      seed.close()
    }

    // NEGATIVE CONTROL: pre-fix shape must be rejected by structured clone.
    assertPreFixShapeThrows(dbPath)
    const oldShapeThrows = true

    // POSITIVE: the whitelisted payload runs the unfurl loop to completion.
    const { worker, outcome } = await runWorker(
      { dbPath, options: { batchSize: 10, batchDelayMs: 0, maxBatches: 1 } },
      'positive run',
    )
    try {
      assert(outcome && typeof outcome.processed === 'number', 'worker outcome is missing a numeric `processed`')
      assert(outcome.processed === 1, `expected processed === 1, got ${outcome.processed}`)
    } finally {
      await worker.terminate()
    }

    const reader = new DatabaseSync(dbPath, { readOnly: true })
    let unfurlStatus
    let graphBytes
    let detailRows
    try {
      const url = reader.prepare('SELECT unfurl_status FROM dim_urls LIMIT 1').get()
      unfurlStatus = url ? url.unfurl_status : undefined
      const details = reader
        .prepare('SELECT count(*) AS n, max(length(graph_json)) AS bytes FROM unfurl_details')
        .get()
      detailRows = Number(details.n)
      graphBytes = Number(details.bytes ?? 0)
    } finally {
      reader.close()
    }

    assert(unfurlStatus === 'done', `expected dim_urls.unfurl_status === 'done', got ${unfurlStatus}`)
    assert(detailRows === 1, `expected exactly one unfurl_details row, got ${detailRows}`)
    assert(graphBytes > 2, `expected a non-empty graph_json, got ${graphBytes} bytes`)

    console.log(
      JSON.stringify({
        node: process.version,
        processed: outcome.processed,
        unfurlStatus,
        graphBytes,
        oldShapeThrows,
      }),
    )
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

await main()