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
  expect(Date.now() - startedAt).toBeLessThan(2_000)
}, 5_000)

it('a browser CLI that fails to spawn reports its case and startup failure without claiming success', async () => {
  let failure: unknown
  try {
    await runNativeBrowserProcess([`${process.execPath}.missing-native-browser-command`], {
      label: 'missing browser CLI', deadlineMs: 200,
    })
  } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toContain('missing browser CLI')
  expect(String(failure)).toMatch(/ENOENT|not found/i)
}, 5_000)

it('a fast browser CLI exit drains its real output and a failed exit retains both diagnostic pipes', async () => {
  for (let index = 0; index < 10; index++) {
    expect(await runNativeBrowserProcess([process.execPath, '-e', `console.log('fast browser receipt'); console.error('fast browser diagnostic')`], {
      label: `fast browser CLI ${index}`, deadlineMs: 1_000,
    })).toBe(0)
  }
  let failure: unknown
  try {
    await runNativeBrowserProcess([process.execPath, '-e', `console.log('native case entered'); console.error('canonical assertion failed'); process.exit(17)`], {
      label: 'failed browser assertion', deadlineMs: 1_000,
    })
  } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toContain('failed browser assertion exited 17')
  expect(String(failure)).toContain('native case entered')
  expect(String(failure)).toContain('canonical assertion failed')
}, 5_000)
