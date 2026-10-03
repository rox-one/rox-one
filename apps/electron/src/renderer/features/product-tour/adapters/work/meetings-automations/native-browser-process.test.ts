import { expect, it } from 'bun:test'
import { runNativeBrowserProcess } from './native-browser-process'

it('native browser deadline reports live diagnostics even when the child handles SIGTERM', async () => {
  const startedAt = Date.now()
  let failure: unknown
  try {
    await runNativeBrowserProcess([process.execPath, '-e', `
      process.on('SIGTERM', () => console.error('graceful browser close stalled'));
      console.error('native fixture reached browser launch');
      setTimeout(() => process.exit(0), 10000);
    // Allow a cold Bun process to install its handler before testing a stalled
    // graceful shutdown. The supervisor must still enforce its own deadline.
    `], { label: 'stalled graceful close fixture', deadlineMs: 1500 })
  } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toContain('timed out')
  expect(String(failure)).toContain('native fixture reached browser launch')
  expect(String(failure)).toContain('graceful browser close stalled')
  expect(Date.now() - startedAt).toBeLessThan(4_000)
}, 6_000)
