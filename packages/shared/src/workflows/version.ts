import { cloneSpec, createDraftSpec, fingerprintSpec, mintId } from './graph.ts'
import type { SessionWorkflowDocument, SessionWorkflowSpec, WorkflowRun } from './types.ts'
import { validateWorkflowSpec } from './validate.ts'

export const workflowDocumentStorageKey = (sessionId: string) => `rox.sessionMap.workflow.${sessionId}`

export function createWorkflowDocument(sessionId: string, now = Date.now()): SessionWorkflowDocument {
  return {
    v: 2,
    sessionId,
    draft: createDraftSpec(sessionId, now),
    versions: [],
    runs: [],
  }
}

export function saveVersion(document: SessionWorkflowDocument, now = Date.now()): SessionWorkflowDocument {
  const validation = validateWorkflowSpec(document.draft)
  if (!validation.valid) {
    const detail = validation.errors.map((issue) => issue.message).join('; ')
    throw new Error(`Cannot save invalid WorkflowSpec: ${detail}`)
  }
  const existing = document.versions.find((version) => fingerprintSpec(version) === fingerprintSpec(document.draft))
  if (existing) {
    return { ...document, draft: cloneSpec(document.draft, { versionId: existing.versionId, parentVersionId: existing.parentVersionId }) }
  }
  const version = cloneSpec(document.draft, {
    versionId: mintId('ver', now),
    createdAt: now,
  })
  return {
    ...document,
    draft: cloneSpec(document.draft, { versionId: version.versionId, parentVersionId: version.parentVersionId }),
    versions: [...document.versions, version],
  }
}

export function forkVersion(document: SessionWorkflowDocument, versionId: string, now = Date.now()): SessionWorkflowDocument {
  const version = document.versions.find((item) => item.versionId === versionId)
  if (!version) throw new Error(`Unknown WorkflowSpec version ${versionId}`)
  return {
    ...document,
    draft: cloneSpec(version, {
      versionId: mintId('ver', now),
      parentVersionId: version.versionId,
      createdAt: now,
    }),
  }
}

export type SpecDiff = {
  addedNodes: string[]
  removedNodes: string[]
  changedNodes: string[]
  addedEdges: string[]
  removedEdges: string[]
}

export function compareVersions(a: SessionWorkflowSpec, b: SessionWorkflowSpec): SpecDiff {
  const aNodes = new Map(a.nodes.map((node) => [node.id, node]))
  const bNodes = new Map(b.nodes.map((node) => [node.id, node]))
  const addedNodes = [...bNodes.keys()].filter((id) => !aNodes.has(id))
  const removedNodes = [...aNodes.keys()].filter((id) => !bNodes.has(id))
  const changedNodes = [...aNodes.keys()].filter((id) => {
    const left = aNodes.get(id)
    const right = bNodes.get(id)
    if (!left || !right) return false
    return left.kind !== right.kind || left.title !== right.title
  })
  const aEdges = new Set(a.edges.map((edge) => `${edge.source}->${edge.target}`))
  const bEdges = new Set(b.edges.map((edge) => `${edge.source}->${edge.target}`))
  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges: [...bEdges].filter((id) => !aEdges.has(id)),
    removedEdges: [...aEdges].filter((id) => !bEdges.has(id)),
  }
}

export function exportSpec(spec: SessionWorkflowSpec): string {
  return JSON.stringify(spec)
}

export function importSpec(raw: string, sessionId: string): SessionWorkflowSpec {
  const parsed = JSON.parse(raw) as SessionWorkflowSpec
  if (parsed.v !== 2 || parsed.sessionId !== sessionId || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('Invalid WorkflowSpec payload')
  }
  const validation = validateWorkflowSpec(parsed)
  if (!validation.valid) {
    throw new Error(`Invalid WorkflowSpec: ${validation.errors.map((issue) => issue.message).join('; ')}`)
  }
  return parsed
}

export function recordRun(document: SessionWorkflowDocument, run: WorkflowRun): SessionWorkflowDocument {
  return { ...document, runs: [...document.runs, run] }
}

export function parseWorkflowDocument(raw: string | null, sessionId: string): SessionWorkflowDocument {
  if (!raw) return createWorkflowDocument(sessionId)
  try {
    const parsed = JSON.parse(raw) as SessionWorkflowDocument
    if (parsed.v !== 2 || parsed.sessionId !== sessionId || !parsed.draft) {
      return createWorkflowDocument(sessionId)
    }
    return {
      v: 2,
      sessionId,
      draft: parsed.draft,
      versions: Array.isArray(parsed.versions) ? parsed.versions : [],
      runs: (Array.isArray(parsed.runs) ? parsed.runs : []).map((run) => ({
        ...run,
        evidence: 'simulated',
      })),
    }
  } catch {
    return createWorkflowDocument(sessionId)
  }
}

export function serializeWorkflowDocument(document: SessionWorkflowDocument): string {
  return JSON.stringify(document)
}
