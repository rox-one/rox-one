import type {
  WorkflowModelCompletion,
  WorkflowModelGateway,
  WorkflowModelRequest,
  WorkflowToolCall,
  WorkflowToolRegistry,
  WorkflowToolResult,
} from './types.ts'

export type LoopbackModelGateway = WorkflowModelGateway & {
  calls: WorkflowModelRequest[]
  entered: Promise<void>
}

export type LoopbackReply =
  | string
  | ((request: WorkflowModelRequest) => string | Promise<string>)

export function createLoopbackModelGateway(
  replies: Record<string, LoopbackReply> = {},
): LoopbackModelGateway {
  const calls: WorkflowModelRequest[] = []
  let markEntered = () => {}
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })

  return {
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
        model: 'loopback',
        receipt: {
          provider: 'loopback',
          requestId: `model:${request.nodeId}`,
          verifiedAt: new Date(0).toISOString(),
        },
      }
    },
  }
}

export type LoopbackToolRegistry = WorkflowToolRegistry & {
  calls: WorkflowToolCall[]
}

export function createLoopbackToolRegistry(
  handlers: Record<string, (input: unknown) => string> = {},
): LoopbackToolRegistry {
  const calls: WorkflowToolCall[] = []
  return {
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
          provider: 'loopback-tools',
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
