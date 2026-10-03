import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

/** A private launcher records the exact owned fixture child before exec. */
export async function launchOwnedFixtureBrowser(options: Parameters<typeof chromium.launch>[0] = {}) {
  const marker = `--rox-ui001-fixture=${randomUUID()}`
  const directory = mkdtempSync(join(tmpdir(), 'rox-ui001-browser-'))
  const pidFile = join(directory, 'browser.pid')
  const actualExecutable = options.executablePath ?? chromium.executablePath()
  const browser = await chromium.launch({
    ...options,
    executablePath: process.platform === 'win32' ? actualExecutable : join(import.meta.dir, 'fixtures/voice-dictation/browser-launcher.sh'),
    args: [...(options.args ?? []), marker],
    env: { ...process.env, ...options.env, VOICE_BROWSER_PID_FILE: pidFile, VOICE_BROWSER_ACTUAL_EXECUTABLE: actualExecutable },
  })
  let stopped = false
  async function close() {
    if (stopped) return
    stopped = true
    const graceful = browser.close().catch(() => undefined)
    try {
      await Promise.race([graceful, Bun.sleep(2000)])
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8').trim())
        if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned browser PID')
        try {
          const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
          if (!command.includes(marker)) throw new Error('Recorded browser PID belongs to a different process')
          const group = Number(execFileSync('ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).trim())
          try { process.kill(group === pid ? -pid : pid, 'SIGKILL') }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        } catch (error) {
          if (!(error && typeof error === 'object' && 'status' in error && error.status === 1)) throw error
        }
        await Promise.race([graceful, Bun.sleep(2000)])
        try {
          const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
          if (!state.trim().startsWith('Z')) throw new Error('Owned fixture browser is still running')
        } catch (error) {
          if (!(error && typeof error === 'object' && 'status' in error && error.status === 1)) throw error
        }
      } else {
        await graceful
      }
      if (browser.isConnected()) throw new Error('Fixture browser connection survived teardown')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
  return { browser, close }
}
