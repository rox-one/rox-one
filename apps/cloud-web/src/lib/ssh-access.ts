/**
 * The vendor's SSH line → a per-machine alias the customer can keep.
 *
 * The 32-character token never belongs in a shell command: it is a
 * time-limited credential, and a typed token stays in shell history and in
 * `ps` output. Here it moves into a `~/.ssh/rox/<alias>.conf` block with 0600
 * rights, while the visible command is a stable `ssh rox-<id>` line that
 * OpenSSH resolves through `Include`.
 */

export interface SshConnection {
  /** Config-safe host alias: `rox-` plus up to eight machine-id characters. */
  alias: string
  /** Gateway host from the command, usually `ssh.rox.computer`. */
  host: string
  /** The token, used as the SSH user name. */
  user: string
  /** Non-default port when the command carries `-p`. */
  port?: number
  /** Ready `~/.ssh/rox/<alias>.conf` block with one trailing newline. */
  config: string
}

/**
 * `ssh [ -p N ] user@host`, with the user optionally quoted and trailing
 * whitespace allowed. Anything else means the command is not ours to read.
 */
const SSH_LINE = /^ssh\s+(?:-p\s*(\d{1,5})\s+)?(?:'([^']+)'|"([^"]+)"|([^\s@'"]+))@([^\s'"]+)\s*$/

/** Host names that are safe in a config: no spaces, quotes or `@`. */
const HOST = /^[A-Za-z0-9._-]+$/

/**
 * `sbx_test` → `rox-sbx_test`, while a provider id `sbx_0a1b2c3d4e5f` becomes
 * `rox-0a1b2c3d`. A short id keeps its own name: a stripped stem under eight
 * characters is not a provider id, and dropping the prefix would let two
 * machines share one alias.
 */
function sshAlias(sandboxId: string): string | null {
  const id = sandboxId.trim()
  if (id.length === 0) return null
  const bare = id.replace(/^sbx_/i, '')
  const stem = bare.length >= 8 ? bare : id
  const tail = stem
    .slice(0, 8)
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return tail.length === 0 ? null : `rox-${tail}`
}

function buildConfig(alias: string, host: string, user: string, port?: number): string {
  const lines = [`Host ${alias}`, `  HostName ${host}`, `  User ${user}`]
  if (port !== undefined) lines.push(`  Port ${port}`)
  return `${lines.join('\n')}\n`
}

/**
 * Parse one vendor SSH command into a stable alias and its config block.
 * Returns `null` for anything unexpected: the console then shows the raw
 * command behind a click instead of inventing a half-working alias.
 */
export function sshConnection(command: string, sandboxId: string): SshConnection | null {
  if (typeof command !== 'string' || typeof sandboxId !== 'string') return null
  const match = SSH_LINE.exec(command.trim())
  if (match === null) return null
  const port = match[1] === undefined ? undefined : Number(match[1])
  if (port !== undefined && (port < 1 || port > 65535)) return null
  const user = (match[2] ?? match[3] ?? match[4] ?? '').trim()
  const host = (match[5] ?? '').trim()
  if (user.length === 0 || host.length === 0 || !HOST.test(host)) return null
  const alias = sshAlias(sandboxId)
  if (alias === null) return null
  return { alias, host, user, port, config: buildConfig(alias, host, user, port) }
}
