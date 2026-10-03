import type { TaskSpec, RunLogEntry, NodeOutput } from '@rox/shared/tasks'
import { materializeDeps, nodeTitle } from '@rox/shared/tasks'
import type { RuntimeTask, RuntimeStatus } from '@rox/core/runtime-trace'

export interface TaskRuntimeObservation { spec: TaskSpec; slug: string; taskRunId: string; orchestratorSessionId?: string; entry: RunLogEntry; output?: NodeOutput; outputRef?: string; messageId?: string }

export function conductorTask(spec: TaskSpec, taskRunId: string, nodeId: string, status: RuntimeStatus, sessionId?: string): RuntimeTask {
  const node = spec.nodes.find(node => node.id === nodeId)
  const edges = materializeDeps(spec)
  return { id: `task:${taskRunId}:${nodeId}`, title: node ? nodeTitle(node) : nodeId,
    description: node?.prompt ? { text: node.prompt } : undefined,
    dependsOn: [...(edges.get(nodeId) ?? [])].map(id => `task:${taskRunId}:${id}`),
    status, criteria: spec.acceptance_criteria ? [spec.acceptance_criteria] : [],
    agentId: sessionId ? `session:${sessionId}` : undefined, authorityRef: `tasks/${spec.id}/runs/${taskRunId}` }
}
