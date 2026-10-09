/**
 * `keeper` tool for the session MCP server.
 *
 * Agents get read/write access to the local ROX Keeper vault through a small
 * set of actions (`list`/`get`/`create`/`update`/`delete`). Two guarantees:
 *
 *   1. Vault projections are always masked (`password`/`totpSecret` -> null);
 *      a real value is surfaced only when the call sets `reveal: true` AND the
 *      operator has exported `ROX_KEEPER_ALLOW_REVEAL=1`. Anything else is
 *      fail-closed and never calls the reveal path.
 *   2. The transport is injectable. In production it is a loopback HTTP relay
 *      to the desktop process (which owns the vault and its OS-backed key);
 *      tests use a fake and never touch a vault.
 *
 * The tool never logs secrets, and every returned payload is re-sanitized here
 * so a misbehaving relay cannot leak a value into the model context.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const KEEPER_TOOL_NAME = 'keeper'

/** Env flag the operator sets to allow a reveal from an agent. */
export const KEEPER_ALLOW_REVEAL_ENV = 'ROX_KEEPER_ALLOW_REVEAL'

export type KeeperEnv = Record<string, string | undefined>

export function isKeeperRevealAllowed(env: KeeperEnv = process.env): boolean {
  return env[KEEPER_ALLOW_REVEAL_ENV] === '1'
}

export const KEEPER_REVEAL_DENIED_MESSAGE =
  `Refusing to reveal keeper secrets: ${KEEPER_ALLOW_REVEAL_ENV}=1 must be set by the operator.`

const KEEPER_ACTIONS = ['list', 'get', 'create', 'update', 'delete'] as const
export type KeeperAction = (typeof KEEPER_ACTIONS)[number]

export interface KeeperToolResult {
  // Index signature: the MCP SDK result unions are index-signature based, and
  // a named interface needs an implicit one to be assignable.
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Executes one keeper action against the vault owner. `params` carries the
 * action-specific fields (`id`, `folder`, `item`, `patch`, `reveal`, `field`).
 */
export interface KeeperRpc {
  call(action: KeeperAction, params: Record<string, unknown>): Promise<unknown>
}

/**
 * Production transport: POST the action to the desktop relay on the session's
 * loopback callback port. The relay maps it onto the `keeper:*` RPC surface.
 */
export function createHttpKeeperRpc(options: { port: number | string; host?: string }): KeeperRpc {
  const host = options.host ?? '127.0.0.1'
  const url = `http://${host}:${options.port}/${KEEPER_TOOL_NAME}`
  return {
    async call(action, params) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
      })
      const payload: unknown = await response.json()
      return payload
    },
  }
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Recursively replace secret fields with `null`. A `revealed` block is dropped
 * unless reveal was actually authorized. This runs on every response so a
 * relay that returns raw vault data still cannot leak through this tool.
 */
export function sanitizeKeeperOutput(value: unknown, allowReveal: boolean): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeKeeperOutput(entry, allowReveal))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'password' || key === 'totpSecret') {
        out[key] = null
        continue
      }
      if (key === 'revealed' && !allowReveal) continue
      out[key] = sanitizeKeeperOutput(entry, allowReveal)
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const ITEM_PROPERTIES = {
  kind: {
    type: 'string',
    enum: ['login', 'note', 'card', 'identity', 'totp'],
    description: 'Item kind (defaults to login).',
  },
  title: { type: 'string', description: 'Display title.' },
  username: { type: 'string' },
  password: { type: 'string', description: 'Secret. Never echoed back.' },
  url: { type: 'string' },
  notes: { type: 'string' },
  totpSecret: { type: 'string', description: 'RFC 6238 TOTP secret. Never echoed back.' },
  tags: { type: 'array', items: { type: 'string' } },
  folders: { type: 'array', items: { type: 'string' } },
  favorite: { type: 'boolean' },
  expiresAt: { type: 'number' },
} as const

const PATCH_PROPERTIES = {
  ...ITEM_PROPERTIES,
  clearPassword: { type: 'boolean', description: 'Explicitly remove the stored password.' },
  clearTotpSecret: { type: 'boolean', description: 'Explicitly remove the stored TOTP secret.' },
} as const

