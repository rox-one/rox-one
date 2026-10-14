#!/usr/bin/env bun
/**
 * Self-host entry. Env:
 *   RELAY_SECRET     required, >= 32 chars (HS256 room-token key)
 *   ALLOWED_ORIGINS  required comma list of browser origins allowed to connect
 *                    (e.g. "https://app.rox.one"); set ALLOW_ANY_ORIGIN=1 to opt out.
 *                    Requests without an Origin header (desktop app) still need a token.
 *   TOKEN_ISSUER     required, expected `iss` (e.g. https://id.rox.one)
 *   TOKEN_AUDIENCE   required, expected `aud` (e.g. rox-canvas)
 *   RELAY_ADMIN_TOKEN optional, >= 32 chars, != RELAY_SECRET: enables POST /admin/revoke
 *                    (Authorization: Bearer …; server-to-server, e.g. from id.rox.one)
 *   ADMIN_HOST (127.0.0.1; set to the tailnet IP to reach it over tailscale), ADMIN_PORT (8788)
 *   PORT (8787), HOST (0.0.0.0), DATA_DIR (./data)
 *   MAX_MESSAGE_BYTES, MAX_DOC_BYTES, MAX_CONNS_PER_ROOM, MAX_CONNS_TOTAL
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MIN_SECRET_LENGTH, startRelay, type RelayLimits } from './server.ts'

const fail = (m: string): never => { console.error(`rox-canvas-relay: ${m}`); process.exit(1) }
const secret = process.env.RELAY_SECRET ?? ''
if (secret.length < MIN_SECRET_LENGTH) fail(`RELAY_SECRET must be set (>= ${MIN_SECRET_LENGTH} chars)`)
const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
if (!origins.length && process.env.ALLOW_ANY_ORIGIN !== '1') fail('ALLOWED_ORIGINS is required (or set ALLOW_ANY_ORIGIN=1)')
const issuer = process.env.TOKEN_ISSUER ?? ''
const audience = process.env.TOKEN_AUDIENCE ?? ''
if (!issuer || !audience) fail('TOKEN_ISSUER and TOKEN_AUDIENCE are required')
const num = (k: string) => (process.env[k] ? Number(process.env[k]) : undefined)
const limits: Partial<RelayLimits> = Object.fromEntries(Object.entries({
  maxMessageBytes: num('MAX_MESSAGE_BYTES'), maxDocBytes: num('MAX_DOC_BYTES'),
  maxConnsPerRoom: num('MAX_CONNS_PER_ROOM'), maxConnsTotal: num('MAX_CONNS_TOTAL'),
}).filter(([, v]) => v !== undefined && Number.isFinite(v) && v > 0))

const dataDir = process.env.DATA_DIR ?? './data'
mkdirSync(dataDir, { recursive: true })
const relay = startRelay({
  port: Number(process.env.PORT ?? 8787),
  hostname: process.env.HOST ?? '0.0.0.0',
  dbPath: join(dataDir, 'canvas.sqlite'),
  secret,
  issuer,
  audience,
  allowedOrigins: origins,
  adminToken: process.env.RELAY_ADMIN_TOKEN || undefined,
  adminHostname: process.env.ADMIN_HOST ?? '127.0.0.1',
  adminPort: Number(process.env.ADMIN_PORT ?? 8788),
  limits,
})
console.log(`rox-canvas-relay listening on :${relay.port}`)
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { relay.stop(); process.exit(0) })
