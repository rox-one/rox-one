/**
 * The six tools an agent gets. A tool is a thin, honest translation between
 * the JSON an MCP client sends and one call on the Rox Cloud client — no
 * defaults that hide a decision, no retries, no invented data.
 */

import { CloudApiError } from './client.ts'
import type { CloudClient, Sandbox, SandboxList, SandboxOs } from './client.ts'

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface ToolContent {
  readonly type: 'text'
  readonly text: string
}

export interface ToolResult {
  readonly content: ToolContent[]
  readonly isError?: boolean
}

/** A JSON-RPC level failure (bad params, unknown tool), not a tool result. */
export class McpProtocolError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'McpProtocolError'
    this.code = code
  }
}

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'create_sandbox',
    description:
      'Создать машину в Rox Cloud. Возвращает её идентификатор, состояние и провайдера. ' +
      'По умолчанию linux, 2 ядра, 4 ГБ памяти. Ключ провайдера не нужен: его держит сервис Rox Cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        os: {
          type: 'string',
          enum: ['linux', 'windows', 'macos'],
          description: 'Операционная система машины. По умолчанию linux.',
        },
        cpu: { type: 'number', description: 'Сколько ядер процессора. По умолчанию 2.' },
        memoryGb: { type: 'number', description: 'Сколько гигабайт памяти. По умолчанию 4.' },
        ttlSec: {
          type: 'number',
          description: 'Срок жизни машины в секундах. Если не указан, действует срок провайдера.',
        },
        provider: {
          type: 'string',
          description: 'Идентификатор провайдера. Если не указан, сервис выбирает сам.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'exec',
    description:
      'Выполнить команду оболочки внутри уже созданной машины. Возвращает stdout, stderr и код выхода. ' +
      'Ненулевой код выхода — это ответ команды, а не ошибка вызова.',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'Идентификатор машины из create_sandbox.' },
        command: { type: 'string', description: 'Команда целиком, как её вводят в оболочке.' },
        timeoutSec: { type: 'number', description: 'Сколько секунд ждать команду, прежде чем прервать.' },
      },
      required: ['sandboxId', 'command'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description:
      'Прочитать файл из машины как текст UTF-8. Если файл не в UTF-8, в начало ответа добавляется предупреждение, ' +
      'а непонятные байты заменяются на �.',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'Идентификатор машины из create_sandbox.' },
        path: { type: 'string', description: 'Полный или относительный путь к файлу внутри машины.' },
      },
      required: ['sandboxId', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      'Записать текст в файл внутри машины. Родительские папки должны уже существовать. ' +
      'Содержимое пишется как UTF-8, прежнее содержимое файла заменяется.',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'Идентификатор машины из create_sandbox.' },
        path: { type: 'string', description: 'Полный или относительный путь к файлу внутри машины.' },
        content: { type: 'string', description: 'Текст, который нужно записать в файл.' },
      },
      required: ['sandboxId', 'path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sandboxes',
    description: 'Перечислить машины этого ключа: идентификатор, состояние, провайдер и срок жизни.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'stop_sandbox',
    description:
      'Остановить машину, не удаляя её: состояние станет stopped, запись и файлы останутся. ' +
      'Чтобы убрать машину совсем, её удаляют через API.',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'Идентификатор машины из create_sandbox.' },
      },
      required: ['sandboxId'],
      additionalProperties: false,
    },
  },
]

const DEFAULT_OS: SandboxOs = 'linux'
const DEFAULT_CPU = 2
const DEFAULT_MEMORY_GB = 4

const OS_VALUES: Record<string, true> = { linux: true, windows: true, macos: true }

function isSandboxOs(value: string): value is SandboxOs {
  return OS_VALUES[value] === true
}

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = args[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpProtocolError(-32602, `Поле ${field} обязательно и должно быть непустой строкой`)
  }
  return value
}

/** Reads an optional positive integer; absent and null both mean "not given". */
function optionalCount(args: Record<string, unknown>, field: string): number | undefined {
  const value = args[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new McpProtocolError(-32602, `Поле ${field} должно быть целым положительным числом`)
  }
  return value
}

function optionalText(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new McpProtocolError(-32602, `Поле ${field} должно быть непустой строкой`)
  }
  return value
}

