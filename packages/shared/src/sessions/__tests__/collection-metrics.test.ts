import { describe, expect, it } from 'bun:test'
import {
  countChildSessionsByParent,
  countGitCommits,
  countToolCalls,
  formatTranscriptSize,
  isGitCommitMessage,
} from '../collection-metrics.ts'

describe('countToolCalls', () => {
  it('counts tool-typed messages only', () => {
    expect(countToolCalls([
      { type: 'user' },
      { type: 'assistant' },
      { type: 'tool', toolName: 'Read' },
      { type: 'assistant', toolName: 'Bash' },
    ])).toBe(1)
  })
})

describe('countGitCommits', () => {
  it('counts git commit tools and bash git commit commands', () => {
    expect(countGitCommits([
      { type: 'tool', toolName: 'Read' },
      { type: 'tool', toolName: 'Bash', toolInput: { command: 'git commit -m "wip"' } },
      { type: 'tool', toolName: 'mcp__git__commit' },
    ])).toBe(2)
  })

  it('ignores non-commit bash', () => {
    expect(isGitCommitMessage({
      type: 'tool',
      toolName: 'Bash',
      toolInput: { command: 'git status' },
    })).toBe(false)
  })
})

describe('countChildSessionsByParent', () => {
  it('counts parallel children per parent id', () => {
    const counts = countChildSessionsByParent([
      { id: 'parent' },
      { id: 'a', parentSessionId: 'parent' },
      { id: 'b', parentSessionId: 'parent' },
      { id: 'c', parentSessionId: 'other' },
    ])
    expect(counts.get('parent')).toBe(2)
    expect(counts.get('other')).toBe(1)
    expect(counts.get('a')).toBeUndefined()
  })
})

describe('formatTranscriptSize', () => {
  it('formats missing, bytes, KB and MB', () => {
    expect(formatTranscriptSize(null)).toBe('—')
    expect(formatTranscriptSize(512)).toBe('512 B')
    expect(formatTranscriptSize(2048)).toBe('2.0 KB')
    expect(formatTranscriptSize(12_288)).toBe('12 KB')
    expect(formatTranscriptSize(2_097_152)).toBe('2.0 MB')
  })
})
