import { PERMISSION_MODE_ORDER, type PermissionMode } from '../agent/mode-types.ts'
import { topologicalOrder } from './graph.ts'
import { isExecutableNodeKind, portCompatible, type CanvasEdge, type CanvasNode, type SessionWorkflowSpec } from './types.ts'

export type WorkflowIssue = {
  path: string
  message: string
}

export type WorkflowValidation = {
  valid: boolean
  errors: WorkflowIssue[]
}

function portById(node: CanvasNode, portId: string | undefined, direction: 'in' | 'out') {
  const ports = direction === 'in' ? node.inputs : node.outputs
  if (portId) return ports.find((port) => port.id === portId || port.name === portId)
  return ports[0]
}

export function validateWorkflowSpec(spec: SessionWorkflowSpec): WorkflowValidation {
  const errors: WorkflowIssue[] = []
  const byId = new Map(spec.nodes.map((node) => [node.id, node]))
  const allowed = new Set<PermissionMode>(PERMISSION_MODE_ORDER)

  if (!allowed.has(spec.defaults.permissionMode)) {
    errors.push({ path: 'defaults.permissionMode', message: 'Unknown permission mode' })
  }

  for (const node of spec.nodes) {
    if (isExecutableNodeKind(node.kind)) {
      const mode = node.permissionMode ?? spec.defaults.permissionMode
      if (!allowed.has(mode)) {
        errors.push({ path: `nodes.${node.id}.permissionMode`, message: `Node "${node.id}" has an invalid permission mode` })
      }
    }
  }

  for (const edge of spec.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) {
      errors.push({ path: `edges.${edge.id}`, message: `Edge "${edge.id}" points at an unknown node` })
      continue
    }
    if (edge.source === edge.target) {
      errors.push({ path: `edges.${edge.id}`, message: `Edge "${edge.id}" is a self-loop` })
      continue
    }
    const outPort = portById(source, edge.sourcePort, 'out')
    const inPort = portById(target, edge.targetPort, 'in')
    if (!outPort) {
      errors.push({ path: `edges.${edge.id}`, message: `Source port missing on "${edge.source}"` })
      continue
    }
    if (!inPort) {
      errors.push({ path: `edges.${edge.id}`, message: `Target port missing on "${edge.target}"` })
      continue
    }
    const traceEdge = Boolean(source.provenance && target.provenance)
    if (!traceEdge && !portCompatible(outPort.kind, inPort.kind)) {
      errors.push({
        path: `edges.${edge.id}`,
        message: `Port kind ${outPort.kind} cannot connect to ${inPort.kind}`,
      })
    }
  }

  if (topologicalOrder(spec.nodes, spec.edges) === null) {
    errors.push({ path: 'edges', message: 'Workflow contains a cycle' })
  }

  const incoming = incomingByTarget(spec.edges)
  for (const node of spec.nodes) {
    for (const input of node.inputs) {
      if (!input.required) continue
      const hits = incoming.get(node.id) ?? []
      const connected = hits.some((edge) => {
        const port = portById(node, edge.targetPort, 'in')
        return port?.id === input.id || port?.name === input.name
      })
      if (!connected && node.kind !== 'annotation_frame' && !node.provenance) {
        errors.push({ path: `nodes.${node.id}.inputs.${input.name}`, message: `Required input "${input.name}" is not connected` })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

function incomingByTarget(edges: readonly CanvasEdge[]): Map<string, CanvasEdge[]> {
  const map = new Map<string, CanvasEdge[]>()
  for (const edge of edges) {
    const list = map.get(edge.target) ?? []
    list.push(edge)
    map.set(edge.target, list)
  }
  return map
}

export function canConnect(spec: SessionWorkflowSpec, edge: CanvasEdge): boolean {
  return validateWorkflowSpec({
    ...spec,
    edges: [...spec.edges, edge],
  }).valid
}
