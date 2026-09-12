import type { CodeGraph, CodeIntelAdapter, CodeSymbol, SourceFile } from './types.ts'

const MAX_FILE_BYTES = 256 * 1024

const SECRET_HINT = /(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/

export function isSafeToIngest(file: SourceFile): boolean {
  if (file.content.length > MAX_FILE_BYTES) return false
  if (SECRET_HINT.test(file.content)) return false
  if (file.path.includes('node_modules/') || file.path.includes('.git/')) return false
  return true
}

const FUNCTION_RE = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)/g
const CLASS_RE = /(?:export\s+)?class\s+([A-Za-z_][\w]*)/g
const TYPE_RE = /(?:export\s+)?(?:type|interface)\s+([A-Za-z_][\w]*)/g

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

function collect(
  content: string,
  path: string,
  commit: string,
  kind: CodeSymbol['kind'],
  regex: RegExp,
  symbols: CodeSymbol[],
): void {
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(content))) {
    const name = match[1]
    if (!name) continue
    const startLine = lineOf(content, match.index)
    const id = `${path}:${kind}:${name}:${startLine}`
    symbols.push({ id, name, kind, path, startLine, commit })
  }
}

export function indexSourceFiles(files: readonly SourceFile[]): CodeGraph {
  const symbols: CodeSymbol[] = []
  const edges: CodeGraph['edges'] = []
  const summaries: Record<string, string> = {}

  for (const file of files) {
    if (!isSafeToIngest(file)) continue
    const fileId = `${file.path}:file:${file.path}:1`
    symbols.push({
      id: fileId,
      name: file.path.split('/').pop() ?? file.path,
      kind: 'file',
      path: file.path,
      startLine: 1,
      commit: file.commit,
    })
    summaries[fileId] = `file ${file.path}`
    const before = symbols.length
    collect(file.content, file.path, file.commit, 'function', FUNCTION_RE, symbols)
    collect(file.content, file.path, file.commit, 'class', CLASS_RE, symbols)
    collect(file.content, file.path, file.commit, 'type', TYPE_RE, symbols)
    for (const symbol of symbols.slice(before)) {
      edges.push({ from: fileId, to: symbol.id, kind: 'contains' })
    }
  }

  return {
    symbols,
    edges,
    citations: symbols.map((s) => ({
      symbolId: s.id,
      path: s.path,
      startLine: s.startLine,
      commit: s.commit,
    })),
    summaries,
  }
}

export const localFsSymbolsAdapter: CodeIntelAdapter = {
  id: 'local-fs-symbols',
  alwaysOn: false,
  index: indexSourceFiles,
}
