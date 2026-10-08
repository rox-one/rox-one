/**
 * W1-10 (#1507) — runtime command-catalogue reader shared by the
 * `risk-class` and `negative-tests` gates.
 *
 * Reads what the bus actually registers, not source text (#1507 review 2):
 * - `packages/core/src/commands/catalogue/index.ts` (#1500) must export
 *   `COMMAND_CATALOGUE: CommandDefinition[]`. Definitions come from
 *   `moduleCatalogue('<module>', flag, [['tasks.create', 'by-target'], …])`
 *   tuples or from object literals; the gate sees the resulting objects.
 * - `packages/server-core/src/commands/registry.ts` (#1500), when present,
 *   must export `createCommandRegistry()`. Its registry is the source of
 *   truth for handler bindings (`registry.handler(type)`) and for the
 *   definitions after `bindSchema(type, schema, { riskClass })` (W1-06
 *   #1503 binds schemas, W1-11 #1508 sets risk classes there).
 *
 * Scope (owner decision, #1507 review 2): only commands with a bound
 * handler, or with `schemaBound: true`, are GATED. Every other catalogue
 * entry is a placeholder until its module package lands and is reported as
 * pending, never as a failure.
 *
 * Input policy (types.ts): no catalogue module = input absent (pending).
 * A catalogue or registry module that exists but cannot be imported, lacks
 * the export, throws or has the wrong shape is a problem, and the gates
 * FAIL on it (fail closed).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { errorMessage } from './types.ts'

export const CATALOGUE_PATH = join('packages', 'core', 'src', 'commands', 'catalogue')
export const CATALOGUE_MODULE_PATH = join(CATALOGUE_PATH, 'index.ts')
export const COMMAND_REGISTRY_PATH = join('packages', 'server-core', 'src', 'commands', 'registry.ts')
export const COMMAND_ID_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/

/** What the gates need to know about one registered command. */
export interface CatalogueCommand {
  type: string
  module: string
  schemaBound: boolean
  /** A handler is bound in the registry from `createCommandRegistry()`. */
  bound: boolean
  /** `riskClass` is a function on the (registry) definition. */
  hasRiskClass: boolean
  /** Gated = bound handler or schemaBound (owner decision). */
  gated: boolean
}

export interface CatalogueReadout {
  present: boolean
  commands: CatalogueCommand[]
  problems: string[]
  /** Where bindings were read from (for summaries). */
  bindingSource: 'registry' | 'catalogue-only'
}

/** Minimal registry surface used by the gates (#1500 `CommandRegistry`). */
export interface RegistryLike {
  get(type: string): unknown
  handler(type: string): unknown
}

export interface CatalogueInputs {
  repoRoot?: string
  /** Absolute path of the catalogue module (self-tests). */
  catalogueModulePath?: string
  /** Absolute path of the registry-factory module (self-tests); `null` = do not look for one. */
  registryModulePath?: string | null
}

