/**
 * W1-10 (#1507) — command-catalogue reader shared by the riskClass and
 * negative-test gates.
 *
 * Input: `packages/core/src/commands/catalogue/*.ts` (#1500; one file per
 * module, aggregated by `index.ts`). Discovery is source-based (no
 * imports). A command definition is the object literal that carries the
 * command id as `type: '<module>.<verb>'` (TECH-SPEC §3.4 CommandDefinition)
 * or `name: '<module>.<verb>'`. Ids must be dotted, so `{ type: 'string' }`
 * fields are ignored, and objects nested in a definition (an `mcp: { name }`
 * block, an emitted event) are not counted as separate commands.
 *
 * Input policy (types.ts): no catalogue dir, or no module file besides
 * `index.ts`, = input absent (pending). A module file in which no
 * definition can be found is reported as a problem, and the gates FAIL on
 * it (fail closed) rather than skipping the file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const CATALOGUE_PATH = join('packages', 'core', 'src', 'commands', 'catalogue')
export const COMMAND_ID_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/

export interface CommandDefinitionSource {
  id: string
  file: string
  /** Source text of the definition's object literal. */
  body: string
}

export interface CatalogueReadout {
  present: boolean
  moduleFiles: string[]
  commands: CommandDefinitionSource[]
  problems: string[]
}

/** Remove // and /* *\/ comments, keeping string literals intact. */
export function stripJsComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j
    } else if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = (nl === -1 ? src.length : nl) - 1
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 1
      out += ' '
    } else out += ch
  }
  return out
}

/** Index of the bracket closing the one at `open` (skips string literals). */
export function matchBracket(text: string, open: number): number {
  const openCh = text[open]
  const closeCh = openCh === '(' ? ')' : openCh === '{' ? '}' : ']'
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1
      i = j
    } else if (ch === openCh) depth += 1
    else if (ch === closeCh) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Start index of the innermost `{` enclosing `at` (string-agnostic scan backwards). */
function enclosingObjectStart(text: string, at: number): number {
  let depth = 0
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = text[i]
    if (ch === '}') depth += 1
    else if (ch === '{') {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

export function parseCatalogueSource(source: string, file: string): CommandDefinitionSource[] {
  const text = stripJsComments(source)
  const found: Array<{ id: string; start: number; end: number }> = []
  const re = /\b(?:type|name)\s*:\s*(['"`])([^'"`\n]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const id = m[2]!
    if (!COMMAND_ID_RE.test(id)) continue
    const start = enclosingObjectStart(text, m.index)
    if (start === -1) continue
    const end = matchBracket(text, start)
    if (end === -1) continue
    found.push({ id, start, end })
  }
  // Keep outermost definitions only: an object nested inside another match
  // (mcp: { name }, emitted events, …) belongs to that definition.
  const outer = found.filter((f) => !found.some((g) => g !== f && g.start <= f.start && g.end >= f.end && (g.start !== f.start || g.end !== f.end)))
  const seen = new Set<string>()
  const result: CommandDefinitionSource[] = []
  for (const f of outer) {
    const key = `${f.start}:${f.end}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ id: f.id, file, body: text.slice(f.start, f.end + 1) })
  }
  return result
}

function isModuleFile(name: string): boolean {
  return /\.m?tsx?$/.test(name) && !/\.(?:test|spec|d)\.m?tsx?$/.test(name)
}

export function readCatalogue(dir: string): CatalogueReadout {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { present: false, moduleFiles: [], commands: [], problems: [] }
  const files = readdirSync(dir).filter(isModuleFile).sort()
  const moduleFiles = files.filter((f) => !/^index\.m?tsx?$/.test(f))
  if (moduleFiles.length === 0) return { present: false, moduleFiles: [], commands: [], problems: [] }
  const commands: CommandDefinitionSource[] = []
  const problems: string[] = []
  for (const file of moduleFiles) {
    const defs = parseCatalogueSource(readFileSync(join(dir, file), 'utf8'), file)
    if (defs.length === 0) {
      problems.push(`${file}: no command definition found (expected objects with type: '<module>.<verb>' or name: '<module>.<verb>')`)
    }
    commands.push(...defs)
  }
  return { present: true, moduleFiles, commands, problems }
}
