/**
 * `keeper` CLI subcommands — agent/terminal access to the ROX Keeper vault.
 *
 * The vault is local to the server's main process and is exposed through the
 * `keeper:*` RPC channels. Every projection the server returns is already
 * masked (`password: null`, `hasPassword` flag); a real secret is obtainable
 * only through `keeper:reveal`, and only when BOTH:
 *
 *   1. the invocation opts in with `--reveal`, and
 *   2. the operator has set `ROX_KEEPER_ALLOW_REVEAL=1`
 *
 * The gate is fail-closed: with either precondition missing we refuse before
 * talking to the server, and the refusal never contains a secret. Outside an
 * explicit reveal, no command path ever prints a secret value.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol'
import type {
  KeeperItemView,
  KeeperRevealResult,
  KeeperUnlockStatus,
  KeeperVaultSnapshot,
} from '@rox/shared/keeper'

/** Env flag the operator sets to allow reveal from an agent/terminal. */
export const KEEPER_ALLOW_REVEAL_ENV = 'ROX_KEEPER_ALLOW_REVEAL'

export type KeeperEnv = Record<string, string | undefined>

export function isKeeperRevealAllowed(env: KeeperEnv = process.env): boolean {
  return env[KEEPER_ALLOW_REVEAL_ENV] === '1'
}

export const KEEPER_REVEAL_DENIED_MESSAGE =
  `Refusing to reveal secret: set ${KEEPER_ALLOW_REVEAL_ENV}=1 to allow reveal, then pass --reveal.`

export const KEEPER_REVEAL_FIELD_DENIED_MESSAGE =
  `Refusing to reveal secret: ${KEEPER_ALLOW_REVEAL_ENV}=1 is required before --reveal takes effect.`

export type KeeperSubcommand = 'list' | 'get' | 'create' | 'delete' | 'status'

export interface KeeperArgs {
  sub: KeeperSubcommand
  id?: string
  folder?: string
  reveal: boolean
  field: 'password' | 'totpSecret'
  kind: string
  title?: string
  username?: string
  password?: string
  passwordFromStdin: boolean
  url?: string
  notes?: string
  totp?: string
  totpFromStdin: boolean
}

const KEEPER_SUBCOMMANDS: readonly KeeperSubcommand[] = ['list', 'get', 'create', 'delete', 'status']

/**
 * Parse `keeper <sub> [options]` from the argument tail. `--json` is a global
 * flag already consumed by `parseArgs`; it is tolerated here so direct callers
 * (tests) can pass it through unchanged.
 */
