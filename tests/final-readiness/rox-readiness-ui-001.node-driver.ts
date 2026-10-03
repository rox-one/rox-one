import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
export { expect } from '@playwright/test'

// Driver adapter only: run the exact same product callbacks/assertions with
// Node's supported Playwright websocket implementation. Canonical seeding
// remains a pinned Bun subprocess. No product module or API is substituted.
(globalThis as unknown as { Bun: unknown }).Bun = {
  spawn(command: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; stdout?: string; stderr?: string } = {}) {
    const child = spawn(command[0]!, command.slice(1), { cwd: options.cwd, env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'] })
    return { stdout: Readable.toWeb(child.stdout!), stderr: Readable.toWeb(child.stderr!),
      exited: new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) }) }
  },
}

export const describe = Object.assign((_name: string, callback: () => void) => callback(), {
  skipIf: (skip: boolean) => (_name: string, callback: () => void) => { if (!skip) callback() },
})
export function test(name: string, callback: () => Promise<void>, timeout: number) {
  const timer = setTimeout(() => { console.error(`FAIL driver timeout: ${name}`); process.exit(1) }, timeout)
  void callback().then(() => { console.log(`PASS actual native product: ${name}`) }, error => {
    console.error(error); process.exitCode = 1
  }).finally(() => { clearTimeout(timer) })
}
