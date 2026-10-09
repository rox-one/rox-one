import { describe, it, expect } from 'bun:test'
import type { WebSocket } from 'ws'
import { WsRpcServer } from '../server'

function makeServer(): WsRpcServer {
  return new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
}

// `safeSend` is private; reach it the way other tests reach private members
// (see packages/server-core/src/sessions/adopt-task-draft.test.ts).
function safeSend(server: WsRpcServer, ws: WebSocket, data: string): void {
  ;(server as unknown as { safeSend(ws: WebSocket, data: string): void }).safeSend(ws, data)
}

describe('WsRpcServer.safeSend', () => {
  it('a synchronously-throwing send is contained and the socket is closed', () => {
    const server = makeServer()
    const closed: Array<{ code?: number; reason?: string }> = []
    let sends = 0
    const socket = {
      readyState: 1,
      OPEN: 1,
      send() { sends += 1; throw new Error('send exploded') },
      close(code?: number, reason?: string) { closed.push({ code, reason }); socket.readyState = 2 },
    }
    const ws = socket as unknown as WebSocket

    // Three frames, as the reconnect replay loop (server.ts:993-995) would send
    // them. Without try/catch the first throw escapes and aborts the loop and
    // the registration after it; with the guard, all calls return and only the
    // first send is attempted (the socket is CLOSING after close()).
    expect(() => {
      safeSend(server, ws, 'frame-1')
      safeSend(server, ws, 'frame-2')
      safeSend(server, ws, 'frame-3')
    }).not.toThrow()
    expect(sends).toBe(1)
    expect(closed).toEqual([{ code: 1011, reason: 'send failed' }])

    server.close()
  })

  it('does not attempt a send when the socket is not OPEN', () => {
    const server = makeServer()
    let sends = 0
    const ws = {
      readyState: 3,
      OPEN: 1,
      send() { sends += 1 },
      close() {},
    } as unknown as WebSocket

    safeSend(server, ws, 'frame-1')
    expect(sends).toBe(0)
    server.close()
  })
})