export function parseKeeperArgs(rest: readonly string[]): KeeperArgs {
  const sub = rest[0]
  if (!sub) throw new Error('Usage: keeper <list|get|create|delete|status> [options]')
  if (!(KEEPER_SUBCOMMANDS as readonly string[]).includes(sub)) {
    throw new Error(`Unknown keeper subcommand: ${sub}`)
  }

  const args: KeeperArgs = {
    sub: sub as KeeperSubcommand,
    reveal: false,
    field: 'password',
    kind: 'login',
    passwordFromStdin: false,
    totpFromStdin: false,
  }
  const positional: string[] = []

  for (let i = 1; i < rest.length; i++) {
    const arg = rest[i]
    switch (arg) {
      case '--folder':
        args.folder = rest[++i]
        break
      case '--reveal':
        args.reveal = true
        break
      case '--field': {
        const value = rest[++i]
        if (value === 'totp' || value === 'totpSecret') args.field = 'totpSecret'
        else if (value === 'password') args.field = 'password'
        else throw new Error(`Invalid --field value: ${value ?? ''} (expected password or totp)`)
        break
      }
      case '--kind':
        args.kind = rest[++i] ?? 'login'
        break
      case '--title':
        args.title = rest[++i]
        break
      case '--username':
        args.username = rest[++i]
        break
      case '--password':
        args.password = rest[++i]
        break
      case '--password-stdin':
        args.passwordFromStdin = true
        break
      case '--url':
        args.url = rest[++i]
        break
      case '--notes':
        args.notes = rest[++i]
        break
      case '--totp':
        args.totp = rest[++i]
        break
      case '--totp-stdin':
        args.totpFromStdin = true
        break
      case '--json':
        // Global flag — handled by parseArgs; ignore if present in the tail.
        break
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown keeper flag: ${arg}`)
        positional.push(arg)
    }
  }

  if (args.sub === 'get' || args.sub === 'delete') args.id = positional[0]
  return args
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Minimal RPC surface needed by the keeper commands (satisfied by CliRpcClient). */
export interface KeeperRpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export interface KeeperIo {
  out(line: string): void
  outJson(value: unknown): void
  err(line: string): void
}

export interface KeeperRunOptions {
  env?: KeeperEnv
  /** Reads all of stdin. Overridable so tests never touch a real stream. */
  stdin?: () => Promise<string>
  /** Output sink. Overridable so tests capture output without a terminal. */
  io?: KeeperIo
}

export interface KeeperRunRequest {
  rest: readonly string[]
  json: boolean
}

const defaultIo: KeeperIo = {
  out: (line) => process.stdout.write(line + '\n'),
  outJson: (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n'),
  err: (line) => process.stderr.write(`Error: ${line}\n`),
}

function readStdin(opts: KeeperRunOptions): Promise<string> {
  if (opts.stdin) return opts.stdin()
  return (async () => {
    const chunks: string[] = []
    const reader = Bun.stdin.stream().getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value, { stream: true }))
    }
    return chunks.join('')
  })()
}

/**
 * Defence in depth: even though the server masks items, never let a secret
 * value reach stdout through a JSON projection. Revealed values are emitted
 * separately under an explicit `revealed` field.
 */
function maskView(view: KeeperItemView): KeeperItemView {
  return { ...view, password: null, totpSecret: null }
}

function printView(io: KeeperIo, view: KeeperItemView): void {
  io.out(`id: ${view.id}`)
  io.out(`title: ${view.title}`)
  if (view.username) io.out(`username: ${view.username}`)
  if (view.url) io.out(`url: ${view.url}`)
  if (view.folders.length) io.out(`folders: ${view.folders.join(', ')}`)
  io.out(
    `password: ${view.hasPassword
      ? `(hidden — use --reveal with ${KEEPER_ALLOW_REVEAL_ENV}=1)`
      : '(none)'}`,
  )
  if (view.hasTotpSecret) io.out('totp: (hidden — use --reveal --field totp)')
}

/** Resolve create-time secrets, reading stdin only when a flag is omitted. */
async function collectSecrets(
  parsed: KeeperArgs,
  opts: KeeperRunOptions,
): Promise<{ password?: string; totpSecret?: string }> {
  // One stdin stream can carry at most one secret.
  let stdinConsumed = false
  let cached: string | undefined
  const takeStdin = async (): Promise<string> => {
    if (cached === undefined) cached = (await readStdin(opts)).replace(/\r?\n$/, '')
    return cached
  }

  let password = parsed.password
  let totpSecret = parsed.totp

  const stdinPiped = opts.stdin !== undefined || process.stdin.isTTY !== true
  const wantPasswordFromStdin =
    parsed.password === undefined
    && (parsed.passwordFromStdin
      || (!parsed.totpFromStdin && parsed.totp === undefined && stdinPiped))

  if (wantPasswordFromStdin) {
    password = await takeStdin()
    stdinConsumed = true
  }

  if (parsed.totpFromStdin) {
    if (stdinConsumed) {
      throw new Error('Cannot read both --password-stdin and --totp-stdin from one stdin stream')
    }
    totpSecret = await takeStdin()
  }

  return { password, totpSecret }
}

async function runList(
  rpc: KeeperRpc,
  parsed: KeeperArgs,
  json: boolean,
  io: KeeperIo,
): Promise<number> {
  const snapshot = (await rpc.invoke(RPC_CHANNELS.keeper.LIST)) as KeeperVaultSnapshot | undefined
  const all = snapshot?.items ?? []
  const items = parsed.folder
    ? all.filter((item) => item.folders.some((name) => name.toLowerCase() === parsed.folder!.trim().toLowerCase()))
    : all

  if (json) {
    io.outJson({ items: items.map(maskView), folders: snapshot?.folders ?? [] })
    return 0
  }
  if (items.length === 0) {
    io.out(parsed.folder ? `No keeper items in folder: ${parsed.folder}` : 'No keeper items found')
    return 0
  }
  for (const item of items) {
    const folders = item.folders.length ? `  [${item.folders.join(', ')}]` : ''
    io.out(`${item.id}  ${item.title}${item.username ? `  ${item.username}` : ''}${folders}`)
  }
  return 0
}

async function runGet(
  rpc: KeeperRpc,
  parsed: KeeperArgs,
  json: boolean,
  io: KeeperIo,
  env: KeeperEnv,
): Promise<number> {
  if (!parsed.id) {
    io.err('Usage: keeper get <id> [--reveal]')
    return 1
  }
  const view = (await rpc.invoke(RPC_CHANNELS.keeper.GET, parsed.id)) as KeeperItemView

  // Fail closed before any reveal call when the operator gate is missing.
  if (parsed.reveal && !isKeeperRevealAllowed(env)) {
    io.err(KEEPER_REVEAL_DENIED_MESSAGE)
    return 1
  }

  let revealed: KeeperRevealResult | undefined
  if (parsed.reveal) {
    const has = parsed.field === 'password' ? view.hasPassword : view.hasTotpSecret
    if (!has) {
      io.err(`No ${parsed.field === 'password' ? 'password' : 'TOTP secret'} stored for item ${view.id}`)
      return 1
    }
    revealed = (await rpc.invoke(RPC_CHANNELS.keeper.REVEAL, { id: view.id, field: parsed.field })) as KeeperRevealResult
  }

  if (json) {
    io.outJson(revealed
      ? { ...maskView(view), revealed: { field: revealed.field, value: revealed.value } }
      : maskView(view))
    return 0
  }

  printView(io, view)
  if (revealed) io.out(`${revealed.field}: ${revealed.value}`)
  return 0
}

async function runCreate(
  rpc: KeeperRpc,
  parsed: KeeperArgs,
  json: boolean,
  io: KeeperIo,
  opts: KeeperRunOptions,
): Promise<number> {
  if (!parsed.title) {
    io.err('Usage: keeper create --title <title> [--username --password --url --notes --folder --totp]')
    return 1
  }
  const { password, totpSecret } = await collectSecrets(parsed, opts)

  const item: Record<string, unknown> = { kind: parsed.kind, title: parsed.title }
  if (parsed.username) item.username = parsed.username
  if (password) item.password = password
  if (parsed.url) item.url = parsed.url
  if (parsed.notes) item.notes = parsed.notes
  if (parsed.folder) item.folders = [parsed.folder]
  if (totpSecret) item.totpSecret = totpSecret

  const created = (await rpc.invoke(RPC_CHANNELS.keeper.CREATE, { item })) as KeeperItemView
  if (json) io.outJson(maskView(created))
  else io.out(`Created keeper item: ${created.id}  ${created.title}`)
  return 0
}

async function runDelete(rpc: KeeperRpc, parsed: KeeperArgs, json: boolean, io: KeeperIo): Promise<number> {
  if (!parsed.id) {
    io.err('Usage: keeper delete <id>')
    return 1
  }
  await rpc.invoke(RPC_CHANNELS.keeper.DELETE, parsed.id)
  if (json) io.outJson({ deleted: parsed.id })
  else io.out(`Deleted keeper item: ${parsed.id}`)
  return 0
}

async function runStatus(rpc: KeeperRpc, json: boolean, io: KeeperIo): Promise<number> {
  const status = (await rpc.invoke(RPC_CHANNELS.keeper.UNLOCK_STATUS)) as KeeperUnlockStatus
  if (json) {
    io.outJson(status)
    return 0
  }
  io.out(`scope: ${status.scope}`)
  io.out(`keyAvailable: ${status.keyAvailable}`)
  io.out(`vaultExists: ${status.vaultExists}`)
  io.out(`available: ${status.available}`)
  return 0
}

/**
 * Run a `keeper` command. Returns the process exit code; never throws for
 * expected failures (usage errors, denied reveal, RPC errors) so callers can
 * exit cleanly.
 */
export async function runKeeperCommand(
  rpc: KeeperRpc,
  request: KeeperRunRequest,
  opts: KeeperRunOptions = {},
): Promise<number> {
  const env = opts.env ?? process.env
  const json = request.json
  const io: KeeperIo = opts.io ?? defaultIo

  let parsed: KeeperArgs
  try {
    parsed = parseKeeperArgs(request.rest)
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  }

  try {
    switch (parsed.sub) {
      case 'list':
        return await runList(rpc, parsed, json, io)
      case 'get':
        return await runGet(rpc, parsed, json, io, env)
      case 'create':
        return await runCreate(rpc, parsed, json, io, opts)
      case 'delete':
        return await runDelete(rpc, parsed, json, io)
      case 'status':
        return await runStatus(rpc, json, io)
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  }
}