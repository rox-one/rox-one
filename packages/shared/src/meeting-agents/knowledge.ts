export type KnowledgeChangeKind = 'create' | 'update' | 'supersede'

export type KnowledgeRecord = {
  entityId: string
  title: string
  body: string
  revision: string
  properties: Record<string, string>
  supersededBy?: string
  private?: boolean
}

export type KnowledgeProposal = {
  kind: KnowledgeChangeKind
  entityId: string
  baseRevision: string
  properties: Record<string, string>
  status: 'proposed'
}

export type KnowledgeResult =
  | { status: 'ok'; proposal: KnowledgeProposal }
  | { status: 'conflict'; existingRevision: string }
  | { status: 'denied'; code: string }

export function proposeKnowledgeChange(input: {
  records: readonly KnowledgeRecord[]
  title: string
  body: string
  properties?: Record<string, string>
  baseRevision?: string
  readable?: boolean
  relatedPrivate?: boolean
}): KnowledgeResult {
  if (input.readable === false) return { status: 'denied', code: 'source-denied' }
  if (input.relatedPrivate) return { status: 'denied', code: 'private-source' }
  const existing = input.records.find((record) => record.title === input.title)
  if (!existing) {
    return {
      status: 'ok',
      proposal: {
        kind: 'create',
        entityId: `note:${input.title}`,
        baseRevision: '0',
        properties: input.properties ?? {},
        status: 'proposed',
      },
    }
  }
  if (input.baseRevision && input.baseRevision !== existing.revision) {
    return { status: 'conflict', existingRevision: existing.revision }
  }
  return {
    status: 'ok',
    proposal: {
      kind: existing.body === input.body ? 'update' : 'supersede',
      entityId: existing.entityId,
      baseRevision: existing.revision,
      properties: { ...existing.properties, ...(input.properties ?? {}) },
      status: 'proposed',
    },
  }
}
