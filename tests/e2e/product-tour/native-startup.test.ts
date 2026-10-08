import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openNativeStartup, type NativeStartupDiagnostics } from './native-startup'

// Harness lifecycle tests use controlled app methods and actual child/file I/O.
// They do not launch Electron or establish macOS/Windows/native acceptance.
test('first-window failure records bounded actual stderr and owned main.log before closing and removing the profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'native-startup-lifecycle-'))
  await mkdir(join(profile, 'userData', 'logs'), { recursive: true })
  await writeFile(join(profile, 'userData', 'logs', 'main.log'), 'private old prefix\n' + 'x'.repeat(70_000) + '\nowned startup log tail')
  const child = spawn(process.execPath, ['-e', `process.stdin.once('data', () => process.stderr.write('x'.repeat(70000)+'\\nactual child startup failure')); setInterval(() => {}, 1000)`], { stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  const original = new Error('firstWindow: original 30000ms timeout')
  let diagnostics: NativeStartupDiagnostics | undefined
  const order: string[] = []
  try {
    await expect(openNativeStartup({ profile, launch: async () => ({
      process: () => child,
      async firstWindow() {
        const data = new Promise<void>(resolve => {
          let output = ''
          const read = (chunk: Buffer) => {
            output += chunk.toString()
            if (output.includes('actual child startup failure')) { child.stderr.off('data', read); resolve() }
          }
          child.stderr.on('data', read)
        })
        child.stdin.end('go'); await data; throw original
      },
      async close() { order.push('close'); child.kill('SIGKILL'); await exited },
    }), async report(value) { order.push('report'); expect(existsSync(profile)).toBe(true); diagnostics = value } })).rejects.toBe(original)
    expect(order).toEqual(['report', 'close'])
    expect(diagnostics).toMatchObject({ stage: 'first-window', error: String(original), pid: child.pid })
    expect(diagnostics!.stderr).toContain('actual child startup failure')
    expect(diagnostics!.stderr!.length).toBeLessThanOrEqual(64 * 1024)
    expect(diagnostics!.profileLogs).toHaveLength(1)
    expect(diagnostics!.profileLogs[0]!.tail).toContain('owned startup log tail')
    expect(diagnostics!.profileLogs[0]!.tail).not.toContain('private old prefix')
    expect(existsSync(profile)).toBe(false)
    expect(child.stderr.listenerCount('data')).toBe(0)
  } finally { child.kill('SIGKILL'); await rm(profile, { recursive: true, force: true }) }
}, 5_000)

test('launch failure removes its owned profile and preserves the original error even when reporting fails', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'native-startup-launch-'))
  const original = new Error('actual launch boundary rejected')
  let diagnostic: NativeStartupDiagnostics | undefined
  await expect(openNativeStartup({ profile, async launch() { throw original }, async report(value) {
    diagnostic = value; throw new Error('controlled attachment failure')
  } })).rejects.toBe(original)
  expect(diagnostic).toMatchObject({ stage: 'launch', pid: null, stderr: null, stdout: null })
  expect(existsSync(profile)).toBe(false)
})

test('successful startup closes once for concurrent disposal and removes its profile even when close fails', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'native-startup-dispose-'))
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  const original = new Error('controlled application close failure')
  let closes = 0
  let processCalls = 0
  try {
    const product = await openNativeStartup({ profile, launch: async () => ({
      process() {
        processCalls++
        // Playwright's ElectronApplication binding is disposed by close().
        if (closes) throw new TypeError("Cannot read properties of undefined (reading '_object')")
        return child
      }, firstWindow: async () => 'controlled-page',
      async close() { closes++; child.kill('SIGKILL'); await exited; throw original },
    }), async report() { throw new Error('successful startup must not report a failure') } })
    expect(product.page).toBe('controlled-page')
    expect(existsSync(profile)).toBe(true)
    const first = product.dispose(), second = product.dispose()
    expect(first).toBe(second)
    await expect(first).rejects.toBe(original)
    expect(closes).toBe(1)
    expect(processCalls).toBe(1)
    expect(existsSync(profile)).toBe(false)
    expect(child.stdout.listenerCount('data')).toBe(0)
    expect(child.stderr.listenerCount('data')).toBe(0)
  } finally { child.kill('SIGKILL'); await rm(profile, { recursive: true, force: true }) }
}, 5_000)
