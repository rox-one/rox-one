import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MeetingProposal } from '@craft-agent/core/meetings'
import { parseProposal } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'

export type ProposalStore = {
  items: MeetingProposal[]
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export type CreateProposalResult =
  | { ok: true; proposal: MeetingProposal }
  | { ok: false; code: string }

function isNativeProposalType(type: MeetingProposal['type']): boolean {
  return type === 'create_task' || type === 'create_note'
}

export function proposalIdFor(meetingId: string, payload: Record<string, unknown>): string {
  return `prop-${meetingId}-${payloadHash(payload).slice(0, 12)}`
}

export function createMeetingProposal(input: {
  store: ProposalStore
  actorId: string
  grant: MeetingGrant | null
  workspaceId: string
  meetingId: string
  type: MeetingProposal['type']
  payload: Record<string, unknown>
  id?: string
}): CreateProposalResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.workspaceId || !input.meetingId) return { ok: false, code: 'bad-ids' }
  if (!isNativeProposalType(input.type)) return { ok: false, code: 'unsupported-native-kind' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'send',
    operation: 'propose',
  })
  if (!auth.ok) return { ok: false, code: auth.code }
  const hash = payloadHash(input.payload)
  const id = input.id && input.id.length > 0 ? input.id : proposalIdFor(input.meetingId, input.payload)
  const existing = input.store.items.find((item) => item.id === id)
  if (existing) {
    if (existing.payloadHash === hash && existing.workspaceId === input.workspaceId) {
      return { ok: true, proposal: existing }
    }
    return { ok: false, code: 'payload-conflict' }
  }
  const proposal: MeetingProposal = {
    id,
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    type: input.type,
    payload: input.payload,
    payloadHash: hash,
    status: 'proposed',
    sourceSpans: [],
    baseRevisions: {},
  }
  input.store.items.push(proposal)
  return { ok: true, proposal }
}

export function loadProposalStore(persistRootDir: string): ProposalStore {
  const path = join(persistRootDir, 'proposals.json')
  if (!existsSync(path)) return { items: [] }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !Array.isArray((parsed as { items?: unknown }).items)) {
      return { items: [] }
    }
    const items: MeetingProposal[] = []
    for (const raw of (parsed as { items: unknown[] }).items) {
      const next = parseProposal(raw)
      if ('reason' in next) continue
      items.push(next)
    }
    return { items }
  } catch {
    return { items: [] }
  }
}

export function saveProposalStore(persistRootDir: string, store: ProposalStore): void {
  mkdirSync(persistRootDir, { recursive: true })
  const target = join(persistRootDir, 'proposals.json')
  const tmp = join(persistRootDir, `.proposals.${process.pid}.tmp`)
  writeFileSync(tmp, `${JSON.stringify({ items: store.items })}\n`)
  renameSync(tmp, target)
}

export function approveMeetingProposal(input: {
  store: ProposalStore
  proposalId: string
  actorId: string
  grant: MeetingGrant | null
  payload: Record<string, unknown>
  now?: number
}): MeetingProposal {
  const proposal = input.store.items.find((item) => item.id === input.proposalId)
  if (!proposal) throw new Error('proposal not found')
  if (proposal.status === 'rejected') throw new Error('rejected')
  if (proposal.status === 'approved' || proposal.status === 'applied') return proposal
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: proposal.workspaceId,
    deviceId: input.grant?.deviceId ?? '',
    capability: 'send',
    operation: 'approve',
    payloadHash: payloadHash(input.payload),
    now: input.now,
  })
  if (!auth.ok) throw new Error(auth.code)
  const hash = payloadHash(input.payload)
  if (hash !== proposal.payloadHash) throw new Error('payload-changed')
  proposal.status = 'approved'
  proposal.approvedAt = input.now
  proposal.approvedBy = input.actorId
  proposal.approvedPayloadHash = hash
  return proposal
}

export function rejectMeetingProposal(store: ProposalStore, proposalId: string): MeetingProposal {
  const proposal = store.items.find((item) => item.id === proposalId)
  if (!proposal) throw new Error('proposal not found')
  proposal.status = 'rejected'
  return proposal
}

export function editMeetingProposal(store: ProposalStore, proposalId: string, payload: Record<string, unknown>): MeetingProposal {
  const proposal = store.items.find((item) => item.id === proposalId)
  if (!proposal) throw new Error('proposal not found')
  if (proposal.status === 'approved') proposal.status = 'stale'
  proposal.payload = payload
  proposal.payloadHash = payloadHash(payload)
  return proposal
}
