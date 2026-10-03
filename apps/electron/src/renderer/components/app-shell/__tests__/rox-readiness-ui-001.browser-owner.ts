import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

/** Own a headless fixture process through public Playwright server APIs. */
export async function launchOwnedFixtureBrowser(options: Parameters<typeof chromium.launchServer>[0] = {}) {
  const marker = `--rox-ui001-fixture=${randomUUID()}`
  const server = await chromium.launchServer({ ...options, args: [...(options.args ?? []), marker] })
  const child = server.process()
  const pid = child.pid
  if (!pid || !Number.isSafeInteger(pid) || pid <= 1) throw new Error('Fixture browser has no owned PID')
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  const browser = await chromium.connect(server.wsEndpoint())
  let stopped = false
  async function close() {
    if (stopped) return
    stopped = true
    // Bun may leave the transport close promise pending after process exit.
    // Recover only the recorded fixture child, then verify it cannot run.
    const graceful = Promise.all([browser.close(), server.close()]).catch(() => undefined)
    await Promise.race([graceful, Bun.sleep(2000)])
    if (process.platform !== 'win32') {
      try {
        const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
        if (!command.includes(marker)) throw new Error('Recorded browser PID belongs to a different process')
        const group = Number(execFileSync('ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).trim())
        try { process.kill(group === pid ? -pid : pid, 'SIGKILL') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      } catch (error) {
        if (!(error && typeof error === 'object' && 'status' in error && error.status === 1)) throw error
      }
      await Promise.race([exited, Bun.sleep(2000)])
      try {
        const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
        if (!state.trim().startsWith('Z')) throw new Error('Owned fixture browser is still running')
      } catch (error) {
        if (!(error && typeof error === 'object' && 'status' in error && error.status === 1)) throw error
      }
    } else {
      await server.kill()
    }
    if (browser.isConnected()) throw new Error('Fixture browser connection survived teardown')
  }
  return { browser, close }
}
