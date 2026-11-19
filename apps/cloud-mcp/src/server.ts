/**
 * Newline-delimited JSON-RPC 2.0 for the Model Context Protocol.
 *
 * This module is pure: it turns one line into at most one response line. The
 * process plumbing (stdin/stdout, stderr logging) lives in `index.ts`, so a
 * test or a wrapper can drive the same handler without a child process.
 */

import type { CloudClient } from './client.ts'
import { callTool, listTools, McpProtocolError } from './tools.ts'

export const PROTOCOL_VERSION = '2025-06-18'

const SERVER_INFO = { name: 'rox-cloud', version: '0.1.0' } as const

export interface JsonRpcErrorBody {
  readonly code: number
  readonly message: string
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: string | number | null
  readonly result?: unknown
  readonly error?: JsonRpcErrorBody
}

export interface McpServerOptions {
  readonly client: CloudClient
  /** Diagnostics sink. Never stdout: stdout carries protocol frames only. */
  readonly log?: (line: string) => void
}

export interface McpServer {
  /** Returns the response line, or `null` when the message needs no reply. */
  handleLine(line: string): Promise<string | null>
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const log = options.log ?? ((_line: string) => {})

  async function dispatch(
    id: string | number | null,
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<JsonRpcResponse | null> {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: listTools() } }

      case 'tools/call': {
        const name = params?.['name']
        if (typeof name !== 'string' || name.length === 0) {
          return errorResponse(id, -32602, 'Поле name обязательно: имя инструмента')
        }
        const args = params?.['arguments']
        const result = await callTool(name, args, options.client)
        return { jsonrpc: '2.0', id, result }
      }

      default:
        return errorResponse(id, -32601, `Неизвестный метод: ${method}`)
    }
  }

  async function handleMessage(input: unknown): Promise<JsonRpcResponse | null> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return errorResponse(null, -32600, 'Запрос должен быть объектом JSON-RPC')
    }
    // Client JSON: the object shape is validated field by field below.
    const message = input as Record<string, unknown>

    const method = message['method']
    if (typeof method !== 'string' || method.length === 0) {
      return errorResponse(null, -32600, 'Поле method обязательно и должно быть строкой')
    }

    // A message without an id is a notification: JSON-RPC forbids a reply.
    if (!('id' in message)) return null

    const rawId = message['id']
    const id: string | number | null =
      typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null

    let params: Record<string, unknown> | undefined
    const rawParams = message['params']
    if (rawParams !== null && typeof rawParams === 'object' && !Array.isArray(rawParams)) {
      params = rawParams as Record<string, unknown>
    }

    try {
      return await dispatch(id, method, params)
    } catch (err) {
      if (err instanceof McpProtocolError) {
        return errorResponse(id, err.code, err.message)
      }
      log(`[rox-cloud-mcp] ${method} failed: ${err instanceof Error ? err.message : String(err)}`)
      return errorResponse(id, -32603, 'Внутренняя ошибка сервера Rox Cloud')
    }
  }

  return {
    async handleLine(line) {
      const trimmed = line.trim()
      if (trimmed.length === 0) return null

      let message: unknown
      try {
        message = JSON.parse(trimmed)
      } catch {
        return JSON.stringify(errorResponse(null, -32700, 'Строка не является корректным JSON'))
      }

      const response = await handleMessage(message)
      return response === null ? null : JSON.stringify(response)
    },
  }
}
