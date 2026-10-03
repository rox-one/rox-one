import { expect, test } from 'bun:test'
import { deferNotification, emptyFocusState } from '../../lib/focus-session'

test('Focus coalesces only matching workspace/session and retains first-seen order', () => {
  let state = emptyFocusState()
  for (const [workspaceId, title] of [['a', 'A'], ['b', 'B'], ['a', 'A2']]) {
    state = deferNotification(state, { workspaceId: workspaceId!, sessionId: 'same', title: title!, at: 1 })
  }
  expect(state.queue.map(q => [q.workspaceId, q.title, q.count])).toEqual([['a', 'A2', 2], ['b', 'B', 1]])
})

test('Focus keeps newest 100 entries without moving an updated entry', () => {
  let state = emptyFocusState()
  for (let i = 0; i < 101; i++) state = deferNotification(state, { workspaceId: `w${i}`, sessionId: 'same', title: String(i), at: i })
  expect(state.queue).toHaveLength(100)
  expect(state.queue[0]?.workspaceId).toBe('w1')
  state = deferNotification(state, { workspaceId: 'w1', sessionId: 'same', title: 'Updated', at: 102 })
  expect(state.queue).toHaveLength(100)
  expect(state.queue[0]).toMatchObject({ workspaceId: 'w1', title: 'Updated', count: 2 })
  expect(state.queue.at(-1)?.workspaceId).toBe('w100')
})

test('isolated production hook closures honor enabled setting before Focus persistence', async () => {
  const child = Bun.spawn([process.execPath, new URL('./fixtures/focus-notification-runner.ts', import.meta.url).pathname], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), 5000)
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    expect(stdout).toContain('PASS actual hook closures')
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill() }
}, 8000)
