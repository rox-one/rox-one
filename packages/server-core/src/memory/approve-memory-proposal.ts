import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getProjectMemoryPath, loadProjectById } from '@rox/shared/projects'
import { getWorkspaces } from '@rox/shared/config'
import { approveProposal, type MemoryProposal, type MemoryProposalScope } from '@rox/shared/memory/proposals'
import type { LessonOwner } from '@rox/shared/memory/types'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import { LessonStore, lessonKey, lessonOwnerKey, parseLessons } from './LessonStore'
import { MemoryFileStore } from './MemoryFileStore'
import { notifyRepoMutation, type RepoBankRef } from './repo/notify'
import { ownerKey8For } from './repo/RepoSourceProvider'
import type { MemoryProposalStore } from './MemoryProposalStore'

export interface DurableProposalApprovalInput {
  store: MemoryProposalStore
  workspaceRoot: string
  proposalId: string
  scope: MemoryProposalScope
  editedText?: string
  projectId?: string
  /** From the authenticated transport, never a renderer argument. */
  owner?: LessonOwner
  now?: Date
  /**
   * c1.8 test seam: invoked immediately after the durable write-intent is
   * persisted but before the canonical corpus write. Throwing here simulates a
   * crash mid-flush — the intent must survive and a later flush must recover it
   * without duplicating the corpus entry. Production never sets this.
   */
  faultAfterIntent?: () => void
}

function flushFile(path: string): void {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  if (process.platform !== 'win32') {
    const dir = openSync(dirname(path), 'r')
    try { fsyncSync(dir) } finally { closeSync(dir) }
  }
}

/** Repo bank a durable approval wrote into. `global` and `personal` both write
 * the global lessons file (`personal` only differs by owner) → `main#<owner8>`;
 * a workspace approval writes that workspace's lessons → `ws:<id>#<owner8>`.
 * `null` when a workspace-scope approval cannot be mapped to a workspace id — an
 * unresolvable root must not synthesise an invalid `ws:` bank id. */
function approvalBank(scope: MemoryProposalScope, workspaceRoot: string, owner?: LessonOwner): RepoBankRef | null {
  const ownerKey8 = owner ? ownerKey8For(owner) : undefined
  if (scope === 'global' || scope === 'personal') {
    return ownerKey8 ? { scope: 'main', ownerKey8 } : { scope: 'main' }
  }
  const workspaceId = getWorkspaces().find((workspace) => workspace.rootPath === workspaceRoot)?.id
  if (!workspaceId) return null
  return ownerKey8 ? { scope: 'workspace', workspaceId, ownerKey8 } : { scope: 'workspace', workspaceId }
}

/** Synchronous transaction: the pending write intent survives an interrupted approval.
 * A retry uses a target receipt/dedup key, never appends a second project rule. */
export function approveMemoryProposalDurably(input: DurableProposalApprovalInput): MemoryProposal | null {
  if (!['global', 'workspace', 'project', 'personal'].includes(input.scope)) throw new Error('Invalid memory target')
  if (input.scope === 'personal' && !input.owner) throw new Error('Personal memory requires an authenticated owner')
  const current = input.store.get(input.proposalId)
  if (!current) return null
  if (lessonOwnerKey(current.owner) !== lessonOwnerKey(input.owner)) throw new Error('Memory proposal owner access denied')
  if (current.status === 'rejected' || current.status === 'deleted') throw new Error('This memory proposal is no longer pending')
  const now = input.now ?? new Date()
  const prepared = approveProposal({ ...input, proposal: current, now })
  if (!prepared.lesson) throw new Error('Credential references require their credential store; no memory was written')
  const next = prepared.proposal
  const projectId = input.scope === 'project' ? next.projectId : undefined
  const hash = createHash('sha256').update(next.text).digest('hex')
  const ownerKey = lessonOwnerKey(input.owner)
  if (current.approval && (current.approval.scope !== input.scope
    || current.approval.projectId !== projectId || current.approval.textHash !== hash
    || lessonOwnerKey(current.approval.owner) !== ownerKey)) {
    throw new Error('Approval already started with a different target or text')
  }
  if (current.status.startsWith('approved_')) {
    if (current.approval?.writtenAt && current.approval.target) return current
    // Legacy approvals are retained without inventing an unverified receipt.
    throw new Error('Legacy approval has no durable write receipt')
  }

  let target: string
  let lessonStore: LessonStore | undefined
  if (input.scope === 'project') {
    const project = projectId ? loadProjectById(input.workspaceRoot, projectId) : null
    if (!project) throw new Error('Project memory target not found')
    target = getProjectMemoryPath(input.workspaceRoot, project.config.slug)
  } else {
    const lessonScope = input.scope === 'workspace' ? 'workspace' : 'global'
    lessonStore = new LessonStore(new MemoryFileStore(lessonScope, input.workspaceRoot).lessonsPath, lessonScope)
    target = lessonStore.filePath
  }
  const consentEventId = current.approval?.consentEventId ?? next.provenance.consentEventId!
  const approval = { scope: input.scope, projectId, ...(input.owner ? { owner: input.owner } : {}), consentEventId, textHash: hash }
  const pending = { ...next, status: 'pending' as const, approval }
  input.store.save(pending)
  // Crash seam: the write-intent is durable now; a throw here leaves the corpus
  // untouched but recoverable (flushMemoryWrites replays pendingWriteIntents).
  input.faultAfterIntent?.()

  if (input.scope === 'project') {
    const marker = `<!-- rox-memory-proposal:${createHash('sha256').update(`${current.id}\0${consentEventId}`).digest('hex')} -->`
    const line = next.text.replace(/[\r\n]+/g, ' ')
    const entry = `${marker}\n- ${line} (session ${next.sessionId}; consent ${consentEventId})\n`
    const content = existsSync(target) ? readFileSync(target, 'utf8') : ''
    if (!content.includes(marker)) {
      mkdirSync(dirname(target), { recursive: true })
      atomicWriteFileSync(target, `${content}\n${entry}`, { durable: true })
    } else flushFile(target)
    if (!readFileSync(target, 'utf8').includes(entry)) throw new Error('Project memory write could not be confirmed')
  } else {
    const stored = lessonStore!.listForOwner(input.owner).find(lesson => lesson.source.proposalId === current.id
      && lesson.source.consentEventId === consentEventId && lessonKey(lesson.rule) === lessonKey(next.text))
    if (!stored) lessonStore!.add({
      ts: next.updatedAt,
      rule: prepared.lesson.rule,
      category: prepared.lesson.category,
      scope: prepared.lesson.scope,
      ...(input.owner ? { owner: input.owner } : {}),
      source: { sessionId: next.sessionId, trigger: 'explicit', proposalId: current.id, consentEventId },
    }, 'user')
    flushFile(target)
    const confirmed = parseLessons(readFileSync(target, 'utf8')).some(lesson => lessonKey(lesson.rule) === lessonKey(next.text)
      && lessonOwnerKey(lesson.owner) === ownerKey && lesson.source.proposalId === current.id
      && lesson.source.consentEventId === consentEventId)
    if (!confirmed) throw new Error('Memory lesson write could not be confirmed')
  }
  const saved = input.store.save({ ...next, approval: { ...approval, target, writtenAt: now.toISOString() } })
  try {
    const bank = approvalBank(input.scope, input.workspaceRoot, input.owner)
    if (bank) notifyRepoMutation(bank, 'proposal-approve')
  } catch {
    // repo notification is best-effort; the durable write already landed
  }
  return saved
}
