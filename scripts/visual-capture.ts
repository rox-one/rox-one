#!/usr/bin/env bun
/**
 * W1-10 (#1507) — `bun run visual:capture` CLI.
 *
 * Orchestrates the wave-2 browser driver: starts a Playground dev server for
 * this worktree (or reuses one given by `ROX_VISUAL_BASE_URL`), renders the
 * requested screens through `captureScreens`, and writes the artifacts the
 * `visual-snapshots` / `axe` / `one-rail-dom` gates read from
 * `<out>/.visual-artifacts/capture.json`.
 *
 * The server binds an ephemeral free port instead of the suite's fixed 5192:
 * `playwright.config.ts` pins that port and a sibling worktree's dev server can
 * occupy it, silently serving the wrong checkout.
 *
 * Usage:
 *   bun run visual:capture [--screens a,b] [--out <dir>] [--update-baselines]
 *
 * `--screens` accepts a stable base id (`screen-chat-display`) or a
 * fully-qualified Playground story id (`screen-chat-display-desktop`); the
 * default is the driver's documented screen list.
 */

import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import type { Subprocess } from 'bun'

import {
	captureEnvironment,
	captureScreens,
	DEFAULT_SCREEN_IDS,
	PLAYGROUND_PATH,
	resolveScreen,
} from '../packages/test-harness/src/capture-screens.ts'
import {
	CAPTURE_SCHEMA_VERSION,
	VISUAL_ARTIFACTS_DIR,
	VISUAL_BASELINES_FILE,
	writeArtifacts,
	writeBaselines,
} from '../packages/test-harness/src/capture.ts'

const REPO_ROOT = join(import.meta.dir, '..')
const SERVER_TIMEOUT_MS = 180_000

const args = process.argv.slice(2)

function valueFor(flag: string): string | undefined {
	const inline = args.find((arg) => arg.startsWith(`${flag}=`))
	if (inline) return inline.slice(flag.length + 1)
	const index = args.indexOf(flag)
	if (index === -1) return undefined
	const value = args[index + 1]
	return value && !value.startsWith('--') ? value : undefined
}

const screensArg = valueFor('--screens')
const outArg = valueFor('--out')
const updateBaselines = args.includes('--update-baselines')
const requestedIds = screensArg
	? screensArg.split(',').map((id) => id.trim()).filter(Boolean)
	: [...DEFAULT_SCREEN_IDS]
const outDir = outArg ? resolve(outArg) : REPO_ROOT

const unknown = requestedIds.filter((id) => !resolveScreen(id))
if (unknown.length > 0) {
	console.error(`visual-capture: unknown screen id(s): ${unknown.join(', ')}`)
	console.error(`available: ${DEFAULT_SCREEN_IDS.join(', ')}`)
	process.exit(2)
}

/** Ask the OS for an ephemeral loopback port (closed immediately, reused at once). */
function findFreePort(): Promise<number> {
	const { promise, resolve: resolvePort, reject } = Promise.withResolvers<number>()
	const probe = createServer()
	probe.once('error', reject)
	probe.listen(0, '127.0.0.1', () => {
		const address = probe.address()
		const port = address && typeof address === 'object' ? address.port : 0
		probe.close(() => (port > 0 ? resolvePort(port) : reject(new Error('no free port'))))
	})
	return promise
}

async function serverReachable(url: string): Promise<boolean> {
	try {
		return (await fetch(url)).ok
	} catch {
		return false
	}
}

/** Start this worktree's Playground dev server on `port` and wait until it answers. */
async function startServer(port: number, baseURL: string): Promise<Subprocess> {
	console.log(`visual-capture: starting the Playground server on port ${port}…`)
	const server = Bun.spawn({
		cmd: ['bun', 'run', 'scripts/playground-dev.ts', '--no-open'],
		cwd: REPO_ROOT,
		env: { ...process.env, ROX_VITE_PORT: String(port), CRAFT_VITE_PORT: String(port) } as Record<string, string>,
		stdout: 'ignore',
		stderr: 'ignore',
	})
	const url = `${baseURL}${PLAYGROUND_PATH}`
	const deadline = Date.now() + SERVER_TIMEOUT_MS
	while (Date.now() < deadline) {
		if (await serverReachable(url)) return server
		if (server.exitCode !== null) throw new Error(`Playground dev server exited early with code ${server.exitCode}`)
		await Bun.sleep(500)
	}
	server.kill()
	throw new Error(`Playground dev server not ready at ${url} within ${SERVER_TIMEOUT_MS / 1000}s`)
}

let server: Subprocess | undefined
const stopServer = () => server?.kill()
// A cancelled run must not orphan the Playground server it started.
process.once('exit', stopServer)
process.once('SIGINT', () => {
	stopServer()
	process.exit(130)
})
process.once('SIGTERM', () => {
	stopServer()
	process.exit(143)
})

try {
	const envBaseUrl = process.env.ROX_VISUAL_BASE_URL
	const baseURL = envBaseUrl ?? `http://127.0.0.1:${await findFreePort()}`
	server = envBaseUrl ? undefined : await startServer(Number(new URL(baseURL).port), baseURL)
	if (envBaseUrl && !(await serverReachable(`${baseURL}${PLAYGROUND_PATH}`))) {
		throw new Error(`ROX_VISUAL_BASE_URL=${envBaseUrl} is not serving ${PLAYGROUND_PATH}`)
	}
	try {
		const artifacts = await captureScreens({ repoRoot: outDir, screenIds: requestedIds, baseURL, log: console.log })
		await writeArtifacts(outDir, artifacts)

		if (updateBaselines) {
			const environment = await captureEnvironment(REPO_ROOT)
			await writeBaselines(REPO_ROOT, {
				schemaVersion: CAPTURE_SCHEMA_VERSION,
				environment,
				hashes: Object.fromEntries(artifacts.snapshots.map((snapshot) => [snapshot.key, snapshot.pixelHash])),
			})
			console.log(
				`visual-capture: wrote ${artifacts.snapshots.length} baseline hash(es) to ${VISUAL_BASELINES_FILE} (${environment})`,
			)
		}

		console.log('')
		for (const id of requestedIds) {
			const screen = resolveScreen(id)!
			const count = artifacts.snapshots.filter((snapshot) => snapshot.plan.screenId === screen.id).length
			const noteCount = artifacts.notes.filter((note) => note.includes(screen.id)).length
			console.log(
				`  ${count > 0 ? '✓' : '✗'} ${screen.id}: ${count} snapshot(s)${noteCount > 0 ? ` — ${noteCount} note(s)` : ''}`,
			)
		}
		for (const note of artifacts.notes) console.log(`  note: ${note}`)
		console.log(
			`visual-capture: totals — ${artifacts.screens.length} screen(s), ${artifacts.snapshots.length} snapshot(s), ${artifacts.notes.length} note(s)`,
		)
		console.log(`visual-capture: artifacts at ${join(outDir, VISUAL_ARTIFACTS_DIR)}`)

		// A run that captured nothing is a hard failure; render-per-screen problems are non-fatal notes.
		process.exitCode = artifacts.screens.length > 0 ? 0 : 1
	} finally {
		stopServer()
	}
} catch (error) {
	console.error(`visual-capture: ${error instanceof Error ? error.message : String(error)}`)
	process.exitCode = 1
}