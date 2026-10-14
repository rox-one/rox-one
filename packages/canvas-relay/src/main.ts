#!/usr/bin/env bun
/** Self-host entry. Env: PORT, HOST, DATA_DIR, RELAY_SECRET (required), ALLOWED_ORIGINS (comma list). */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { startRelay } from './server.ts'

const secret = process.env.RELAY_SECRET
if (!secret || secret.length < 32) {
  console.error('rox-canvas-relay: RELAY_SECRET must be set (>= 32 chars)')
  process.exit(1)
}
const dataDir = process.env.DATA_DIR ?? './data'
mkdirSync(dataDir, { recursive: true })
const relay = startRelay({
  port: Number(process.env.PORT ?? 8787),
  hostname: process.env.HOST ?? '0.0.0.0',
  dbPath: join(dataDir, 'canvas.sqlite'),
  secret,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean),
})
console.log(`rox-canvas-relay listening on :${relay.port}`)
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { relay.stop(); process.exit(0) })
