/**
 * JSONL store for session-learning memory proposals.
 * Fail-soft: corrupt lines are skipped. Never stores secret material.
 */
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { MemoryProposal } from '@rox/shared/memory/proposals'
import { redactProposalSecrets } from '@rox/shared/memory/proposals'
import { atomicWriteFileSync } from '@rox/shared/utils/files'

export class MemoryProposalStore {
  readonly filePath: string

  constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'proposals.jsonl')
  }

  list(): MemoryProposal[] {
    if (!existsSync(this.filePath)) return []
    const content = readFileSync(this.filePath, 'utf-8')
    const out: MemoryProposal[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as MemoryProposal
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && typeof parsed.text === 'string') {
          parsed.text = redactProposalSecrets(parsed.text)
          out.push(parsed)
        }
      } catch {
        // skip corrupt line
      }
    }
    return out
  }

  get(id: string): MemoryProposal | null {
    return this.list().find((p) => p.id === id) ?? null
  }

  /**
   * c1.8 flush turn: proposals carrying a durable approval write-intent that
   * has not been confirmed (`approval` present but no `writtenAt`) — i.e. a
   * crash caught the approval between persisting the intent and the canonical
   * corpus write. Deterministic id order so a flush replays the same way every
   * time. Re-running on already-confirmed proposals is a no-op.
   */
  pendingWriteIntents(): MemoryProposal[] {
    return this.list()
      .filter((p) => p.status === 'pending' && p.approval != null && p.approval.writtenAt == null)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  save(proposal: MemoryProposal): MemoryProposal {
    const sanitized: MemoryProposal = {
      ...proposal,
      text: redactProposalSecrets(proposal.text),
    }
    const items = this.list()
    const index = items.findIndex((p) => p.id === sanitized.id)
    if (index >= 0) items[index] = sanitized
    else items.push(sanitized)
    this.rewrite(items)
    return sanitized
  }

  saveMany(proposals: MemoryProposal[]): MemoryProposal[] {
    const items = this.list()
    for (const proposal of proposals) {
      const sanitized: MemoryProposal = { ...proposal, text: redactProposalSecrets(proposal.text) }
      const index = items.findIndex((p) => p.id === sanitized.id)
      if (index >= 0) items[index] = sanitized
      else items.push(sanitized)
    }
    this.rewrite(items)
    return proposals
  }

  private rewrite(items: MemoryProposal[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    atomicWriteFileSync(this.filePath, items.map((p) => JSON.stringify(p)).join('\n') + (items.length ? '\n' : ''), { durable: true })
  }
}
