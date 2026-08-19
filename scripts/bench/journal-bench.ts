#!/usr/bin/env bun
/**
 * Baseline: append-only JSONL throughput (session journal proxy).
 */
import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const N = 10_000
const dir = join(tmpdir(), `craft-journal-bench-${Date.now()}`)
mkdirSync(dir, { recursive: true })
const file = join(dir, 'events.jsonl')
const payload = JSON.stringify({ type: 'message', role: 'assistant', content: 'x'.repeat(120) })

const t0 = Number(process.hrtime.bigint()) / 1e6
for (let i = 0; i < N; i++) {
  appendFileSync(file, `${payload}\n`)
}
const ms = Number(process.hrtime.bigint()) / 1e6 - t0
const eventsPerSec = ms > 0 ? N / (ms / 1000) : 0
console.log(JSON.stringify({ events: N, ms, eventsPerSec }))
rmSync(dir, { recursive: true, force: true })