export const KEEPER_TOOL: Tool = {
  name: KEEPER_TOOL_NAME,
  description:
    'Read and manage the local ROX Keeper secret vault. Actions: list, get, create, update, delete. '
    + 'Secret values are masked unless reveal:true is set AND the operator has exported '
    + `${KEEPER_ALLOW_REVEAL_ENV}=1. Prefer item ids over revealing values.`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...KEEPER_ACTIONS],
        description: 'Operation to perform.',
      },
      id: { type: 'string', description: 'Item id (get/update/delete).' },
      folder: { type: 'string', description: 'Filter list results by folder name.' },
      reveal: {
        type: 'boolean',
        description: `Return secret values. Requires ${KEEPER_ALLOW_REVEAL_ENV}=1; otherwise the call is refused.`,
      },
      field: {
        type: 'string',
        enum: ['password', 'totpSecret'],
        description: 'Which secret to reveal with `get` (default password).',
      },
      item: { type: 'object', properties: ITEM_PROPERTIES, description: 'Item to create.' },
      patch: { type: 'object', properties: PATCH_PROPERTIES, description: 'Fields to update.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface KeeperToolDeps {
  /** Vault transport. Absent in tests only — production always wires the relay. */
  rpc?: KeeperRpc
  env?: KeeperEnv
}

function ok(payload: unknown): KeeperToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false }
}

function fail(message: string): KeeperToolResult {
  return { content: [{ type: 'text', text: `[ERROR] ${message}` }], isError: true }
}

function isKeeperAction(value: unknown): value is KeeperAction {
  return typeof value === 'string' && (KEEPER_ACTIONS as readonly string[]).includes(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export async function handleKeeperTool(
  rawArgs: unknown,
  deps: KeeperToolDeps = {},
): Promise<KeeperToolResult> {
  const args = asRecord(rawArgs)
  const action = args.action

  if (!isKeeperAction(action)) {
    return fail(`keeper: unknown action ${String(action ?? '')} (expected: ${KEEPER_ACTIONS.join(', ')})`)
  }

  const allowReveal = isKeeperRevealAllowed(deps.env ?? process.env)
  const wantsReveal = args.reveal === true

  if (wantsReveal && !allowReveal) {
    return fail(KEEPER_REVEAL_DENIED_MESSAGE)
  }

  if (action === 'get' || action === 'update' || action === 'delete') {
    if (typeof args.id !== 'string' || !args.id) return fail(`keeper ${action}: 'id' is required`)
  }
  if (action === 'create' && (args.item === undefined || typeof args.item !== 'object')) {
    return fail("keeper create: 'item' object is required")
  }
  if (action === 'update' && (args.patch === undefined || typeof args.patch !== 'object')) {
    return fail("keeper update: 'patch' object is required")
  }

  const params: Record<string, unknown> = {}
  if (typeof args.id === 'string') params.id = args.id
  if (typeof args.folder === 'string') params.folder = args.folder
  if (typeof args.field === 'string') params.field = args.field
  if (args.item !== undefined) params.item = args.item
  if (args.patch !== undefined) params.patch = args.patch
  // Forward the authorized reveal intent so the relay can return a value.
  if (wantsReveal) params.reveal = true

  let result: unknown
  const precomputed = args._precomputedResult
  if (typeof precomputed === 'string') {
    // Primary path on Codex: the PreToolUse intercept injects the vault result,
    // mirroring call_llm / spawn_session.
    try {
      result = JSON.parse(precomputed)
    } catch {
      return fail(`keeper ${action}: could not parse _precomputedResult`)
    }
  } else {
    if (!deps.rpc) {
      return fail('keeper: no vault transport available (desktop relay is not connected)')
    }
    try {
      result = await deps.rpc.call(action, params)
    } catch (error) {
      return fail(`keeper ${action} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (result !== null && typeof result === 'object' && 'error' in result) {
    const message = asRecord(result).error
    return fail(`keeper ${action} failed: ${typeof message === 'string' ? message : 'unknown error'}`)
  }

  return ok(sanitizeKeeperOutput(result, allowReveal && wantsReveal))
}