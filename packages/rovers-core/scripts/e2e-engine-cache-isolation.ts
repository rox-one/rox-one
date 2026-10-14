/**
 * M1-B2 acceptance harness — the engine cache is redirected, the user's own
 * paths are untouched (`docs/m1-board.md` M1-B2).
 *
 * The M1-B2 assertion is negative and byte-level: after a **full Lima lifecycle**
 * (start → list → stop → delete) driven through `createLimaEngine`, the user's
 * own `~/.docker/config.json` and `~/Library/Caches/lima` must be **identical**
 * (content hash, size, mtime, inode for the file; a recursive entry fingerprint
 * for the tree), while the VM data lives under the engine's `cacheRoot`.
 *
 *   bun run scripts/e2e-engine-cache-isolation.ts
 *
 * Environment:
 *   ROVERS_E2E_LIMACTL   Path to `limactl` (default: the vendored binary in the
 *                        m1b1 worktree, whose sibling `share/lima` tree makes a
 *                        boot possible without network staging).
 *   ROVERS_E2E_SKIP_VM=1 Prove only the env redirect + `version`/`list`
 *                        (no VM boot); useful when the network is unavailable.
 *
 * Exit code 0 only when every user-path fingerprint is unchanged AND the engine
 * cache root received the Lima data.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

import { defaultEngineConfig, ensureEngineDirs } from '../src/config/engine.ts'
import { createLimaEngine } from '../src/engines/local/lima.ts'

const DEFAULT_LIMACTL =
  '/Users/t/Projects/rox-worktrees/m1b1-share-lima/apps/electron/resources/bin/darwin-arm64/limactl'

const USER_CACHE = join(homedir(), 'Library', 'Caches', 'lima')
const USER_DOCKER_CONFIG = join(homedir(), '.docker', 'config.json')
/**
 * Short on purpose: Lima refuses an instance whose `ssh.sock.…` path exceeds
 * `UNIX_PATH_MAX=104`, so a long `tmpdir()` (`/var/folders/…`) alone overflows
 * the budget. `/tmp` keeps the harness inside the real limit — and that limit is
 * itself an M1-B2 finding (the engine must refuse an over-long cache root with a
 * typed error instead of an opaque `limactl` fatal).
 */
const ENGINE_ROOT = `/tmp/rv-${process.pid}`
const VM_NAME = `rv${process.pid}`

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

function step(name: string): void {
  process.stdout.write(`\n▸ ${name}\n`)
}

/** A stable fingerprint of one file: content hash + size + mtime + inode. */
function fileFingerprint(path: string): string {
  if (!existsSync(path)) return '(absent)'
  const st = statSync(path)
  const body = st.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : `dir:${st.size}`
  return `${body} size=${st.size} mtime=${st.mtimeMs} ino=${st.ino}`
}

/** A recursive fingerprint of a tree: every entry's relative path, size and mtime. */
function treeFingerprint(root: string): string {
  if (!existsSync(root)) return '(absent)'
  const entries: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name)
      const st = statSync(full)
      entries.push(`${relative(root, full)}|${entry.isDirectory() ? 'd' : 'f'}|${st.size}|${st.mtimeMs}`)
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(root)
  return createHash('sha256').update(entries.join('\n')).digest('hex') + ` (${entries.length} entries)`
}

function requireUnchanged(label: string, before: string, after: string): void {
  if (before !== after) {
    throw new Error(`${label} CHANGED\n  before: ${before}\n  after:  ${after}`)
  }
  log(`  ✓ ${label} unchanged — ${after}`)
}

