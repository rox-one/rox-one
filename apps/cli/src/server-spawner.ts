/**
 * Server spawner — start a headless ROX server as a child process.
 *
 * Spawns `bun run <serverEntry>`, reads stdout for the `CRAFT_SERVER_URL=`
 * line and accepts both the canonical `ROX_SERVER_TOKEN=` and the legacy
 * `CRAFT_SERVER_TOKEN=` lines (ROX preferred), returning a handle to stop
 * the server.
 */

import { resolve, join } from 'node:path'
import type { Subprocess } from 'bun'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnedServer {
  url: string
  token: string
  stop: () => Promise<void>
}

export interface SpawnServerOptions {
  /** Path to the server entry file. Auto-detected from monorepo root if omitted. */
  serverEntry?: string
  /** Extra env vars to pass to the server process. */
  env?: Record<string, string>
  /** How long to wait for the server to print its URL (ms). Default: 30000. */
  startupTimeout?: number
  /** Suppress server stderr output (useful for validation where only test output matters). */
  quiet?: boolean
}

// ---------------------------------------------------------------------------
// Auto-detect server entry
// ---------------------------------------------------------------------------

function findServerEntry(): string {
  // Walk up from this file's directory to find the monorepo root.
  // Expected layout: apps/cli/src/server-spawner.ts → root/packages/server/src/index.ts
  let dir = import.meta.dir
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'packages', 'server', 'src', 'index.ts')
    if (Bun.file(candidate).size > 0) return candidate
    dir = resolve(dir, '..')
  }
  throw new Error(
    'Could not auto-detect server entry. ' +
    'Pass --server-entry or ensure the monorepo layout includes packages/server/src/index.ts',
  )
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

export async function spawnServer(opts?: SpawnServerOptions): Promise<SpawnedServer> {
  const serverEntry = opts?.serverEntry ?? findServerEntry()
  const startupTimeout = opts?.startupTimeout ?? 30_000
  const token = crypto.randomUUID()

  // Strip CLAUDECODE to avoid the Claude Agent SDK's nesting guard rejecting
  // subprocess launches when the CLI is invoked from within a Claude Code session.
  const { CLAUDECODE: _, ...parentEnv } = process.env
  const proc: Subprocess = Bun.spawn(['bun', 'run', serverEntry], {
    env: {
      ...parentEnv,
      ...opts?.env,
      ROX_SERVER_TOKEN: token,
      CRAFT_RPC_PORT: '0',
      CRAFT_RPC_HOST: '127.0.0.1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Pipe server stderr to our stderr so --debug logs are visible (unless quiet)
  if (proc.stderr && !opts?.quiet) {
    ;(async () => {
      // @ts-expect-error — Bun Subprocess types don't narrow stderr to ReadableStream when stderr: 'pipe'
      const reader = proc.stderr.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          process.stderr.write(value)
        }
      } catch {
        // Server exited — normal
      }
    })()
  }

  // Read stdout line by line looking for CRAFT_SERVER_URL=
  return new Promise<SpawnedServer>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`Server did not start within ${startupTimeout}ms`))
    }, startupTimeout)

    let url = ''
    let buffer = ''
    // Server token echo. Canonical ROX_SERVER_TOKEN= is preferred, the legacy
    // CRAFT_SERVER_TOKEN= line is still accepted. The server masks the echoed
    // value unless CRAFT_PRINT_TOKEN=1, so a masked echo is ignored and the
    // locally generated token is returned instead.
    let echoedToken = ''

    const processLines = () => {
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // keep incomplete last line in buffer
      for (const line of lines) {
        if (line.startsWith('CRAFT_SERVER_URL=')) {
          url = line.slice('CRAFT_SERVER_URL='.length).trim()
        }
        if (line.startsWith('ROX_SERVER_TOKEN=')) {
          echoedToken = line.slice('ROX_SERVER_TOKEN='.length).trim()
        } else if (!echoedToken && line.startsWith('CRAFT_SERVER_TOKEN=')) {
          // Legacy alias — only used when no canonical line was seen.
          echoedToken = line.slice('CRAFT_SERVER_TOKEN='.length).trim()
        }
        // Once we have the URL, the server is ready
        if (url) {
          clearTimeout(timer)
          resolve({
            url,
            // The server echoes the shared token, but masks it by default
            // (only CRAFT_PRINT_TOKEN=1 prints the full value). Prefer the
            // canonical ROX echo when it is a complete token, else keep the
            // locally generated one.
            token: echoedToken && !echoedToken.includes('…') ? echoedToken : token,
            stop: async () => {
              proc.kill('SIGTERM')
              await proc.exited
            },
          })
          return
        }
      }
    }

    ;(async () => {
      // @ts-expect-error — Bun Subprocess types don't narrow stdout to ReadableStream when stdout: 'pipe'
      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          processLines()
        }
      } catch {
        // Stream closed
      }
      // If we get here without resolving, the process exited before printing the URL
      clearTimeout(timer)
      if (!url) {
        reject(new Error('Server process exited before printing CRAFT_SERVER_URL'))
      }
    })()
  })
}
