import { expect, test } from 'bun:test'
import { runNativeProcess } from './native-process'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Real child-process checks; these do not execute or claim native product acceptance.
test('native CLI supervision records a real child exit and preserves failure', async () => {
  expect(await runNativeProcess('node', ['-e', 'process.exit(0)'], process.cwd(), 2_000)).toEqual({ exitCode: 0, signal: null, timedOut: false })
  expect(await runNativeProcess('node', ['-e', 'process.exit(7)'], process.cwd(), 2_000)).toEqual({ exitCode: 7, signal: null, timedOut: false })
})

test('native CLI supervision terminates a child that never exits within a bounded deadline', async () => {
  const started = Date.now()
  const result = await runNativeProcess('node', ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), 100)
  expect(result.timedOut).toBe(true)
  expect(result.exitCode).not.toBe(0)
  expect(Date.now() - started).toBeLessThan(7_500)
})

test('native CLI deadline kills its detached descendant and preserves a sibling process', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'product-tour-process-test-'))
  const pidFile = join(directory, 'child-pid')
  const sibling = spawn('node', ['-e', 'setInterval(() => {},1000)'], { stdio: 'ignore' })
  let descendant: number | undefined
  try {
    const program = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)`
    const result = await runNativeProcess('node', ['-e', program, pidFile], process.cwd(), 500)
    expect(result.timedOut).toBe(true)
    descendant = Number(readFileSync(pidFile, 'utf8'))
    if (process.platform === 'win32') {
      expect(() => process.kill(descendant!, 0)).toThrow()
    } else {
      const state = spawnSync('ps', ['-o', 'stat=', '-p', String(descendant)], { encoding: 'utf8' }).stdout.trim()
      // Linux containers may retain a killed orphan as a zombie until PID1 reaps it.
      expect(state === '' || state.startsWith('Z')).toBe(true)
    }
    expect(sibling.exitCode).toBeNull()
  } finally {
    sibling.kill('SIGKILL')
    if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch { /* Already killed. */ } }
    rmSync(directory, { recursive: true, force: true })
  }
})

test('native CLI supervision records executable startup failure', async () => {
  const result = await runNativeProcess('product-tour-deliberately-absent-executable', [], process.cwd(), 2_000)
  expect(result.exitCode).toBeNull()
  expect(result.error).toBeTruthy()
  expect(result.timedOut).toBe(false)
})
