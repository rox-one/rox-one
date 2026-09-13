import type {
  WorkflowModelCompletion,
  WorkflowModelGateway,
  WorkflowModelRequest,
  WorkflowToolCall,
  WorkflowToolRegistry,
  WorkflowToolResult,
} from './types.ts'

export const LOOPBACK_KIND = 'loopback' as const
export const LOOPBACK_MODEL_PROVIDER = 'loopback' as const
export const LOOPBACK_TOOLS_PROVIDER = 'loopback-tools' as const

export type LoopbackModelGateway = WorkflowModelGateway & {
  kind: typeof LOOPBACK_KIND
  calls: WorkflowModelRequest[]
  entered: Promise<void>
}

export type LoopbackReply =
  | string
  | ((request: WorkflowModelRequest) => string | Promise<string>)

export function isLoopbackProvider(provider: string | undefined): boolean {
  if (!provider) return false
  return (
    provider === LOOPBACK_MODEL_PROVIDER ||
    provider === LOOPBACK_TOOLS_PROVIDER ||
    provider.startsWith('loopback')
  )
}

export function isLoopbackTransport(input: {
  gateway: WorkflowModelGateway
  tools: WorkflowToolRegistry
}): boolean {
  return input.gateway.kind === LOOPBACK_KIND || input.tools.kind === LOOPBACK_KIND
}

export function createLoopbackModelGateway(
  replies: Record<string, LoopbackReply> = {},
): LoopbackModelGateway {
  const calls: WorkflowModelRequest[] = []
  let markEntered = () => {}
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })

  return {
    kind: LOOPBACK_KIND,
    calls,
    entered,
    async complete(request: WorkflowModelRequest): Promise<WorkflowModelCompletion> {
      calls.push(request)
      markEntered()
      throwIfAborted(request.signal)
      const reply = replies[request.nodeTitle] ?? replies[request.nodeId]
      const text = await resolveReply(reply, request)
      throwIfAborted(request.signal)
      return {
        text,
        model: LOOPBACK_KIND,
        receipt: {
          provider: LOOPBACK_MODEL_PROVIDER,
          requestId: `model:${request.nodeId}`,
          verifiedAt: new Date(0).toISOString(),
        },
      }
    },
  }
}

export type LoopbackToolRegistry = WorkflowToolRegistry & {
  kind: typeof LOOPBACK_KIND
  calls: WorkflowToolCall[]
}

export function createLoopbackToolRegistry(
  handlers: Record<string, (input: unknown) => string> = {},
): LoopbackToolRegistry {
  const calls: WorkflowToolCall[] = []
  return {
    kind: LOOPBACK_KIND,
    calls,
    async call(call: WorkflowToolCall): Promise<WorkflowToolResult> {
      throwIfAborted(call.signal)
      calls.push(call)
      const handler = handlers[call.name]
      const text = handler ? handler(call.input) : JSON.stringify(call.input ?? null)
      throwIfAborted(call.signal)
      return {
        text,
        receipt: {
          provider: LOOPBACK_TOOLS_PROVIDER,
          requestId: `tool:${call.nodeId}`,
          verifiedAt: new Date(0).toISOString(),
        },
      }
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

async function resolveReply(reply: LoopbackReply | undefined, request: WorkflowModelRequest): Promise<string> {
  if (reply == null) return `loopback:${request.nodeId}`
  if (typeof reply === 'function') return await reply(request)
  return reply
}
