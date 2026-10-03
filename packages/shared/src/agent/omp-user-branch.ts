import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type OmpBranchEntry = {
  type?: string
  id?: string
  parentId?: string | null
  message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> }
  [key: string]: unknown
}

/** Resolve a user message between its neighbouring persisted assistant anchors. */
export function resolveOmpUserBranchAnchor(input: {
  sessionPath: string
  sdkSessionId?: string
  messages: Array<{ id: string; role: string; content: string }>
  messageId: string
  anchors: Record<string, string>
}): string | undefined {
  const selected = input.messages.findIndex(message => message.id === input.messageId)
  if (selected < 0 || input.messages[selected]?.role !== 'user') return undefined
  let names: string[]
  try { names = readdirSync(join(input.sessionPath, 'omp')).filter(name => name.endsWith('.jsonl')).sort() } catch { return undefined }
  const name = input.sdkSessionId
    ? names.filter(name => {
      // Fork copies use branched-<timestamp>.jsonl, while their session header
      // retains the provider identity. Filenames alone cannot resolve them.
      const firstLine = readFileSync(join(input.sessionPath, 'omp', name), 'utf8').split('\n', 1)[0]
      try {
        const header = JSON.parse(firstLine ?? '') as OmpBranchEntry
        return header.type === 'session' ? header.id === input.sdkSessionId : name.includes(input.sdkSessionId!)
      } catch { return false }
    }).at(-1)
    : names.at(-1)
  if (!name) return undefined
  const entries = readFileSync(join(input.sessionPath, 'omp', name), 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as OmpBranchEntry)
  let before: string | undefined
  let after: string | undefined
  for (let index = selected - 1; index >= 0; index--) {
    const message = input.messages[index]!
    if (input.anchors[message.id]) { before = input.anchors[message.id]; break }
  }
  for (let index = selected + 1; index < input.messages.length; index++) {
    const message = input.messages[index]!
    if (input.anchors[message.id]) { after = input.anchors[message.id]; break }
  }
  const from = before ? entries.findIndex(entry => entry.id === before) : -1
  const to = after ? entries.findIndex(entry => entry.id === after) : entries.length
  if (before && from < 0 || after && to < 0 || to <= from) return undefined
  const candidates = entries.slice(from + 1, to).filter(entry => entry.type === 'message' && entry.message?.role === 'user' && entry.id)
  // Multiple pending/steered users between replies must be matched individually.
  const source = input.messages[selected]!.content.trim()
  const matching = candidates.filter(entry => {
    const content = entry.message?.content
    const text = typeof content === 'string' ? content : content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? ''
    return source && (text.trim() === source || text.includes(source))
  })
  const chosen = matching.length === 1 ? matching : candidates.length === 1 && (before || after) ? candidates : []
  return chosen.length === 1 ? chosen[0]!.id : undefined
}

/** Copy only the selected entry's ancestry, retaining provider metadata and header. */
export function serializeOmpUserBranch(entries: OmpBranchEntry[], anchorId: string): string {
  const byId = new Map(entries.filter(entry => entry.type !== 'session' && entry.id).map(entry => [entry.id!, entry]))
  const anchor = byId.get(anchorId)
  if (anchor?.type !== 'message' || anchor.message?.role !== 'user') throw new Error('OMP user branch anchor is not a user message')
  const chain: OmpBranchEntry[] = []
  const visited = new Set<string>()
  let current: OmpBranchEntry | undefined = anchor
  while (current) {
    if (!current.id || visited.has(current.id)) throw new Error('OMP user branch ancestry is invalid')
    visited.add(current.id)
    chain.unshift(current)
    if (!current.parentId) break
    const parent = byId.get(current.parentId)
    if (!parent) throw new Error('OMP user branch ancestor is missing')
    current = parent
  }
  const header = entries.find(entry => entry.type === 'session')
  return [...(header ? [header] : []), ...chain].map(entry => JSON.stringify(entry)).join('\n') + '\n'
}
