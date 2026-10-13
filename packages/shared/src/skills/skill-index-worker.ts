import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { registerWorkerHandler } from '../workers/handlers.ts'
import { isSafeSkillName } from './managed.ts'
import { readSkillHead } from './skill-head.ts'
import type { SkillSource } from './types.ts'

export interface SkillScanRow {
  path: string
  slug: string
  source: SkillSource
  root: string
  size: number
  mtimeMs: number
  name: string
  description: string
}

declare module '../workers/handlers.ts' {
  interface WorkerTaskMap {
    'skills.scanRoot': {
      payload: { root: string; source: SkillSource; excludeRoot?: string }
      result: SkillScanRow[]
    }
  }
}

registerWorkerHandler('skills.scanRoot', (payload) => {
  let names: string[] = []
  try { names = readdirSync(payload.root) } catch { return [] }
  const out: SkillScanRow[] = []
  for (const name of names) {
    if (!isSafeSkillName(name)) continue
    const dir = join(payload.root, name)
    if (payload.excludeRoot && (dir === payload.excludeRoot || dir.startsWith(payload.excludeRoot + '/'))) continue
    const head = readSkillHead(dir)
    if (!head) continue
    let nameMeta = name, description = ''
    try {
      const parsed = matter(head.text, {})
      if (parsed.data.name) nameMeta = String(parsed.data.name)
      if (parsed.data.description) description = String(parsed.data.description)
    } catch { /* keep slug */ }
    out.push({
      path: dir, slug: name, source: payload.source, root: payload.root,
      size: head.size, mtimeMs: head.mtimeMs, name: nameMeta, description,
    })
  }
  return out
})
