import { useDomForFile } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { LoadedSkill } from '../../../shared/types'
import { SKILLS_UI_QUERY_DEBOUNCE_MS } from '@/lib/skills-query'
import { useSkillsQuery } from '../use-skills-query'

const testWindow = useDomForFile()

interface SkillsBridge {
  electronAPI: {
    querySkills: (args: { workspaceId: string; query?: string; offset?: number; limit?: number; slugs?: string[] }) => Promise<{ items: LoadedSkill[]; total: number; revision: number }>
    onSkillsChanged: (callback: (workspaceId: string, payload: { revision: number; changed: string[]; removed: string[] }) => void) => () => void
  }
}

const bridge = testWindow as unknown as SkillsBridge

function skill(slug: string): LoadedSkill {
  return {
    slug,
    path: `/skills/${slug}`,
    source: 'workspace',
    content: '',
    contentLength: 4,
    metadata: { name: slug, description: slug },
  }
}

let catalog: LoadedSkill[]
let revision: number
let queryCalls: unknown[]
let changed: ((workspaceId: string, payload: { revision: number; changed: string[]; removed: string[] }) => void) | null

beforeEach(() => {
  catalog = Array.from({ length: 40 }, (_, i) => skill(`skill-${String(i).padStart(2, '0')}`))
  revision = 1
  queryCalls = []
  changed = null
  bridge.electronAPI = {
    querySkills: async (args) => {
      queryCalls.push(args)
      const needle = args.query?.trim().toLocaleLowerCase() ?? ''
      const slugs = args.slugs ? new Set(args.slugs) : null
      const matched = catalog.filter((row) => {
        if (slugs && !slugs.has(row.slug)) return false
        if (needle && !row.slug.includes(needle) && !row.metadata.name.includes(needle)) return false
        return true
      })
      const offset = args.offset ?? 0
      const limit = args.limit ?? 80
      return { items: matched.slice(offset, offset + limit), total: matched.length, revision }
    },
    onSkillsChanged: (callback) => {
      changed = callback
      return () => { if (changed === callback) changed = null }
    },
  }
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(query = '') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let latest: ReturnType<typeof useSkillsQuery> | null = null
  function Probe({ q }: { q: string }) {
    latest = useSkillsQuery({ workspaceId: 'ws', query: q, limit: 10 })
    return <span data-count={latest.items.length} data-total={latest.total} />
  }
  await act(async () => { root.render(<Probe q={query} />) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, SKILLS_UI_QUERY_DEBOUNCE_MS + 10)) })
  return {
    get: () => latest!,
    async type(next: string) {
      await act(async () => { root.render(<Probe q={next} />) })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, SKILLS_UI_QUERY_DEBOUNCE_MS + 10)) })
    },
    async unmount() {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

describe('useSkillsQuery', () => {
  it('loads a page, not the whole catalog, and searches through skills:query', async () => {
    const view = await mount()
    expect(view.get().total).toBe(40)
    expect(view.get().items).toHaveLength(10)
    expect(view.get().items[0]?.slug).toBe('skill-00')
    await view.type('skill-3')
    expect(view.get().items.every((row) => row.slug.includes('skill-3'))).toBe(true)
    expect(queryCalls.some((call) => (call as { query?: string }).query === 'skill-3')).toBe(true)
    await view.unmount()
  })

  it('applies a skills:changed delta without refetching the catalog', async () => {
    const view = await mount()
    const before = queryCalls.length
    catalog = catalog.map((row) => row.slug === 'skill-00'
      ? { ...row, metadata: { name: 'Renamed', description: row.metadata.description } }
      : row)
    revision = 2
    await act(async () => {
      changed?.('ws', { revision: 2, changed: ['skill-00'], removed: ['skill-01'] })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(view.get().items.some((row) => row.slug === 'skill-01')).toBe(false)
    expect(view.get().items.find((row) => row.slug === 'skill-00')?.metadata.name).toBe('Renamed')
    expect(queryCalls.length).toBe(before + 1)
    expect((queryCalls.at(-1) as { slugs?: string[] }).slugs).toEqual(['skill-00'])
    await view.unmount()
  })
})
