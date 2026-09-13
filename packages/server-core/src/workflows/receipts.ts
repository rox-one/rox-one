import type { LiveWorkflowRun, WorkflowReceiptStore } from './types.ts'

/** Per-call / test Map. Injecting this counts as a store; auto-creating it does not. */
export function createInMemoryReceiptStore(): WorkflowReceiptStore {
  const runs = new Map<string, LiveWorkflowRun>()
  return {
    get: (key) => runs.get(key),
    put: (key, run) => {
      runs.set(key, run)
    },
  }
}

export function runIdempotencyKey(input: {
  specVersionId: string
  mode: string
  nodeIds: readonly string[]
  explicit?: string
}): string {
  if (input.explicit) return input.explicit
  return `${input.specVersionId}:${input.mode}:${[...input.nodeIds].sort().join(',')}`
}