async function main(): Promise<void> {
  const limactl = process.env.ROVERS_E2E_LIMACTL ?? DEFAULT_LIMACTL
  const skipVm = process.env.ROVERS_E2E_SKIP_VM === '1'

  log('M1-B2 — engine cache isolation (user HOME/Caches untouched)')
  log(`  limactl: ${limactl}`)
  log(`  user cache:  ${USER_CACHE}`)
  log(`  user config: ${USER_DOCKER_CONFIG}`)

  if (!existsSync(limactl)) throw new Error(`limactl not found: ${limactl} (set ROVERS_E2E_LIMACTL)`)

  step('snapshot the user-owned paths (before)')
  const cacheBefore = treeFingerprint(USER_CACHE)
  const dockerBefore = fileFingerprint(USER_DOCKER_CONFIG)
  log(`  ~/Library/Caches/lima -> ${cacheBefore}`)
  log(`  ~/.docker/config.json -> ${dockerBefore}`)

  const configDir = mkdtempSync(`${ENGINE_ROOT}-`)
  const paths = ensureEngineDirs(defaultEngineConfig(configDir))
  log(`\n  engine cacheRoot: ${paths.cacheRoot}`)
  log(`  engine limaHome:  ${paths.limaHome}`)

  const engine = createLimaEngine({ binaryPath: limactl, paths })
  log(`  engine HOME:      ${engine.env.HOME}`)
  log(`  engine LIMA_HOME: ${engine.env.LIMA_HOME}`)

  try {
    step('engine reports its version')
    const version = await engine.version()
    if (!version) throw new Error('limactl --version produced no parseable version')
    log(`  ✓ limactl ${version}`)

    step('spawn env is fully redirected')
    const required: Record<string, string> = {
      HOME: paths.home,
      LIMA_HOME: paths.limaHome,
      XDG_CACHE_HOME: paths.xdgCacheHome,
    }
    for (const [key, expected] of Object.entries(required)) {
      if (engine.env[key] !== expected) throw new Error(`${key} not redirected: ${engine.env[key]} !== ${expected}`)
      log(`  ✓ ${key}=${engine.env[key]}`)
    }

    if (skipVm) {
      log('\n(skipping the VM lifecycle — ROVERS_E2E_SKIP_VM=1)')
    } else {
      step(`full lifecycle — start template:alpine as ${VM_NAME}`)
      const start = await engine.run(['start', '--name', VM_NAME, '--tty=false', 'template:alpine'], {
        timeoutMs: 900_000,
        maxBytes: 262_144,
      })
      if (start.code !== 0) {
        throw new Error(`limactl start failed (code ${start.code})\n${start.stderr || start.stdout}`)
      }
      log('  ✓ VM started')

      step('instance is visible to the engine (in its own LIMA_HOME)')
      const instances = await engine.listInstances()
      if (!instances.includes(VM_NAME)) {
        throw new Error(`listInstances() did not include ${VM_NAME}; got: ${instances.join(', ') || '(none)'}`)
      }
      log(`  ✓ instances: ${instances.join(', ')}`)

      step('the cache landed under the engine dir, not the user cache')
      const engineTree = treeFingerprint(paths.limaHome)
      if (engineTree === '(absent)') throw new Error(`engine LIMA_HOME was never populated: ${paths.limaHome}`)
      log(`  ✓ ${paths.limaHome} -> ${engineTree}`)

      step('stop + delete the VM')
      const stop = await engine.run(['stop', VM_NAME], { timeoutMs: 300_000 })
      if (stop.code !== 0) throw new Error(`limactl stop failed (code ${stop.code})`)
      const del = await engine.run(['delete', VM_NAME, '--force'], { timeoutMs: 300_000 })
      if (del.code !== 0) throw new Error(`limactl delete failed (code ${del.code})`)
      log('  ✓ stopped and deleted')
    }

    step('snapshot the user-owned paths (after) — the M1-B2 assertion')
    requireUnchanged('~/Library/Caches/lima', cacheBefore, treeFingerprint(USER_CACHE))
    requireUnchanged('~/.docker/config.json', dockerBefore, fileFingerprint(USER_DOCKER_CONFIG))

    log('\nPASS — Lima ran entirely inside the engine cache; user HOME and ~/.docker are untouched')
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

await main()
