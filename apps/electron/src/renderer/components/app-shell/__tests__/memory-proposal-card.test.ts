import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const dir = join(import.meta.dir, '..')

describe('Issue 13 memory proposal UI wiring', () => {
  it('renders compact blue proposal cards in chat and the memory review', () => {
    const card = readFileSync(join(dir, 'MemoryProposalCard.tsx'), 'utf-8')
    const chat = readFileSync(join(dir, 'ChatDisplay.tsx'), 'utf-8')
    const memory = readFileSync(join(dir, 'MemoryListPanel.tsx'), 'utf-8')
    expect(card).toContain("bg-info/10")
    expect(card).toContain("line-clamp-3")
    expect(card).toContain("approveMemoryProposal")
    expect(card).toContain("memory.proposal.approveProject")
    expect(card).toContain("memory.proposal.learn")
    expect(chat).toContain('SessionMemoryProposalLane')
    expect(memory).toContain('data-memory-proposal-review')
    expect(memory).toContain('MemoryProposalCard')
    expect(memory).toContain('PremiumMenuSelect')
    expect(memory).not.toContain('<select')
  })
})
