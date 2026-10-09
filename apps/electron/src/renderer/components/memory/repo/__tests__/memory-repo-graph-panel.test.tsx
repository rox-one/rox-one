/**
 * A6 — MemoryRepoGraphPanel: empty state, legend, node → onOpenFile.
 */
import { setupEntityTestEnv, mount, resetDom, flush, i18n } from '../../../entities/__tests__/test-env'
import { afterEach, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { MemoryRepoGraph } from '@rox/shared/memory/repo'
import {
  MemoryGraphNodeButton,
  MemoryRepoGraphLegend,
  MemoryRepoGraphPanel,
  graphGridPosition,
  openGraphNode,
} from '../MemoryRepoGraphPanel'

setupEntityTestEnv()

afterEach(() => resetDom())

const GRAPH: MemoryRepoGraph = {
  nodes: [
    { id: 'n1', kind: 'lesson', label: 'Никогда не мержить', path: 'lessons/workflow/rule--abc.md' },
    { id: 'n2', kind: 'topic', label: 'release' },
  ],
  edges: [
    { from: 'n1', to: 'n2', kind: 'cluster' },
    { from: 'n1', to: 'missing', kind: 'wikilink' },
  ],
}

describe('MemoryRepoGraphPanel', () => {
  it('renders the empty state for a null graph', async () => {
    const { container, unmount } = await mount(<MemoryRepoGraphPanel graph={null} onOpenFile={() => {}} />)
    expect(container.querySelector('[data-testid="memory-repo-graph-empty"]')).not.toBeNull()
    expect(container.textContent).toContain(i18n.t('memory.repo.graph.empty'))
    await unmount()
  })

  it('renders the empty state for a graph without nodes', async () => {
    const { container, unmount } = await mount(<MemoryRepoGraphPanel graph={{ nodes: [], edges: [] }} onOpenFile={() => {}} />)
    expect(container.querySelector('[data-testid="memory-repo-graph-empty"]')).not.toBeNull()
    await unmount()
  })

  it('renders the legend with every node kind', async () => {
    const { container, unmount } = await mount(<MemoryRepoGraphLegend />)
    const legend = container.querySelector('[data-testid="memory-repo-graph-legend"]')
    expect(legend).not.toBeNull()
    const legendKeys = [
      'memory.repo.graph.legendLesson',
      'memory.repo.graph.legendTopic',
      'memory.repo.graph.legendContext',
      'memory.repo.graph.legendSession',
      'memory.repo.graph.legendNote',
      'memory.repo.graph.legendFile',
    ] as const
    for (const key of legendKeys) {
      expect(legend?.textContent).toContain(i18n.t(key))
    }
    await unmount()
  })

  it('renders the graph and opens a file on node click', async () => {
    const seen: string[] = []
    const { container, unmount } = await mount(<MemoryRepoGraphPanel graph={GRAPH} onOpenFile={(path) => seen.push(path)} />)
    expect(container.querySelector('[data-testid="memory-repo-graph-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="memory-repo-graph-legend"]')).not.toBeNull()
    const node = container.querySelector<HTMLButtonElement>('[data-testid="memory-repo-graph-node-n1"]')
    expect(node).not.toBeNull()
    node?.click()
    await flush()
    expect(seen).toEqual(['lessons/workflow/rule--abc.md'])
    await unmount()
  })

  it('keeps node wrappers stable when onOpenFile identity changes (nodeTypes memo)', async () => {
    // Each inline arrow is a new identity; the module-level node wrapper + empty
    // memo must keep nodeTypes stable, so nodes reconcile in place rather than
    // remounting. A remount would swap the DOM element entirely.
    const { container, root, unmount } = await mount(<MemoryRepoGraphPanel graph={GRAPH} onOpenFile={() => {}} />)
    const before = container.querySelector('[data-testid="memory-repo-graph-node-n1"]')
    expect(before).not.toBeNull()
    await act(async () => {
      root.render(<MemoryRepoGraphPanel graph={GRAPH} onOpenFile={() => {}} />)
    })
    const after = container.querySelector('[data-testid="memory-repo-graph-node-n1"]')
    expect(after).toBe(before)
    await unmount()
  })
})

describe('MemoryRepoGraphPanel helpers', () => {
  it('openGraphNode forwards the node path and reports whether it opened', () => {
    const seen: string[] = []
    expect(openGraphNode({ data: { path: 'lessons/x.md' } }, (path) => seen.push(path))).toBe(true)
    expect(openGraphNode({ data: {} }, (path) => seen.push(path))).toBe(false)
    expect(openGraphNode(null, (path) => seen.push(path))).toBe(false)
    expect(seen).toEqual(['lessons/x.md'])
  })

  it('node button click calls onOpen', async () => {
    const seen: string[] = []
    const { container, unmount } = await mount(
      <MemoryGraphNodeButton id="n1" data={{ label: 'Rule', kind: 'lesson', path: 'lessons/x.md' }} onOpen={(path) => seen.push(path)} />,
    )
    container.querySelector<HTMLButtonElement>('[data-testid="memory-repo-graph-node-n1"]')?.click()
    await flush()
    expect(seen).toEqual(['lessons/x.md'])
    await unmount()
  })

  it('grid positions are deterministic', () => {
    expect(graphGridPosition(0)).toEqual({ x: 0, y: 0 })
    expect(graphGridPosition(4)).toEqual({ x: 0, y: 92 })
  })
})
