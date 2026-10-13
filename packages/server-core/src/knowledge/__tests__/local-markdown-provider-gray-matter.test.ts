import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import matter from 'gray-matter'
import { LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER } from '@rox/core/knowledge'
import { LocalMarkdownKnowledgeProvider } from '../local-markdown-provider'

const matterCache = (matter as unknown as { cache: Record<string, unknown> }).cache

describe('LocalMarkdownKnowledgeProvider gray-matter cache', () => {
  let notesRoot: string

  beforeEach(async () => {
    notesRoot = await mkdtemp(join(tmpdir(), 'local-markdown-matter-'))
  })

  afterEach(async () => {
    await rm(notesRoot, { recursive: true, force: true })
  })

  it('reads note frontmatter without retaining the content in matter.cache', async () => {
    const content = '---\ntitle: Cache Probe Note\nowner: probe\n---\n\nLocal markdown body.\n'
    await writeFile(join(notesRoot, 'cache-probe.md'), content, 'utf-8')
    const provider = new LocalMarkdownKnowledgeProvider({
      connection: { id: 'conn-local', provider: LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER, label: 'Local', status: 'connected' },
      workspaceId: 'ws-matter',
      notesRoot,
    })
    const keysBefore = Object.keys(matterCache).length

    const node = await provider.get({
      scheme: 'siyuan',
      provider: LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER,
      kind: 'document',
      id: 'cache-probe',
    })

    expect(node.title).toBe('Cache Probe Note')
    expect(node.attributes).toEqual([{ key: 'owner', value: 'probe' }])
    expect(Object.keys(matterCache).length).toBe(keysBefore)
    expect(content in matterCache).toBe(false)
  })
})
