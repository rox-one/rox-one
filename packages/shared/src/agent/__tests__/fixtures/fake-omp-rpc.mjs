#!/usr/bin/env node
// Fake OMP CLI (`omp --mode rpc`) for tests. NDJSON over stdio, both ways.
//
// Protocol surface implemented (per docs/omp-rpc-notes.md):
// - prints a `ready` frame on startup
// - answers RPC commands with `{type:'response', id, success:true, data}`
// - on `set_host_tools`: journals the registered tool names, then (once)
//   issues a `host_tool_call` for FAKE_OMP_HOST_TOOL if it was registered
// - on `host_tool_result`: journals it, then finishes the turn
// - on `prompt`: answers, then finishes the turn once the host tool result
//   arrived (or after a backstop delay, so a broken chain fails assertions
//   on the journal instead of hanging the test)
//
// Env:
//   FAKE_OMP_JOURNAL        — append-only JSONL journal path (observed frames)
//   FAKE_OMP_HOST_TOOL      — tool name to invoke via host_tool_call
//   FAKE_OMP_HOST_TOOL_ARGS — JSON args for that call
//   FAKE_OMP_BACKSTOP_MS    — turn-finish backstop (default 8000)

import readline from 'node:readline'
import { appendFileSync } from 'node:fs'

const JOURNAL = process.env.FAKE_OMP_JOURNAL
const HOST_TOOL = process.env.FAKE_OMP_HOST_TOOL || ''
const HOST_TOOL_ARGS = JSON.parse(process.env.FAKE_OMP_HOST_TOOL_ARGS || '{}')
const BACKSTOP_MS = Number(process.env.FAKE_OMP_BACKSTOP_MS || 8000)

const journal = (entry) => {
  if (!JOURNAL) return
  try {
    appendFileSync(JOURNAL, JSON.stringify(entry) + '\n')
  } catch {
    // best effort
  }
}
const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

send({ type: 'ready', protocolVersion: 1 })

let hostToolCallIssued = false
let hostToolResultSeen = false
let promptSeen = false
let turnFinished = false
let backstop = null

function finishTurn() {
  if (turnFinished) return
  turnFinished = true
  if (backstop) clearTimeout(backstop)
  send({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'fake omp done' }],
      stopReason: 'endTurn',
    },
  })
  send({ type: 'agent_end', messages: [] })
}

function maybeFinishTurn() {
  if (!promptSeen || turnFinished) return
  if (HOST_TOOL && !hostToolResultSeen) {
    if (!backstop) {
      // Give the host-tool chain a bounded window, then finish anyway so the
      // test can assert on the journal instead of dying on a timeout.
      backstop = setTimeout(finishTurn, BACKSTOP_MS)
      backstop.unref?.()
    }
    return
  }
  finishTurn()
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  journal({ dir: 'in', ...msg })

  if (msg.type === 'get_state') {
    send({
      type: 'response',
      id: msg.id,
      success: true,
      data: { sessionId: 'fake-omp-session', sessionFile: null },
    })
    return
  }

  if (msg.type === 'set_host_tools') {
    const names = (msg.tools || []).map((t) => t.name)
    journal({ kind: 'set_host_tools', names })
    send({ type: 'response', id: msg.id, success: true, data: { toolNames: names } })
    if (!hostToolCallIssued && HOST_TOOL && names.includes(HOST_TOOL)) {
      hostToolCallIssued = true
      send({ type: 'host_tool_call', id: 'htc-1', toolName: HOST_TOOL, arguments: HOST_TOOL_ARGS })
    }
    return
  }

  if (msg.type === 'host_tool_result') {
    hostToolResultSeen = true
    journal({
      kind: 'host_tool_result',
      id: msg.id,
      result: msg.result,
      isError: msg.isError === true,
    })
    maybeFinishTurn()
    return
  }

  if (msg.type === 'prompt') {
    promptSeen = true
    send({ type: 'response', id: msg.id, success: true, data: { started: true } })
    maybeFinishTurn()
    return
  }

  // Generic success response for any other command (set_model, abort, ...).
  if (msg.id) {
    send({ type: 'response', id: msg.id, success: true, data: {} })
  }
})

process.stdin.on('close', () => process.exit(0))