function defaultRoot(): string {
  return join(import.meta.dir, '..', '..', '..', '..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function loadCatalogue(opts: CatalogueInputs = {}): Promise<CatalogueReadout> {
  const root = opts.repoRoot ?? defaultRoot()
  const cataloguePath = opts.catalogueModulePath ?? join(root, CATALOGUE_MODULE_PATH)
  const empty: CatalogueReadout = { present: false, commands: [], problems: [], bindingSource: 'catalogue-only' }
  if (!existsSync(cataloguePath)) return empty

  const problems: string[] = []
  const broken = (problem: string): CatalogueReadout => ({ present: true, commands: [], problems: [problem], bindingSource: 'catalogue-only' })

  let catalogueModule: Record<string, unknown>
  try {
    catalogueModule = (await import(cataloguePath)) as Record<string, unknown>
  } catch (error) {
    return broken(`${CATALOGUE_MODULE_PATH}: import failed: ${errorMessage(error)}`)
  }
  const list = catalogueModule.COMMAND_CATALOGUE
  if (!Array.isArray(list)) return broken(`${CATALOGUE_MODULE_PATH}: must export COMMAND_CATALOGUE (an array of CommandDefinition)`)

  // Registry factory: bindings + post-bindSchema definitions.
  let registry: RegistryLike | null = null
  const registryPath = opts.registryModulePath === undefined ? join(root, COMMAND_REGISTRY_PATH) : opts.registryModulePath
  if (registryPath && existsSync(registryPath)) {
    try {
      const mod = (await import(registryPath)) as Record<string, unknown>
      if (typeof mod.createCommandRegistry !== 'function') {
        problems.push(`${COMMAND_REGISTRY_PATH}: must export createCommandRegistry()`)
      } else {
        const made = (mod.createCommandRegistry as (o: object) => unknown)({})
        if (made === null || typeof made !== 'object') problems.push(`${COMMAND_REGISTRY_PATH}: createCommandRegistry() returned ${made === null ? 'null' : typeof made}`)
        else if (typeof (made as RegistryLike).handler !== 'function' || typeof (made as RegistryLike).get !== 'function') {
          problems.push(`${COMMAND_REGISTRY_PATH}: the registry must expose get(type) and handler(type)`)
        } else registry = made as RegistryLike
      }
    } catch (error) {
      problems.push(`${COMMAND_REGISTRY_PATH}: createCommandRegistry() failed: ${errorMessage(error)}`)
    }
  }

  const commands: CatalogueCommand[] = []
  const seen = new Set<string>()
  list.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.type !== 'string' || !COMMAND_ID_RE.test(entry.type)) {
      problems.push(`COMMAND_CATALOGUE[${index}]: expected a definition with a dotted type ('<module>.<verb>'), got ${JSON.stringify(entry)?.slice(0, 120)}`)
      return
    }
    const type = entry.type
    if (seen.has(type)) problems.push(`COMMAND_CATALOGUE: duplicate type '${type}'`)
    seen.add(type)
    if (typeof entry.module !== 'string' || entry.module === '') problems.push(`${type}: definition has no owner module`)
    if (typeof entry.schemaBound !== 'boolean') problems.push(`${type}: schemaBound must be a boolean`)
    let definition: Record<string, unknown> = entry
    let bound = false
    if (registry) {
      try {
        const live = registry.get(type)
        if (isRecord(live)) definition = live
        else problems.push(`${type}: in COMMAND_CATALOGUE but not defined in createCommandRegistry()`)
        bound = typeof registry.handler(type) === 'function'
      } catch (error) {
        problems.push(`${type}: registry lookup failed: ${errorMessage(error)}`)
      }
    }
    const schemaBound = definition.schemaBound === true
    commands.push({
      type,
      module: typeof entry.module === 'string' ? entry.module : '',
      schemaBound,
      bound,
      hasRiskClass: typeof definition.riskClass === 'function',
      gated: bound || schemaBound,
    })
  })
  if (list.length === 0) problems.push(`${CATALOGUE_MODULE_PATH}: COMMAND_CATALOGUE is empty`)
  return { present: true, commands, problems, bindingSource: registry ? 'registry' : 'catalogue-only' }
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

export const COMMAND_ALLOWLIST_PATH = join('packages', 'test-harness', 'allowlists', 'command-gates.json')

/**
 * Shared verdict for the per-command gates.
 * - catalogue absent → pending; catalogue / registry problems → fail;
 * - gated commands (bound or schemaBound) are checked; an allowlisted
 *   command is exempt, but a stale allowlist entry (unknown, not gated, or
 *   now passing) fails so the list shrinks;
 * - nothing gated yet → pending with the unbound count (owner decision).
 */
export function commandGateResult(args: {
  gate: string
  readout: CatalogueReadout
  /** `null` = the command satisfies the gate; otherwise the violation text. */
  check: (cmd: CatalogueCommand) => string | null
  allowlist: { entries: string[]; problems: string[] }
  okNoun: string
}): import('./types.ts').GateResult {
  const { gate, readout, check, allowlist } = args
  if (!readout.present) {
    return { gate, status: 'pending', summary: `pending (input not present: ${CATALOGUE_MODULE_PATH} from #1500)` }
  }
  const violations = [...readout.problems, ...allowlist.problems]
  const byType = new Map(readout.commands.map((c) => [c.type, c]))
  const allowed = new Set(allowlist.entries)
  const gated = readout.commands.filter((c) => c.gated)
  const unbound = readout.commands.length - gated.length
  let exempt = 0
  for (const cmd of gated) {
    const problem = check(cmd)
    if (problem === null) continue
    if (allowed.has(cmd.type)) {
      exempt += 1
      continue
    }
    violations.push(problem)
  }
  for (const id of allowlist.entries) {
    const cmd = byType.get(id)
    if (!cmd) violations.push(`allowlist entry '${id}' is not a registered command; remove it`)
    else if (!cmd.gated) violations.push(`allowlist entry '${id}' is not gated yet (no bound handler, schemaBound false); remove it`)
    else if (check(cmd) === null) violations.push(`allowlist entry '${id}' now passes; remove it (the allowlist only shrinks)`)
  }
  const tail = `${unbound} unbound command(s) pending (no handler, schemaBound false; bindings from ${readout.bindingSource})`
  if (violations.length > 0) return { gate, status: 'fail', summary: `${violations.length} violation(s); ${tail}`, violations }
  if (gated.length === 0) return { gate, status: 'pending', summary: `pending: no command has a bound handler or schemaBound: true yet; ${tail}` }
  return { gate, status: 'pass', summary: `${gated.length - exempt} gated command(s) ${args.okNoun}${exempt ? ` (${exempt} allowlisted)` : ''}; ${tail}` }
}
