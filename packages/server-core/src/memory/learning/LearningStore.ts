/**
 * Generic JSONL store for the learning layer.
 * Fail-soft: corrupt lines are skipped; rewrites are atomic (tmp + rename).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export class LearningStore<T extends { id: string }> {
  readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  list(): T[] {
    return this.readAll()
  }

  get(id: string): T | null {
    return this.list().find((item) => item.id === id) ?? null
  }

  save(item: T): T {
    const items = this.list()
    const index = items.findIndex((existing) => existing.id === item.id)
    if (index >= 0) items[index] = item
    else items.push(item)
    this.rewrite(items)
    return item
  }

  saveMany(items: T[]): T[] {
    const current = this.list()
    for (const item of items) {
      const index = current.findIndex((existing) => existing.id === item.id)
      if (index >= 0) current[index] = item
      else current.push(item)
    }
    this.rewrite(current)
    return items
  }

  remove(id: string): boolean {
    const items = this.list()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return false
    items.splice(index, 1)
    this.rewrite(items)
    return true
  }

  protected readAll(): T[] {
    if (!existsSync(this.filePath)) return []
    const content = readFileSync(this.filePath, 'utf-8')
    const out: T[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as T
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
          out.push(parsed)
        }
      } catch {
        // skip corrupt line
      }
    }
    return out
  }

  protected rewrite(items: T[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''))
    renameSync(tmp, this.filePath)
  }
}