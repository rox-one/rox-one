/**
 * A6 — MemoryRepoFilesPanel: empty / data / not-found states, tree badges,
 * frontmatter table, and wikilink → `onSelect` mapping. Pure props only.
 */
import { setupEntityTestEnv, mount, resetDom, flush, i18n } from '../../../entities/__tests__/test-env'
import { afterEach, describe, expect, it } from 'bun:test'
import type { MemoryRepoFile, MemoryRepoTreeNode } from '@rox/shared/memory/repo'
import {
  MemoryRepoFilesPanel,
  linkifyWikilinks,
  parseFrontmatter,
  repoPathFromWikilink,
} from '../MemoryRepoFilesPanel'

setupEntityTestEnv()

afterEach(() => resetDom())

const FILE_NODE = (path: string, name: string, badges?: MemoryRepoTreeNode['badges']): MemoryRepoTreeNode => ({
  path,
  name,
  type: 'file',
  depth: 2,
  badges,
})

const DIR_NODE: MemoryRepoTreeNode = { path: 'lessons/workflow', name: 'workflow', type: 'dir', depth: 1 }

const FILE: MemoryRepoFile = {
  path: 'lessons/workflow/rule--deadbeef.md',
  content: '---\nid: workspace:abc\ncategory: workflow\ntags: [release, ci]\n---\n## Правило\nСмотри [[lessons/workflow/rule--deadbeef|правило]].\n',
  truncated: false,
  edited: false,
}

describe('MemoryRepoFilesPanel', () => {
  it('renders the empty state when the tree has no files', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[]} selectedPath={null} onSelect={() => {}} file={null} loading={false} />,
    )
    expect(container.querySelector('[data-testid="memory-repo-files-empty"]')).not.toBeNull()
    expect(container.textContent).toContain(i18n.t('memory.repo.state.empty'))
    await unmount()
  })

  it('renders the loading state', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[FILE_NODE('a.md', 'a.md')]} selectedPath={null} onSelect={() => {}} file={null} loading />,
    )
    expect(container.querySelector('[data-testid="memory-repo-files-loading"]')).not.toBeNull()
    await unmount()
  })

  it('shows the tree loading row (not the empty card) while the tree loads', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[]} selectedPath={null} onSelect={() => {}} file={null} loading />,
    )
    expect(container.querySelector('[data-testid="memory-repo-tree-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-tree-loading"]')?.textContent).toContain(i18n.t('memory.repo.state.loading'))
    expect(container.querySelector('[data-testid="memory-repo-files-empty"]')).toBeNull()
    await unmount()
  })

  it('treats a file from a previous selection as loading, not stale content or not-found', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel
        bankId="main"
        tree={[FILE_NODE('b.md', 'b.md')]}
        selectedPath="b.md"
        onSelect={() => {}}
        file={{ ...FILE, path: 'a.md' }}
        loading={false}
      />,
    )
    expect(container.querySelector('[data-testid="memory-repo-files-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-file-viewer"]')).toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-files-not-found"]')).toBeNull()
    await unmount()
  })

  it('shows loading (not not-found) while the selected file read is in flight', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel
        bankId="main"
        tree={[FILE_NODE('b.md', 'b.md')]}
        selectedPath="b.md"
        onSelect={() => {}}
        file={null}
        loading={false}
        fileLoading
      />,
    )
    expect(container.querySelector('[data-testid="memory-repo-files-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-files-not-found"]')).toBeNull()
    await unmount()
  })

  it('renders the data state with a frontmatter table', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[DIR_NODE]} selectedPath={FILE.path} onSelect={() => {}} file={FILE} loading={false} />,
    )
    expect(container.querySelector('[data-testid="memory-repo-files-empty"]')).toBeNull()
    const table = container.querySelector('[data-testid="memory-repo-files-frontmatter"]')
    expect(table).not.toBeNull()
    expect(table?.textContent).toContain('category')
    expect(table?.textContent).toContain('workflow')
    expect(container.querySelector('[data-testid="memory-repo-files-edited-notice"]')).toBeNull()
    await unmount()
  })

  it('shows the edited badge only on flagged nodes and the edited notice only when flagged', async () => {
    const tree = [FILE_NODE('a.md', 'a.md', ['edited']), FILE_NODE('b.md', 'b.md')]
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={tree} selectedPath="a.md" onSelect={() => {}} file={{ ...FILE, path: 'a.md', edited: true }} loading={false} />,
    )
    const treeEl = container.querySelector('[data-testid="memory-repo-files-tree"]')
    expect(treeEl?.querySelectorAll('[data-testid="memory-repo-badge-edited"]').length).toBe(1)
    expect(container.querySelector('[data-testid="memory-repo-files-edited-notice"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-files-truncated"]')).toBeNull()
    await unmount()
  })

  it('renders the truncation notice', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[FILE_NODE('a.md', 'a.md')]} selectedPath="a.md" onSelect={() => {}} file={{ ...FILE, path: 'a.md', truncated: true }} loading={false} />,
    )
    expect(container.querySelector('[data-testid="memory-repo-files-truncated"]')).not.toBeNull()
    await unmount()
  })

  it('renders the not-found state for a selected path without content', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[FILE_NODE('a.md', 'a.md')]} selectedPath="missing.md" onSelect={() => {}} file={null} loading={false} />,
    )
    const alert = container.querySelector('[data-testid="memory-repo-files-not-found"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain(i18n.t('memory.repo.state.fileNotFound'))
    await unmount()
  })

  it('calls onSelect(filename) when a tree row is clicked', async () => {
    const seen: string[] = []
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[FILE_NODE('lessons/x.md', 'x.md')]} selectedPath={null} onSelect={(path) => seen.push(path)} file={null} loading={false} />,
    )
    const row = container.querySelector<HTMLButtonElement>('[data-testid="memory-repo-file-lessons/x.md"]')
    row?.click()
    await flush()
    expect(seen).toEqual(['lessons/x.md'])
    await unmount()
  })

  it('maps a clicked [[wikilink]] to the repo lesson path', async () => {
    const seen: string[] = []
    const { container, unmount } = await mount(
      <MemoryRepoFilesPanel bankId="main" tree={[FILE_NODE('lessons/workflow/rule--deadbeef.md', 'rule--deadbeef.md')]} selectedPath={FILE.path} onSelect={(path) => seen.push(path)} file={FILE} loading={false} />,
    )
    const anchors = Array.from(container.querySelectorAll('a'))
    const link = anchors.find((anchor) => anchor.textContent?.includes('правило'))
    expect(link).toBeDefined()
    link?.click()
    await flush()
    expect(seen).toEqual(['lessons/workflow/rule--deadbeef.md'])
    await unmount()
  })
})

