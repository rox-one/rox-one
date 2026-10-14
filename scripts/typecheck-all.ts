/**
 * Run every workspace typecheck independently and report ALL failures.
 *
 * Why this exists: `typecheck:all` used to be one long `&&` chain. A `&&` chain
 * stops at the first failing workspace, so a green run meant "typechecked up to
 * the first breakage", not "typechecked everything" — and every workspace after
 * the first failure was silently unchecked. That is not hypothetical: three
 * independent type errors (packages/shared, packages/ui, packages/core) sat on
 * main at the same time and CI showed one per run, because each fix simply
 * revealed the next.
 *
 * This runner keeps the per-workspace process isolation `&&` gave us (each
 * target is its own `bun run` invocation, so a workspace cannot leak config into
 * another), but it collects exit codes instead of short-circuiting, prints every
 * failing workspace with its output, and exits non-zero if any failed.
 *
 *   bun run typecheck:all                 # all targets, bounded parallelism
 *   bun run typecheck:all --serial        # one at a time (low-memory machines)
 *   bun run typecheck:all --concurrency 4
 *   bun run typecheck:all --only packages/ui
 *   bun run typecheck:all --list
 */

import { spawn } from 'node:child_process'

/** One workspace typecheck: run `script` with `cwd` relative to the repo root. */
type Target = { readonly name: string; readonly cwd: string; readonly script: string }

/**
 * Every entry of the old `&&` chain, normalised to repo-root-relative `cwd`.
 * The order is kept so a serial run reads the same as the old chain did.
 */
const TARGETS: readonly Target[] = [
  { name: 'apps/cloud-gateway', cwd: 'apps/cloud-gateway', script: 'typecheck' },
  { name: 'packages/cloud-runner', cwd: 'packages/cloud-runner', script: 'typecheck' },
  { name: 'packages/messaging-discord-worker', cwd: 'packages/messaging-discord-worker', script: 'typecheck' },
  { name: 'packages/messaging-whatsapp-worker', cwd: 'packages/messaging-whatsapp-worker', script: 'typecheck' },
  { name: 'packages/test-harness', cwd: 'packages/test-harness', script: 'typecheck' },
  { name: 'packages/rovers-core-lite', cwd: 'packages/rovers-core-lite', script: 'typecheck' },
  { name: 'packages/rovers-core', cwd: 'packages/rovers-core', script: 'typecheck' },
  { name: 'packages/core', cwd: 'packages/core', script: 'tsc --noEmit' },
  { name: 'packages/browser-intel', cwd: 'packages/browser-intel', script: 'tsc --noEmit' },
  { name: 'packages/shared', cwd: 'packages/shared', script: 'tsc --noEmit' },
  { name: 'packages/server-core', cwd: 'packages/server-core', script: 'tsc --noEmit' },
  { name: 'packages/server', cwd: 'packages/server', script: 'tsc --noEmit' },
  { name: 'packages/session-tools-core', cwd: 'packages/session-tools-core', script: 'tsc --noEmit' },
  { name: 'packages/pi-agent-server', cwd: 'packages/pi-agent-server', script: 'typecheck' },
  { name: 'apps/electron', cwd: 'apps/electron', script: 'typecheck' },
  { name: 'packages/ui', cwd: 'packages/ui', script: 'tsc --noEmit' },
  { name: 'workers/pages', cwd: '.', script: 'typecheck:pages-worker' },
  { name: 'apps/workspace-service', cwd: '.', script: 'workspace-service:typecheck' },
  { name: 'packages/session-mcp-server', cwd: 'packages/session-mcp-server', script: 'typecheck' },
  { name: 'apps/cli', cwd: 'apps/cli', script: 'typecheck' },
  { name: 'apps/viewer', cwd: 'apps/viewer', script: 'typecheck' },
  { name: 'apps/webui', cwd: 'apps/webui', script: 'typecheck' },
]

const DEFAULT_CONCURRENCY = 4

type Result = { readonly target: Target; readonly code: number; readonly output: string }

function parseArgs(argv: readonly string[]): {
  serial: boolean
  concurrency: number
  only: ReadonlySet<string>
  list: boolean
} {
  let serial = false
  let concurrency = DEFAULT_CONCURRENCY
  const only = new Set<string>()
  let list = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--serial') serial = true
    else if (arg === '--list') list = true
    else if (arg === '--concurrency') {
      const raw = argv[i + 1]
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--concurrency expects a positive integer, got ${raw}`)
      concurrency = parsed
      i += 1
    } else if (arg === '--only') {
      const raw = argv[i + 1]
      if (!raw) throw new Error('--only expects a target name')
      only.add(raw)
      i += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { serial, concurrency: serial ? 1 : concurrency, only, list }
}

/** Run one target, capturing combined stdout+stderr so a failure keeps its diagnostics. */
function runTarget(target: Target, root: string): Promise<Result> {
  return new Promise((resolve) => {
    // `script` may be a package.json script name (`typecheck`) or a direct binary
    // invocation (`tsc --noEmit`), so it has to be split into argv — passing it as
    // one argument makes bun look for a script literally named "tsc --noEmit".
    const argv = target.script.split(/\s+/).filter(Boolean)
    const child = spawn('bun', ['run', ...argv], {
      cwd: `${root}/${target.cwd}`,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', (err) => resolve({ target, code: 1, output: `${output}\nfailed to spawn: ${err.message}` }))
    child.on('close', (code) => resolve({ target, code: code ?? 1, output }))
  })
}

/** Bounded-parallel map that preserves input order in the result array. */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()

if (args.list) {
  for (const t of TARGETS) console.log(`${t.name}\t(cd ${t.cwd} && bun run ${t.script})`)
  process.exit(0)
}

const selected = args.only.size === 0 ? TARGETS : TARGETS.filter((t) => args.only.has(t.name))
if (selected.length === 0) {
  console.error(`typecheck-all: --only matched no target. Known: ${TARGETS.map((t) => t.name).join(', ')}`)
  process.exit(2)
}
const unknown = [...args.only].filter((name) => !TARGETS.some((t) => t.name === name))
if (unknown.length > 0) {
  console.error(`typecheck-all: unknown target(s): ${unknown.join(', ')}`)
  process.exit(2)
}

const started = Date.now()
const results = await mapBounded(selected, args.concurrency, async (target) => {
  process.stdout.write(`typecheck-all: ${target.name} … `)
  const result = await runTarget(target, root)
  process.stdout.write(result.code === 0 ? 'ok\n' : 'FAILED\n')
  return result
})

const failed = results.filter((r) => r.code !== 0)

// Every failure keeps its full output: the whole point is that the next reader
// must not have to re-run the suite to find out what else is broken.
for (const result of failed) {
  console.error(`\n${'='.repeat(72)}\ntypecheck-all: ${result.target.name} FAILED (exit ${result.code})\n${'='.repeat(72)}`)
  console.error(result.output.trimEnd())
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
if (failed.length === 0) {
  console.log(`\ntypecheck-all: OK — ${results.length} target(s) clean in ${seconds}s.`)
  process.exit(0)
}

console.error(
  `\ntypecheck-all: ${failed.length} of ${results.length} target(s) FAILED in ${seconds}s: ` +
  `${failed.map((r) => r.target.name).join(', ')}`,
)
process.exit(1)
