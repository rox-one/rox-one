import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConfigDir } from './paths.ts'

export const SERVER_SERVICE_KEYS = ['DEEPGRAM_API_KEY', 'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY', 'TAVILY_API_KEY'] as const
export type ServerServiceKey = typeof SERVER_SERVICE_KEYS[number]

/** Backend-only secrets; renderer configuration and source folders contain no key values. */
export function getServerServiceKey(name: ServerServiceKey): string | undefined {
  const configured = process.env[name]?.trim()
  if (configured) return configured
  const path = process.env.ROX_SERVICE_SECRETS_FILE?.trim() || join(resolveConfigDir(), 'service-secrets.env')
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('Cannot read the private service secret file')
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('Invalid service secret file')
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))) {
      throw new Error('Service secret file must be owned by the backend user with private permissions')
    }
    const contents = readFileSync(fd, 'utf8')
    if (Buffer.byteLength(contents) > 64 * 1024) throw new Error('Invalid service secret file')
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
      if (match?.[1] !== name) continue
      const value = match[2]?.trim() ?? ''
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1).trim() || undefined
      }
      return value || undefined
    }
    return undefined
  } finally {
    closeSync(fd)
  }
}