describe('MemoryRepoFilesPanel helpers', () => {
  it('linkifyWikilinks rewrites mentions (and not embeds / fenced code)', () => {
    expect(linkifyWikilinks('see [[lessons/a|A]]')).toBe('see [A](lessons/a)')
    expect(linkifyWikilinks('embed ![[x]] stays')).toBe('embed ![[x]] stays')
    expect(linkifyWikilinks('```\n[[lessons/a]]\n```')).toBe('```\n[[lessons/a]]\n```')
  })

  it('repoPathFromWikilink appends .md to extensionless targets', () => {
    expect(repoPathFromWikilink('lessons/workflow/rule--abc')).toBe('lessons/workflow/rule--abc.md')
    expect(repoPathFromWikilink('MEMORY.md')).toBe('MEMORY.md')
    expect(repoPathFromWikilink('lessons/x#frag')).toBe('lessons/x.md')
  })

  it('parseFrontmatter flattens nested keys and returns the body', () => {
    const parsed = parseFrontmatter('---\nid: "w:1"\nsource:\n  trigger: distillation\n  session: s1\ntags: [a, b]\n---\n# Body\n')
    expect(parsed.body).toBe('# Body\n')
    expect(parsed.entries).toEqual([
      { key: 'id', value: 'w:1' },
      { key: 'source.trigger', value: 'distillation' },
      { key: 'source.session', value: 's1' },
      { key: 'tags', value: '[a, b]' },
    ])
  })
})
