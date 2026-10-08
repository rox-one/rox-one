import type { RuntimeNode, RuntimeEvent, RuntimeContent } from '@rox/core/runtime-trace'
import type { TFunction } from 'i18next'
import { safePreview } from '../measurements'
import { isLearningNodeKind, learningNodeLabel } from '../learning-nodes'

export function firstEvent<K extends RuntimeEvent['kind']>(node: RuntimeNode, kind: K): Extract<RuntimeEvent, { kind: K }> | undefined {
  return node.events.find(event => event.kind === kind) as Extract<RuntimeEvent, { kind: K }> | undefined
}

/**
 * PRD §30 learning kinds have no `runtimeMap.kind.*` locale entry, so the
 * registry label is the fallback; every other kind keeps its translated label.
 */
export function kindLabel(kind: string, t: TFunction): string {
  return t(`runtimeMap.kind.${kind}`, { defaultValue: isLearningNodeKind(kind) ? learningNodeLabel(kind) : kind })
}

/** Canvas aria label for a rendered node, learning kinds included. */
export function nodeAriaLabel(node: { kind: string; seq: number }, t: TFunction): string {
  return t('runtimeMap.eventAria', { type: kindLabel(node.kind, t), sequence: node.seq })
}

export function nodeContent(node: RuntimeNode): RuntimeContent | undefined {
  if (node.content) return node.content
  const event = node.event
  switch (event.kind) {
    case 'run.accepted': return event.payload.prompt
    case 'context.captured': case 'context.changed': return event.payload.snapshot.effectivePrompt
    case 'tool.started': return event.payload.input
    case 'tool.output': case 'tool.completed': return event.payload.result
    case 'terminal.started': return { text: event.payload.command }
    case 'terminal.output': case 'terminal.completed': return event.payload.stdout
    case 'agent.assigned': return event.payload.assignment.task
    case 'agent.completed': return event.payload.result
    case 'skill.selected': case 'skill.loaded': case 'skill.applied': return event.payload.content
    case 'result.published': case 'reasoning.output': case 'decision.recorded': return event.payload.content
    case 'memory.retrieved': case 'memory.included': case 'memory.proposed': case 'memory.committed': return event.payload.content
    case 'plan.published': case 'plan.revised': return event.payload.plan.content
    case 'task.state-changed': return event.payload.task.description
    case 'artifact.created': return event.payload.artifact.content
    default: return undefined
  }
}

export function nodeTitle(node: RuntimeNode, t: TFunction): string {
  const event = node.event
  switch (event.kind) {
    case 'tool.started': case 'tool.output': case 'tool.completed': return safePreview(event.payload.name, 80)
    case 'terminal.started': case 'terminal.output': case 'terminal.completed': return t('runtimeMap.kind.terminal')
    case 'agent.assigned': return safePreview(event.payload.assignment.name, 80)
    case 'agent.started': case 'agent.completed': return safePreview(firstEvent(node, 'agent.assigned')?.payload.assignment.name || (event.kind === 'agent.started' ? event.payload.name : undefined), 80) || t('runtimeMap.kind.agent')
    case 'skill.selected': case 'skill.loaded': case 'skill.applied': return safePreview(event.payload.capability.label, 80)
    case 'plan.published': case 'plan.revised': return safePreview(event.payload.plan.title, 80) || t('runtimeMap.kind.plan')
    case 'task.state-changed': return safePreview(event.payload.task.title, 80)
    case 'acceptance.started': case 'acceptance.completed': return safePreview(event.payload.acceptance.criterion, 80)
    case 'artifact.created': return safePreview(event.payload.artifact.label, 80)
    case 'model.confirmed': case 'model.changed': return event.payload.model.confirmed.state === 'known' ? safePreview(event.payload.model.confirmed.value, 80) : t('runtimeMap.kind.model')
    default: return t(`runtimeMap.kind.${node.kind}`, { defaultValue: isLearningNodeKind(node.kind) ? learningNodeLabel(node.kind) : event.kind })
  }
}

export function nodeSubtitle(node: RuntimeNode, t: TFunction): string {
  const event = node.event
  switch (event.kind) {
    case 'context.captured': case 'context.changed': return t('runtimeMap.contextVersion', { version: event.payload.snapshot.version, count: event.payload.snapshot.blocks.length })
    case 'plan.published': case 'plan.revised': return t('runtimeMap.planVersion', { version: event.payload.plan.version, count: event.payload.plan.tasks.length })
    case 'skill.selected': return t('runtimeMap.skill.selected')
    case 'skill.loaded': return t('runtimeMap.skill.loaded')
    case 'skill.applied': return t('runtimeMap.skill.applied')
    case 'reasoning.output': return t(`runtimeMap.provenance.${event.payload.provenance}`)
    case 'decision.recorded': return t(`runtimeMap.provenance.${event.payload.provenance}`)
    case 'run.accepted': return t(`runtimeMap.launch.${event.payload.launch.kind}`)
    case 'approval.requested': return safePreview(event.payload.description)
    case 'trace.gap': return t('runtimeMap.gap', { from: event.payload.fromSeq, to: event.payload.toSeq ?? '…' })
    case 'agent.assigned': return safePreview(event.payload.assignment.task.text)
    case 'memory.retrieved': case 'memory.included': case 'memory.proposed': case 'memory.committed': return t(`runtimeMap.memoryState.${event.kind.split('.')[1]}`)
    case 'run.completed': case 'run.interrupted': return safePreview(event.payload.reason)
    case 'approval.resolved': return t(event.payload.approved ? 'runtimeMap.permissionGranted' : 'runtimeMap.permissionDenied')
    case 'operation.queued': return safePreview(event.payload.description)
    case 'attempt.started': case 'attempt.completed': return safePreview(event.payload.description)
    case 'terminal.started': case 'terminal.output': case 'terminal.completed': return safePreview(event.payload.command)
    case 'acceptance.started': case 'acceptance.completed': return t(`runtimeMap.acceptance.${event.payload.acceptance.status}`)
    default: return safePreview(nodeContent(node)?.text)
  }
}
