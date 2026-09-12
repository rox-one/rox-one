import { describe, expect, it } from 'bun:test'
import {
  CODE_INTEL_PACK,
  REJECTED_CODE_INTEL_TOOLS,
  SELECTED_CODE_INTEL,
  assertEveryNodeHasProvenance,
  explainWithProvenance,
  indexSourceFiles,
  isSafeToIngest,
  localFsSymbolsAdapter,
  materializeArchitectureNote,
  runSyftSbom,
} from '../index.ts'

const COMMIT = 'abc1234'

describe('code-intelligence adapter selection', () => {
  it('records rejected wiki/graph duplicates and keeps tools off by default', () => {
    expect(CODE_INTEL_PACK.alwaysOn).toBe(false)
    expect(CODE_INTEL_PACK.agentDiscoverable).toBe(true)
    expect(SELECTED_CODE_INTEL).toEqual(['local-fs-symbols', 'syft-sbom'])
    expect(REJECTED_CODE_INTEL_TOOLS.map((t) => t.name)).toContain('CodeWiki')
    expect(REJECTED_CODE_INTEL_TOOLS.map((t) => t.name)).toContain('DeepWiki')
    expect(localFsSymbolsAdapter.alwaysOn).toBe(false)
  })
})

describe('local repository index', () => {
  it('links every graph node to a source symbol and commit', () => {
    const graph = indexSourceFiles([
      {
        path: 'src/foo.ts',
        commit: COMMIT,
        content: 'export function greet() {}\nexport class Box {}\nexport type Id = string\n',
      },
    ])
    assertEveryNodeHasProvenance(graph)
    const nodes = explainWithProvenance(graph)
    expect(nodes.length).toBeGreaterThan(1)
    for (const node of nodes) {
      expect(node.commit).toBe(COMMIT)
      expect(node.startLine).toBeGreaterThan(0)
      expect(node.citation).toContain('src/foo.ts')
    }
    const note = materializeArchitectureNote(graph)
    expect(note.markdown).toContain('# Architecture')
    expect(note.canvasNodes).toEqual(nodes)
  })

  it('skips secrets and oversized files before agent ingestion', () => {
    expect(
      isSafeToIngest({ path: 'leak.env', commit: COMMIT, content: 'sk-abcdefghijkl' }),
    ).toBe(false)
    expect(
      isSafeToIngest({ path: 'src/ok.ts', commit: COMMIT, content: 'export function x() {}' }),
    ).toBe(true)
  })
})

describe('syft SBOM', () => {
  it('does not install syft when the binary is missing', async () => {
    const scan = await runSyftSbom('/tmp/repo', async () => ({ ok: false, stdout: '' }))
    expect(scan.available).toBe(false)
    expect(scan.tool).toBe('syft')
    expect(scan.documents).toEqual([])
  })
})
