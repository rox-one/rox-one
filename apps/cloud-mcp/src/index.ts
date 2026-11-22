#!/usr/bin/env bun
/**
 * Process entry for the Rox Cloud MCP server.
 *
 * Reads newline-delimited JSON-RPC from stdin, writes replies to stdout and
 * nothing else. Environment only:
 *   ROX_CLOUD_API_URL — base URL of the Rox Cloud API (default http://localhost:8787)
 *   ROX_API_KEY       — the Rox key (`rox_sk_…`); never printed or forwarded anywhere else
 */

import { createInterface } from 'node:readline'

import { createCloudClient } from './client.ts'
import { createMcpServer } from './server.ts'

const DEFAULT_BASE_URL = 'http://localhost:8787'

function fail(message: string): never {
  process.stderr.write(`rox-cloud-mcp: ${message}\n`)
  process.exit(1)
}

const apiKey = (process.env['ROX_API_KEY'] ?? '').trim()
if (apiKey.length === 0) {
  fail('ROX_API_KEY не задан: сервер берёт ключ Rox Cloud только из окружения')
}

const baseUrl = (process.env['ROX_CLOUD_API_URL'] ?? DEFAULT_BASE_URL).trim()
if (baseUrl.length === 0) {
  fail('ROX_CLOUD_API_URL пуст: укажите адрес Rox Cloud, например http://localhost:8787')
}

const client = createCloudClient({ baseUrl, apiKey })
const server = createMcpServer({
  client,
  log: (line) => process.stderr.write(`${line}\n`),
})

async function emit(line: string): Promise<void> {
  const response = await server.handleLine(line)
  if (response !== null) process.stdout.write(`${response}\n`)
}

// `readline` splits frames, handles CRLF and delivers a final line without a
// trailing newline. Frames are answered in arrival order.
const frames = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of frames) {
  await emit(line)
}
