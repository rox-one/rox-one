import assert from 'node:assert/strict'
import { mock } from 'bun:test'
let focused = false
mock.module('react', () => ({
  useState: () => [focused, () => {}], useEffect: () => {},
  useCallback: <T>(callback: T) => callback, useRef: <T>(value: T) => ({ current: value }),
  useMemo: <T>(factory: () => T) => factory(),
}))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
mock.module('@/lib/task-reminders', () => ({ useTaskReminders: () => {} }))
const values = new Map<string, string>()
let writes = 0
let gui = true
const notifications: unknown[][] = []
Object.assign(globalThis, { window: {
  localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes++; values.set(key, value) } },
  dispatchEvent: () => true,
  electronAPI: { isChannelAvailable: () => gui, showNotification: (...args: unknown[]) => notifications.push(args) },
} })
const focusPath = process.argv[2] || new URL('../../../lib/focus-session.ts', import.meta.url).pathname
const focus = await import(focusPath) as typeof import('../../../lib/focus-session')
mock.module('@/lib/focus-session', () => focus)
const hookPath = process.argv[3] || new URL('../../useNotifications.ts', import.meta.url).pathname
// React scheduling is mocked above; this fixture invokes the actual hook's
// deterministic closures explicitly rather than rendering a React component.
const { useNotifications: renderNotifications } = await import(hookPath) as typeof import('../../useNotifications')
const session = { id: 'same-session', name: 'Private title' } as Parameters<ReturnType<typeof renderNotifications>['showSessionNotification']>[0]
const reset = (active: boolean) => { values.clear(); writes = 0; notifications.length = 0; focused = false; gui = true; focus.saveFocusState(active ? focus.startFocus(focus.emptyFocusState(), 25, Date.now()) : focus.emptyFocusState()); writes = 0 }
reset(true)
renderNotifications({ workspaceId: 'workspace-a', enabled: false }).showSessionNotification(session, 'Private body')
assert.equal(writes, 0, 'Disabled notification must not write Focus storage')
assert.equal(focus.loadFocusState().queue.length, 0)
assert.equal(notifications.length, 0)
reset(true)
renderNotifications({ workspaceId: 'workspace-a', enabled: true }).showSessionNotification(session, 'First')
renderNotifications({ workspaceId: 'workspace-b', enabled: true }).showSessionNotification(session, 'Second')
renderNotifications({ workspaceId: 'workspace-a', enabled: true }).showSessionNotification(session, 'Updated')
assert.deepEqual(focus.loadFocusState().queue.map(q => [q.workspaceId, q.sessionId, q.body, q.count]), [['workspace-a', 'same-session', 'Updated', 2], ['workspace-b', 'same-session', 'Second', 1]])
assert.equal(notifications.length, 0)
reset(false)
renderNotifications({ workspaceId: 'workspace-a' }).showSessionNotification(session, 'x'.repeat(120))
assert.deepEqual(notifications, [['Private title', 'x'.repeat(97) + '...', 'workspace-a', 'same-session']])
assert.equal(writes, 0)
for (const scenario of ['focused', 'headless', 'no-workspace', 'disabled'] as const) {
  reset(false); focused = scenario === 'focused'; gui = scenario !== 'headless'
  renderNotifications({ workspaceId: scenario === 'no-workspace' ? null : 'workspace-a', enabled: scenario !== 'disabled' }).showSessionNotification(session, 'Body')
  assert.equal(notifications.length, 0, scenario); assert.equal(writes, 0, scenario)
}
reset(true); focused = true; gui = false
renderNotifications({ workspaceId: 'workspace-a' }).showSessionNotification(session, 'x'.repeat(160))
assert.equal(focus.loadFocusState().queue[0]?.body?.length, 140)
assert.equal(notifications.length, 0)
reset(true)
renderNotifications({ workspaceId: null }).showSessionNotification(session, 'Body')
assert.equal(writes, 0); assert.equal(notifications.length, 0)
console.log('PASS actual hook closures and production Focus storage functions')
