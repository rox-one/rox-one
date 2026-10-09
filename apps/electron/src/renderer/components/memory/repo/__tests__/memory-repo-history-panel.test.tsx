/**
 * A6 — MemoryRepoHistoryPanel: empty / data / commit-not-found states, the
 * snapshots banner, commit selection and the added/modified/deleted diff.
 */
import { setupEntityTestEnv, mount, resetDom, flush, i18n } from '../../../entities/__tests__/test-env'
import { afterEach, describe, expect, it } from 'bun:test'
import type { MemoryRepoCommit, MemoryRepoCommitFile } from '@rox/shared/memory/repo'
import { MemoryRepoHistoryPanel, formatCommitTime, shortSha } from '../MemoryRepoHistoryPanel'

setupEntityTestEnv()

afterEach(() => resetDom())

const COMMIT: MemoryRepoCommit = {
  sha: '9f8e7d6c5b4a39281706',
  parent: null,
  message: 'memory(main): dream — +2/-1',
  ts: '2026-10-09T08:00:00.000Z',
  files: [],
  stats: { added: 2, modified: 0, deleted: 1 },
}

const DIFF: MemoryRepoCommitFile[] = [
  { path: 'lessons/workflow/new--aa.md', op: 'added', additions: 12, deletions: 0 },
  { path: 'MEMORY.md', op: 'modified', additions: 3, deletions: 2 },
  { path: 'lessons/old--bb.md', op: 'deleted', additions: 0, deletions: 7 },
]

describe('MemoryRepoHistoryPanel', () => {
  it('renders the empty state when there are no commits', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[]} selectedSha={null} onSelect={() => {}} diff={[]} loading={false} mode="git" />,
    )
    expect(container.querySelector('[data-testid="memory-repo-history-empty"]')).not.toBeNull()
    expect(container.textContent).toContain(i18n.t('memory.repo.history.empty'))
    await unmount()
  })

  it('renders the loading state', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[]} selectedSha={null} onSelect={() => {}} diff={[]} loading mode="git" />,
    )
    expect(container.querySelector('[data-testid="memory-repo-history-loading"]')).not.toBeNull()
    await unmount()
  })

  it('shows the snapshots banner in snapshots mode', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[COMMIT]} selectedSha={COMMIT.sha} onSelect={() => {}} diff={DIFF} loading={false} mode="snapshots" />,
    )
    const banner = container.querySelector('[data-testid="memory-repo-history-snapshots"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain(i18n.t('memory.repo.history.snapshots'))
    await unmount()
  })

  it('renders the commit list with short sha, +N/−M and selects on click', async () => {
    const seen: string[] = []
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[COMMIT]} selectedSha={null} onSelect={(sha) => seen.push(sha)} diff={[]} loading={false} mode="git" />,
    )
    const row = container.querySelector<HTMLButtonElement>(`[data-testid="memory-repo-commit-${COMMIT.sha}"]`)
    expect(row?.textContent).toContain(shortSha(COMMIT.sha))
    expect(row?.textContent).toContain('+2')
    expect(row?.textContent).toContain('−1')
    row?.click()
    await flush()
    expect(seen).toEqual([COMMIT.sha])
    await unmount()
  })

  it('renders added/modified/deleted ops for the selected commit', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[COMMIT]} selectedSha={COMMIT.sha} onSelect={() => {}} diff={DIFF} loading={false} mode="git" />,
    )
    expect(container.querySelector('[data-testid="memory-repo-history-diff"]')).not.toBeNull()
    for (const op of ['added', 'modified', 'deleted'] as const) {
      const badge = container.querySelector(`[data-testid="memory-repo-diff-op-${op}"]`)
      expect(badge).not.toBeNull()
      expect(badge?.textContent).toContain(i18n.t(`memory.repo.history.op.${op}`))
    }
    expect(container.querySelectorAll('[data-testid="memory-repo-diff-op-added"]').length).toBe(1)
    await unmount()
  })

  it('renders the commit-not-found state for a missing selection', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[]} selectedSha="deadbeef" onSelect={() => {}} diff={[]} loading={false} mode="git" />,
    )
    const alert = container.querySelector('[data-testid="memory-repo-history-no-changes"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain(i18n.t('memory.repo.state.commitNotFound'))
    await unmount()
  })

  it('renders the no-changes state for a commit with an empty diff', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[COMMIT]} selectedSha={COMMIT.sha} onSelect={() => {}} diff={[]} loading={false} mode="git" />,
    )
    const alert = container.querySelector('[data-testid="memory-repo-history-no-changes"]')
    expect(alert?.textContent).toContain(i18n.t('memory.repo.history.noChanges'))
    await unmount()
  })

  it('renders the diff for a sha outside the commits window instead of not-found', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[]} selectedSha="0123456789abcdef" onSelect={() => {}} diff={DIFF} loading={false} mode="git" />,
    )
    expect(container.querySelector('[data-testid="memory-repo-history-diff"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-history-no-changes"]')).toBeNull()
    expect(container.textContent).not.toContain(i18n.t('memory.repo.state.commitNotFound'))
    await unmount()
  })

  it('keeps the commit-not-found alert for an unknown sha with no diff', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoHistoryPanel bankId="main" commits={[COMMIT]} selectedSha="deadbeefdeadbeef" onSelect={() => {}} diff={[]} loading={false} mode="git" />,
    )
    const alert = container.querySelector('[data-testid="memory-repo-history-no-changes"]')
    expect(alert?.textContent).toContain(i18n.t('memory.repo.state.commitNotFound'))
    await unmount()
  })
})

describe('MemoryRepoHistoryPanel helpers', () => {
  it('formats commit time as stable UTC minute precision', () => {
    expect(formatCommitTime('2026-10-09T08:00:00.000Z')).toBe('2026-10-09 08:00')
  })

  it('shortens shas to seven characters', () => {
    expect(shortSha(COMMIT.sha)).toBe('9f8e7d6')
  })
})