function sandboxOs(args: Record<string, unknown>): SandboxOs {
  const value = args['os']
  if (value === undefined || value === null) return DEFAULT_OS
  if (typeof value !== 'string' || !isSandboxOs(value)) {
    throw new McpProtocolError(-32602, 'Поле os должно быть одним из: linux, windows, macos')
  }
  return value
}

function refusalText(err: CloudApiError): string {
  return JSON.stringify(
    {
      code: err.code,
      message: err.message,
      request_id: err.requestId ?? null,
      status: err.status,
    },
    null,
    2,
  )
}

export function listTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } }))
}

export async function callTool(
  name: string,
  rawArguments: unknown,
  client: CloudClient,
): Promise<ToolResult> {
  if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
    throw new McpProtocolError(-32602, `Неизвестный инструмент: ${name}`)
  }

  let args: Record<string, unknown> = {}
  if (rawArguments !== undefined && rawArguments !== null) {
    if (typeof rawArguments !== 'object' || Array.isArray(rawArguments)) {
      throw new McpProtocolError(-32602, 'Аргументы инструмента должны быть объектом JSON')
    }
    args = rawArguments as Record<string, unknown>
  }

  try {
    switch (name) {
      case 'create_sandbox': {
        const cpu = optionalCount(args, 'cpu') ?? DEFAULT_CPU
        const memoryGb = optionalCount(args, 'memoryGb') ?? DEFAULT_MEMORY_GB
        const ttlSec = optionalCount(args, 'ttlSec')
        const provider = optionalText(args, 'provider')
        const sandbox: Sandbox = await client.createSandbox({
          os: sandboxOs(args),
          cpu,
          memoryGb,
          ...(ttlSec === undefined ? {} : { ttlSec }),
          ...(provider === undefined ? {} : { provider }),
        })
        return jsonResult(sandbox)
      }

      case 'exec': {
        const sandboxId = requiredString(args, 'sandboxId')
        const command = requiredString(args, 'command')
        const timeoutSec = optionalCount(args, 'timeoutSec')
        const result = await client.exec(sandboxId, {
          command,
          ...(timeoutSec === undefined ? {} : { timeoutSec }),
        })
        return jsonResult(result)
      }

      case 'read_file': {
        const sandboxId = requiredString(args, 'sandboxId')
        const path = requiredString(args, 'path')
        const bytes = await client.readFile(sandboxId, path)
        try {
          return { content: [{ type: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }] }
        } catch {
          const lossy = new TextDecoder('utf-8').decode(bytes)
          const note = `Файл не в UTF-8 (${bytes.byteLength} байт): недопустимые байты заменены на �, текст показан с потерями.`
          return { content: [{ type: 'text', text: `${note}\n\n${lossy}` }] }
        }
      }

      case 'write_file': {
        const sandboxId = requiredString(args, 'sandboxId')
        const path = requiredString(args, 'path')
        const content = args['content']
        if (typeof content !== 'string') {
          throw new McpProtocolError(-32602, 'Поле content обязательно и должно быть строкой')
        }
        const bytes = new TextEncoder().encode(content)
        await client.writeFile(sandboxId, path, bytes)
        return {
          content: [{ type: 'text', text: `Файл записан: ${path} (${bytes.byteLength} байт)` }],
        }
      }

      case 'list_sandboxes': {
        const list: SandboxList = await client.listSandboxes()
        return jsonResult(list)
      }

      case 'stop_sandbox': {
        const sandboxId = requiredString(args, 'sandboxId')
        const sandbox: Sandbox = await client.stopSandbox(sandboxId)
        return jsonResult(sandbox)
      }

      default:
        // Unreachable: the name was checked above.
        throw new McpProtocolError(-32602, `Неизвестный инструмент: ${name}`)
    }
  } catch (err) {
    if (err instanceof McpProtocolError) throw err
    if (err instanceof CloudApiError) {
      return { content: [{ type: 'text', text: refusalText(err) }], isError: true }
    }
    const detail = err instanceof Error ? err.message : String(err)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { code: 'internal_error', message: `Внутренняя ошибка сервера: ${detail}`, request_id: null },
            null,
            2,
          ),
        },
      ],
      isError: true,
    }
  }
}
