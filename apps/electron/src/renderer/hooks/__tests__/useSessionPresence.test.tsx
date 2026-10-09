/**
 * Hook-level regressions for the live-collaboration lifecycle (a2.1–a2.4).
 *
 * Mounts the real hooks in happy-dom so the effect lifecycle (watch heartbeat,
 * session-switch cleanup) is exercised on the production code path. IPC is
 * stubbed; no real session command leaves the process.
 */
import { useDomForFile } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  useSessionTypingBeacon,
  useSessionViewerWatch,
  type SessionTypingBeacon,
} from '../useSessionPresence'
import { VIEWER_WATCH_HEARTBEAT_MS } from '@/lib/session-presence'

const testWindow = useDomForFile()

interface SessionCommandCall {
  sessionId: string
  command: { type: string; typing?: boolean }
}

/** happy-dom's Window has no preload bridge; expose just the channel the hooks use. */
interface SessionCommandBridge {
  electronAPI: { sessionCommand(sessionId: string, command: SessionCommandCall['command']): Promise<void> }
}
const bridge = testWindow as unknown as SessionCommandBridge

let calls: SessionCommandCall[] = []

beforeEach(() => {
  calls = []
  bridge.electronAPI = {
    sessionCommand: (sessionId, command) => {
      calls.push({ sessionId, command })
      return Promise.resolve()
    },
  }
})

afterEach(() => {
  jest.useRealTimers()
  document.body.innerHTML = ''
})

const watchCallsFor = (sessionId: string) =>
  calls.filter(c => c.sessionId === sessionId && c.command.type === 'watchSession')
const typingCallsFor = (sessionId: string) =>
  calls.filter(c => c.sessionId === sessionId && c.command.type === 'setTyping')

async function mount(node: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return {
    async rerender(next: React.ReactElement) { await act(async () => { root.render(next) }) },
    async unmount() {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

function WatchProbe({ sessionId }: { sessionId: string | null }) {
  useSessionViewerWatch(sessionId)
  return null
}

function TypingProbe({
  sessionId,
  apiRef,
}: {
  sessionId: string | null
  apiRef: { current: SessionTypingBeacon | null }
}) {
  apiRef.current = useSessionTypingBeacon(sessionId)
  return null
}

describe('viewer watch heartbeat', () => {
  it('re-sends watchSession over time and stops the old session heartbeat on switch', async () => {
    jest.useFakeTimers()
    const view = await mount(<WatchProbe sessionId="A" />)

    expect(calls).toEqual([{ sessionId: 'A', command: { type: 'watchSession' } }])

    await act(async () => { jest.advanceTimersByTime(VIEWER_WATCH_HEARTBEAT_MS) })
    expect(watchCallsFor('A')).toHaveLength(2)
    await act(async () => { jest.advanceTimersByTime(VIEWER_WATCH_HEARTBEAT_MS) })
    expect(watchCallsFor('A')).toHaveLength(3)

    // Session switch: unwatch A, watch B, and A's heartbeat must stop.
    await view.rerender(<WatchProbe sessionId="B" />)
    expect(calls).toContainEqual({ sessionId: 'A', command: { type: 'unwatchSession' } })
    expect(watchCallsFor('B')).toHaveLength(1)

    await act(async () => { jest.advanceTimersByTime(VIEWER_WATCH_HEARTBEAT_MS * 2) })
    expect(watchCallsFor('A')).toHaveLength(3)
    expect(watchCallsFor('B')).toHaveLength(3)

    await view.unmount()
    expect(calls).toContainEqual({ sessionId: 'B', command: { type: 'unwatchSession' } })
    await act(async () => { jest.advanceTimersByTime(VIEWER_WATCH_HEARTBEAT_MS) })
    expect(watchCallsFor('B')).toHaveLength(3)
  })
})

describe('typing beacon session targeting', () => {
  it('clears the session that received the true when the user switches sessions', async () => {
    const apiRef: { current: SessionTypingBeacon | null } = { current: null }
    const view = await mount(<TypingProbe sessionId="A" apiRef={apiRef} />)

    await act(async () => { apiRef.current!.notifyTyping() })
    expect(typingCallsFor('A')).toEqual([{ sessionId: 'A', command: { type: 'setTyping', typing: true } }])

    // Switch to B while A still has an outstanding `true`: the cleanup must
    // clear A (the receiver), never the freshly-selected B.
    await view.rerender(<TypingProbe sessionId="B" apiRef={apiRef} />)
    expect(typingCallsFor('A')).toEqual([
      { sessionId: 'A', command: { type: 'setTyping', typing: true } },
      { sessionId: 'A', command: { type: 'setTyping', typing: false } },
    ])
    expect(typingCallsFor('B')).toEqual([])

    // A fresh `true` in B is then cleared against B.
    await act(async () => { apiRef.current!.notifyTyping() })
    await act(async () => { apiRef.current!.clearTyping() })
    expect(typingCallsFor('B')).toEqual([
      { sessionId: 'B', command: { type: 'setTyping', typing: true } },
      { sessionId: 'B', command: { type: 'setTyping', typing: false } },
    ])

    await view.unmount()
  })
})