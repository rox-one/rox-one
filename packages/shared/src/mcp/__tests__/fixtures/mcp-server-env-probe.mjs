#!/usr/bin/env node
// Minimal spec-compliant MCP stdio server with a `probe_env` tool that reports
// which of the requested env var NAMES are present in its own process env.
// Used by env-blocklist.test.ts to prove the parent-side env blocklist reaches
// the actually-spawned subprocess (not just the transport params object).
// Newline-delimited JSON-RPC on stdout, as the MCP stdio spec requires.

import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })

const PROTOCOL_VERSION = '2025-11-25'

const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-server-env-probe', version: '1.0.0' },
      },
    })
    return
  }
  if (req.method === 'notifications/initialized') {
    return
  }
  if (req.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [
          {
            name: 'probe_env',
            description: 'Report presence of env vars in this server process',
            inputSchema: {
              type: 'object',
              properties: { names: { type: 'array', items: { type: 'string' } } },
              required: ['names'],
            },
          },
        ],
      },
    })
    return
  }
  if (req.method === 'tools/call') {
    if (req.params?.name !== 'probe_env') {
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `unknown tool: ${req.params?.name}` }],
          isError: true,
        },
      })
      return
    }
    const names = req.params?.arguments?.names ?? []
    // Presence only — never echo values back (they are secrets by definition).
    const presence = Object.fromEntries(names.map((n) => [n, process.env[n] !== undefined]))
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: { content: [{ type: 'text', text: JSON.stringify(presence) }] },
    })
    return
  }
  if (req.id !== undefined) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } })
  }
})
