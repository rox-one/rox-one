import { toErrorMessage } from '../../../../../lib/errors'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'

function capturePipe(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  const done = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        output = (output + decoder.decode(chunk.value, { stream: true })).slice(-65_536)
      }
      output += decoder.decode()
    } catch (error) { output += `\nOutput stream closed: ${toErrorMessage(error)}` }
  })()
  return { done, text: () => output, stop: () => { void reader.cancel().catch(() => {}) } }
}

// Test-only process boundary; Chromium and esbuild never share another test's Bun cache.
export function noteNativeBrowserStage(stage: string): void {
  console.error(`[native-browser] ${stage}`)
}

/**
 * One budget for every native browser case, shared by the child process, the
 * bun test timeout that bounds it and the Playwright page default timeout.
 * The chain is ordered so a slow, lazily-split renderer reports its own
 * failure instead of being killed by its own supervisor:
 * one Playwright action < one isolated case < the child kill deadline < the
 * supervising test.
 */
export const NATIVE_BROWSER_BUDGET_MS = 60_000
/** Derived: a single Playwright action inside one case. */
export const NATIVE_BROWSER_ACTION_TIMEOUT_MS = NATIVE_BROWSER_BUDGET_MS / 10
/** Derived: graceful shutdown plus final diagnostics for a child that already failed. */
const NATIVE_BROWSER_TEARDOWN_MS = 15_000
/** Derived: the child is killed only after its own case budget has expired. */
export const NATIVE_BROWSER_DEADLINE_MS = NATIVE_BROWSER_BUDGET_MS + NATIVE_BROWSER_TEARDOWN_MS
/** Derived: the supervising test must outlive the child kill deadline. */
export const NATIVE_BROWSER_PARENT_TIMEOUT_MS = NATIVE_BROWSER_DEADLINE_MS + NATIVE_BROWSER_TEARDOWN_MS

/**
 * The child `bun test` invocation for one browser case. Building the argv here
 * keeps the budget the single owner of the child's per-test and per-hook
 * timeouts: a bare `bun test <file>` falls back to bun's 5 s defaults, which a
 * loaded machine blows through even when the parent passes its own `--timeout`.
 */
export function nativeBrowserCaseCommand(file: string): string[] {
  return [process.execPath, 'test', '--timeout', String(NATIVE_BROWSER_BUDGET_MS), file]
}

export async function runNativeBrowserProcess(command: string[], options: {
  label: string
  env?: Record<string, string | undefined>
  deadlineMs?: number
}): Promise<number> {
  // Keep the original test CLI and environment, but require both diagnostic
  // pipes at the native Node spawn boundary. A Bun child had an undefined
  // stdout property despite requesting a pipe in the combined test lane.
  const child = spawn(command[0]!, command.slice(1), {
    env: options.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const stdout = capturePipe(Readable.toWeb(child.stdout))
  const stderr = capturePipe(Readable.toWeb(child.stderr))
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', error => reject(new Error(`Native browser case ${options.label} could not start: ${error.message}`)))
    child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGTERM' ? 143 : 137)))
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => {
      // Playwright handles SIGTERM and may stall during graceful browser shutdown.
      // The deadline must settle independently of that child process's exit.
      child.kill()
      resolve(null)
    }, options.deadlineMs ?? NATIVE_BROWSER_DEADLINE_MS)
  })
  let drainTimeout: ReturnType<typeof setTimeout> | undefined
  try {
    const exitCode = await Promise.race([exited, deadline])
    // Give graceful shutdown a bounded chance to deliver its final diagnostics.
    // Descendants can inherit the pipes, so EOF never controls the test deadline.
    await Promise.race([
      Promise.all([stdout.done, stderr.done]),
      new Promise<void>(resolve => { drainTimeout = setTimeout(resolve, 1_000) }),
    ])
    if (exitCode !== 0) throw new Error(`Native browser case ${options.label} ${exitCode === null ? 'timed out' : `exited ${exitCode}`}:\n${stdout.text()}${stderr.text()}`)
    return exitCode
  } finally {
    clearTimeout(timeout)
    clearTimeout(drainTimeout)
    child.kill('SIGKILL')
    stdout.stop()
    stderr.stop()
  }
}
