import { expect, test } from 'bun:test'
import { join } from 'node:path'

const scenarios = [
  ['remote-env', 'explicit remote workspace environment'],
  ['native-bound', 'initial native workspace fallback'],
  ['native-unbound', 'initial unbound workspace picker'],
] as const

for (const [scenario, description] of scenarios) {
  test(`thin preload reads current native window ownership with ${description}`, async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'thin-window-binding.fixture.ts'), scenario], {
      cwd: join(import.meta.dir, '../../..'),
      env: {
        ...process.env,
        CRAFT_SERVER_URL: 'wss://synthetic-authority.example.test',
        CRAFT_SERVER_TOKEN: 'synthetic-test-token',
        CRAFT_WORKSPACE_ID: scenario === 'remote-env' ? 'remote-env-workspace' : '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ exit, stdout, stderr }).toEqual({
      exit: 0,
      stdout: `thin preload ${scenario}: live native ownership, invalid and destroyed bindings, ignored arguments and IPC errors passed\n`,
      stderr: '',
    })
  }, 15_000)
}
