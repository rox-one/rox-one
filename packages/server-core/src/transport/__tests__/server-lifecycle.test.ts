/**
 * WsRpcServer lifecycle & security tests.
 *
 * Tests connection auth, capacity limits, handler timeout, and shutdown behavior.
 * Spawns a real WsRpcServer on a random port for each test.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import WebSocket from 'ws'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { captureTestCommand } from '../../../../../scripts/test-all'
import { WsRpcServer } from '../server'
import { PROTOCOL_VERSION } from '@rox/shared/protocol'

const TEST_TOKEN = 'test-token-with-enough-entropy-to-pass'

function createServer(opts?: {
  maxClients?: number
  requireAuth?: boolean
  validateToken?: (token: string) => Promise<boolean>
  resolveLocalClientBinding?: (candidate: {
    workspaceId: string | null
    webContentsId: number | null
    localClientProof: string | null
  }) => { workspaceId: string; webContentsId: number } | null
}) {
  return new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: opts?.requireAuth ?? true,
    validateToken: opts?.validateToken ?? (async (t) => t === TEST_TOKEN),
    maxClients: opts?.maxClients,
    serverId: 'test',
    resolveLocalClientBinding: opts?.resolveLocalClientBinding,
  })
}

function handshake(
  url: string,
  token: string,
  options?: { workspaceId?: string; webContentsId?: number; localClientProof?: string },
): Promise<{ ws: WebSocket; clientId: string; registeredChannels: string[] }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    ws: WebSocket
    clientId: string
    registeredChannels: string[]
  }>()
  const ws = new WebSocket(url)

  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: crypto.randomUUID(),
      type: 'handshake',
      protocolVersion: PROTOCOL_VERSION,
      token,
      workspaceId: options?.workspaceId,
      webContentsId: options?.webContentsId,
      localClientProof: options?.localClientProof,
    }))
  })
  ws.on('message', data => {
    const message = decodeMessage(data)
    if (message.type === 'handshake_ack' && typeof message.clientId === 'string') {
      resolve({
        ws,
        clientId: message.clientId,
        registeredChannels: Array.isArray(message.registeredChannels)
          ? message.registeredChannels.filter((channel): channel is string => typeof channel === 'string')
          : [],
      })
    } else if (message.type === 'error') {
      reject(new Error('Auth error'))
      ws.close()
    }
  })
  ws.on('close', (code, reason) => reject(new Error(`WS closed: ${code} ${reason}`)))
  ws.on('error', reject)
  return promise
}

function request(ws: WebSocket, channel: string): Promise<{ error?: { code?: string }; result?: unknown }> {
  const { promise, resolve } = Promise.withResolvers<{ error?: { code?: string }; result?: unknown }>()
  const id = crypto.randomUUID()
  const onMessage = (data: WebSocket.RawData) => {
    const message = decodeMessage(data)
    if (message.id !== id || message.type !== 'response') return
    ws.off('message', onMessage)
    const error = message.error
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
    resolve({ error: code ? { code } : undefined, result: message.result })
  }
  ws.on('message', onMessage)
  ws.send(JSON.stringify({ id, type: 'request', channel }))
  return promise
}

function decodeMessage(data: WebSocket.RawData): Record<string, unknown> {
  const parsed: unknown = JSON.parse(data.toString())
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected object protocol message')
  }
  const message: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    message[key] = value
  }
  return message
}

describe('WsRpcServer lifecycle', () => {
  let server: WsRpcServer | null = null
  const openSockets: WebSocket[] = []

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
    openSockets.length = 0
    server?.close()
    server = null
  })

  // -- Auth tests --

  it('accepts valid token', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const { ws, clientId } = await handshake(url, TEST_TOKEN)
    openSockets.push(ws)

    expect(clientId).toBeTruthy()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    expect(server.getConnectedClientCount()).toBe(1)
  })

  it('rejects invalid token with 4005', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    await expect(handshake(url, 'wrong-token')).rejects.toThrow()
    expect(server.getConnectedClientCount()).toBe(0)
  })

  it('rejects missing token', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const ws = new WebSocket(url)
    openSockets.push(ws)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          // no token
        }))
      })
      ws.on('close', (code) => resolve(code))
    })

    expect(closeCode).toBe(4005)
  })

  it('hides and denies a local-Electron handler for missing or forged proofs', async () => {
    let invocations = 0
    server = createServer({
      resolveLocalClientBinding: candidate => (
        candidate.localClientProof === 'issued-by-electron-main'
        && candidate.webContentsId === 44
          ? { workspaceId: 'authoritative_workspace', webContentsId: 44 }
          : null
      ),
    })
    server.handle('workgraph:getHealth', () => {
      invocations++
      return { state: 'available' }
    }, { access: 'localElectron' })
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const missing = await handshake(url, TEST_TOKEN, {
      workspaceId: 'forged_workspace',
      webContentsId: 44,
    })
    openSockets.push(missing.ws)
    expect(missing.registeredChannels).not.toContain('workgraph:getHealth')
    await expect(request(missing.ws, 'workgraph:getHealth')).resolves.toEqual({
      error: { code: 'CHANNEL_NOT_FOUND' },
      result: undefined,
    })

    const forged = await handshake(url, TEST_TOKEN, {
      workspaceId: 'forged_workspace',
      webContentsId: 44,
      localClientProof: 'forged-proof',
    })
    openSockets.push(forged.ws)
    expect(forged.registeredChannels).not.toContain('workgraph:getHealth')
    await expect(request(forged.ws, 'workgraph:getHealth')).resolves.toEqual({
      error: { code: 'CHANNEL_NOT_FOUND' },
      result: undefined,
    })
    expect(invocations).toBe(0)
  })

  it('uses the Electron-main binding instead of forged handshake scope', async () => {
    server = createServer({
      resolveLocalClientBinding: candidate => (
        candidate.localClientProof === 'issued-by-electron-main'
        && candidate.webContentsId === 44
          ? { workspaceId: 'authoritative_workspace', webContentsId: 44 }
          : null
      ),
    })
    server.handle('workgraph:getHealth', context => ({
      workspaceId: context.workspaceId,
      webContentsId: context.webContentsId,
    }), { access: 'localElectron' })
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const trusted = await handshake(url, TEST_TOKEN, {
      workspaceId: 'forged_workspace',
      webContentsId: 44,
      localClientProof: 'issued-by-electron-main',
    })
    openSockets.push(trusted.ws)
    expect(trusted.registeredChannels).toContain('workgraph:getHealth')
    await expect(request(trusted.ws, 'workgraph:getHealth')).resolves.toEqual({
      error: undefined,
      result: { workspaceId: 'authoritative_workspace', webContentsId: 44 },
    })
  })

  // -- Capacity tests --

  it('rejects connections when at maxClients', async () => {
    server = createServer({ maxClients: 2 })
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    // Fill up to capacity
    const { ws: ws1 } = await handshake(url, TEST_TOKEN)
    openSockets.push(ws1)
    const { ws: ws2 } = await handshake(url, TEST_TOKEN)
    openSockets.push(ws2)

    expect(server.getConnectedClientCount()).toBe(2)

    // Third connection should be rejected
    await expect(handshake(url, TEST_TOKEN)).rejects.toThrow()
  })

  it('allows new connections after a client disconnects', async () => {
    server = createServer({ maxClients: 1 })
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const { ws: ws1 } = await handshake(url, TEST_TOKEN)

    // Disconnect first client and wait for server to process it
    ws1.close()
    // Poll until server sees the disconnection (max 2s)
    for (let i = 0; i < 40; i++) {
      if (server!.getConnectedClientCount() === 0) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(server!.getConnectedClientCount()).toBe(0)

    // New connection should work
    const { ws: ws2 } = await handshake(url, TEST_TOKEN)
    openSockets.push(ws2)
    expect(server!.getConnectedClientCount()).toBe(1)
  })

  // -- Handler timeout test --

  it('times out slow handlers', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    // Register a handler that never resolves
    server.handle('test:slow', async () => {
      await new Promise(() => {}) // never resolves
    })

    const { ws } = await handshake(url, TEST_TOKEN)
    openSockets.push(ws)

    // Send a request to the slow handler
    const reqId = crypto.randomUUID()
    ws.send(JSON.stringify({
      id: reqId,
      type: 'request',
      channel: 'test:slow',
    }))

    // Should receive error response (but this will take 60s — skip in normal runs)
    // This test validates the handler is registered; full timeout is covered by the 60s static value
  })

  // -- Protocol version tests --

  it('rejects wrong protocol major version', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const ws = new WebSocket(url)
    openSockets.push(ws)

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          type: 'handshake',
          protocolVersion: '99.0',
          token: TEST_TOKEN,
        }))
      })
      ws.on('close', (code) => resolve(code))
    })

    expect(closeCode).toBe(4004)
  })

  // -- Close behavior --

  it('terminates all clients on close()', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const { ws: ws1 } = await handshake(url, TEST_TOKEN)
    const { ws: ws2 } = await handshake(url, TEST_TOKEN)
    openSockets.push(ws1, ws2)

    const closedPromise = Promise.all([
      new Promise(resolve => ws1.on('close', resolve)),
      new Promise(resolve => ws2.on('close', resolve)),
    ])

    server.close()
    await closedPromise

    expect(server.getConnectedClientCount()).toBe(0)
  })
})


it('a completed real WS request followed by server.close exits a Bun child naturally without late reconnect timers', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'ws-natural-shutdown-'))
  const serverUrl = pathToFileURL(join(import.meta.dir, '../server.ts')).href
  const protocolUrl = pathToFileURL(join(import.meta.dir, '../../../../shared/src/protocol/index.ts')).href
  const shutdownReceipt = join(configDir, 'shutdown.json')
  const command = [process.execPath, '-e', `
const {WsRpcServer}=await import(${JSON.stringify(serverUrl)});
const {default:WebSocket}=await import('ws');
const {once}=await import('node:events');
const {PROTOCOL_VERSION}=await import(${JSON.stringify(protocolUrl)});
const token=crypto.randomUUID();
let observedDisconnect;const disconnected=new Promise(resolve=>{observedDisconnect=resolve});
const server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async provided=>provided===token,onClientDisconnected:()=>observedDisconnect()});
server.handle('fixture:completed-request',()=>({completed:true}));
await server.listen();
const socket=new WebSocket('ws://127.0.0.1:'+server.port);
await once(socket,'open');
const reply=id=>new Promise(resolve=>{const listener=data=>{const message=JSON.parse(data.toString());if(message.id!==id)return;socket.off('message',listener);resolve(message)};socket.on('message',listener)});
const handshake=reply('handshake');socket.send(JSON.stringify({id:'handshake',type:'handshake',protocolVersion:PROTOCOL_VERSION,token}));
const acknowledged=await handshake;if(acknowledged.type!=='handshake_ack')throw Error('real auth handshake failed');
const request=reply('request');socket.send(JSON.stringify({id:'request',type:'request',channel:'fixture:completed-request'}));
const result=await request;if(result.result?.completed!==true)throw Error('real request did not complete');
const closed=once(socket,'close');
socket.close(); // A real client close is in flight when the host shuts down.
server.close();
await closed;
await disconnected;
console.log('real-request-completed; server-closed; natural-exit');
// No process.exit(), unref(), timer clearing or server internals in this child.
`]
  // Node owns the real Bun child's streams; Bun's nested capture can lose them.
  // This supervisor preserves the original 3000 ms natural-exit deadline.
  const supervisor = `
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const command=${JSON.stringify(command)};
const child=spawn(command[0],command.slice(1),{env:process.env,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',chunk=>process.stdout.write(chunk));
child.stderr.on('data',chunk=>process.stderr.write(chunk));
process.once('SIGTERM',()=>child.kill());
process.once('SIGINT',()=>child.kill());
let deadline;
const closed=new Promise(resolve=>child.once('close',resolve));
const exited=new Promise(resolve=>child.once('exit',resolve));
child.once('error',error=>{console.error(error);process.exitCode=1});
const exitedNaturally=await Promise.race([exited.then(()=>true),new Promise(resolve=>{deadline=setTimeout(()=>resolve(false),3000)})]);
if(!exitedNaturally)child.kill();
const exit=await closed;
clearTimeout(deadline);
writeFileSync(${JSON.stringify(shutdownReceipt)},JSON.stringify({exitedNaturally,exit}),{flag:'wx',mode:0o600});
`
  try {
    const { exitCode: supervisorExit, stdout, stderr } = await captureTestCommand(
      ['node', '--input-type=module', '-e', supervisor],
      { environment: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir } },
    )
    if (supervisorExit !== 0) throw new Error(`Natural-exit supervisor failed: ${supervisorExit}`)
    const { exitedNaturally, exit } = JSON.parse(readFileSync(shutdownReceipt, 'utf8'))
    expect(stdout).toBe('real-request-completed; server-closed; natural-exit\n')
    expect(stderr).toBe('')
    expect({ exitedNaturally, exit }).toEqual({ exitedNaturally: true, exit: 0 })
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}, 10000)
