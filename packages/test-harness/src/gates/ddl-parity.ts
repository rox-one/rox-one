/**
 * W1-10 (#1507) — DDL ↔ zod parity gate.
 *
 * Compares the unified server DDL `apps/workspace-service/migrations/5NN-*.sql`
 * (owner #1502) against zod schemas in `packages/shared/src/domain/*.ts`
 * (owner #1503).
 *
 * Tables = every `CREATE TABLE` in the 5NN files plus every table those
 * files extend with `ALTER TABLE … ADD [COLUMN]` (principal, workspace,
 * workspace_member, project, …); added columns join the table's column
 * list, so drift on them is caught too.
 *
 * Unpaired tables (owner decision, #1507 review 2): a table with no zod
 * schema is a VIOLATION unless it is listed in the checked-in, shrink-only
 * `packages/test-harness/allowlists/ddl-unpaired-tables.json` (seeded with
 * the tables that had no schema when the gate landed). A new table missing
 * from the list fails; an entry whose table now pairs, or no longer
 * exists, is stale and fails until it is removed (see allowlist.ts).
 *
 * Input policy (types.ts): no `5NN-*.sql` file → pending. With migrations
 * but no zod module yet, the allowlist is still enforced (every table must
 * be listed) and the gate reports pending for the column comparison. Once
 * zod modules exist, zero table↔schema pairs is a FAILURE (the mapping is
 * broken), never a silent pending.
 *
 * Pairing, per table (first hit wins):
 * 1. `tableToSchema(table)` override → a schema file whose keys are used;
 * 2. a zod object named after the table in any schema file:
 *    `work_item` → `WorkItem`, `WorkItemSchema`, `workItemSchema`,
 *    `WorkItemRow`, `WorkItemRowSchema` (`const X = z.object({…})`);
 * 3. a file named `<table>.ts` / `<table>.schema.ts` (all its zod keys).
 *
 * Columns and keys are compared case- and separator-insensitively, so
 * snake_case SQL (`link_id`) matches camelCase zod (`linkId`). The SQL
 * parser is dependency-free but handles comments, dollar-quoted bodies,
 * schema-qualified and multi-word types (`public.citext`, `double
 * precision`, `timestamp with time zone`, arrays), several columns on one
 * line, and table constraints.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pending, type GateResult } from './types.ts'
import { resolveAllowlist, type AllowlistInputs } from './allowlist.ts'

export interface ParityOptions {
  repoRoot?: string
  migrationsDir?: string
  schemasDir?: string
  tableToSchema?: (table: string) => string | null
  /** Injected allowlist state (self-tests); default: the checked-in file + git merge-base. */
  allowlist?: AllowlistInputs
}

export const DDL_ALLOWLIST_PATH = join('packages', 'test-harness', 'allowlists', 'ddl-unpaired-tables.json')

/** The unified DDL files this gate compares (#1502 numbering). */
export const UNIFIED_MIGRATION_RE = /^5\d\d-[A-Za-z0-9_-]+\.sql$/

function defaultRoot(): string {
  return join(import.meta.dir, '..', '..', '..', '..')
}

function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1)
      const stop = end === -1 ? sql.length : end + 1
      out += sql.slice(i, stop)
      i = stop
    } else if (ch === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i, i + 64))) {
      // Dollar-quoted body (DO blocks, functions): skipped, never parsed as DDL.
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64))![0]
      const end = sql.indexOf(tag, i + tag.length)
      i = end === -1 ? sql.length : end + tag.length
      out += ' '
    } else if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
    } else {
      out += ch
      i += 1
    }
  }
  return out
}

/** Index of the bracket closing the one at `open`, honouring quotes. */
function matchClose(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = text.indexOf(ch, i + 1)
      if (end === -1) return -1
      i = end
    } else if (ch === openCh) depth += 1
    else if (ch === closeCh) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Split on commas that are not inside (), [], {} or quotes. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = body.indexOf(ch, i + 1)
      if (end === -1) break
      i = end
    } else if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

const TABLE_CONSTRAINT_RE = /^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE|LIKE)\b/i
const COLUMN_RE = /^(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+(?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*/

export function extractTables(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  const clean = stripSqlComments(sql)
  const re = /CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const open = m.index + m[0].length - 1
    const close = matchClose(clean, open, '(', ')')
    if (close === -1) continue
    const cols: string[] = []
    for (const item of splitTopLevel(clean.slice(open + 1, close))) {
      if (TABLE_CONSTRAINT_RE.test(item)) continue
      const cm = COLUMN_RE.exec(item)
      if (cm) cols.push((cm[1] ?? cm[2]).toLowerCase())
    }
    tables.set(m[1].toLowerCase(), cols)
    re.lastIndex = close + 1
  }
  return tables
}

/** End of the statement starting at `from` (top-level `;`), honouring quotes and brackets. */
function statementEnd(text: string, from: number): number {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1)
      if (end === -1) return text.length
      i = end
    } else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ';' && depth === 0) return i
  }
  return text.length
}

const ADD_NON_COLUMN_RE = /^ADD\s+(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE)\b/i
const ADD_COLUMN_RE = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+\S/i

/** `ALTER TABLE <t> ADD [COLUMN] [IF NOT EXISTS] <col> <type>, ADD …;` → table → added columns. */
export function extractAddedColumns(sql: string): Map<string, string[]> {
  const added = new Map<string, string[]>()
  const clean = stripSqlComments(sql)
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const start = m.index + m[0].length
    const end = statementEnd(clean, start)
    const table = m[1]!.toLowerCase()
    for (const action of splitTopLevel(clean.slice(start, end))) {
      if (ADD_NON_COLUMN_RE.test(action)) continue
      const cm = ADD_COLUMN_RE.exec(action)
      if (!cm) continue
      const list = added.get(table) ?? []
      list.push((cm[1] ?? cm[2])!.toLowerCase())
      added.set(table, list)
    }
    re.lastIndex = end
  }
  return added
}

/** Every table the 5NN files create or extend, with its (created + added) columns. */
export function extractUnifiedTables(sources: Array<{ file: string; sql: string }>): Map<string, { file: string; cols: string[] }> {
  const tables = new Map<string, { file: string; cols: string[] }>()
  for (const { file, sql } of sources) {
    for (const [table, cols] of extractTables(sql)) {
      const prev = tables.get(table)
      tables.set(table, { file: prev?.file ?? file, cols: [...(prev?.cols ?? []), ...cols] })
    }
  }
  for (const { file, sql } of sources) {
    for (const [table, cols] of extractAddedColumns(sql)) {
      const prev = tables.get(table)
      tables.set(table, { file: prev?.file ?? file, cols: [...new Set([...(prev?.cols ?? []), ...cols])] })
    }
  }
  return tables
}

const ZOD_KEY_RE = /(?:[{,\n]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\./

/** Every `key: z.…` in a source file (all objects, any depth). */
export function extractZodKeys(source: string): string[] {
  const keys: string[] = []
  const re = new RegExp(ZOD_KEY_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) keys.push(m[1])
  return [...new Set(keys)]
}

/** Top-level keys of an object-literal body (between its braces). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = []
  for (const part of splitTopLevel(body)) {
    const km = /^(?:['"]([^'"]+)['"]|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/.exec(part)
    if (km) keys.push(km[1] ?? km[2])
  }
  return keys
}

/** `const Name = z.object({ … })` (also strictObject / looseObject) → top-level keys. */
export function extractZodObjects(source: string): Map<string, string[]> {
  const objects = new Map<string, string[]>()
  const re = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*z\s*\.\s*(?:object|strictObject|looseObject)\s*\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const open = m.index + m[0].length - 1
    const close = matchClose(source, open, '{', '}')
    if (close === -1) continue
    objects.set(m[1], topLevelKeys(source.slice(open + 1, close)))
    re.lastIndex = close + 1
  }
  return objects
}

/** `link_id`, `linkId`, `LinkID` → `linkid`. */
export function normalizeFieldName(name: string): string {
  return name.replace(/[_\-\s]/g, '').toLowerCase()
}

export function zodNameCandidates(table: string): string[] {
  const pascal = table.split('_').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')
  const camel = pascal[0]!.toLowerCase() + pascal.slice(1)
  return [pascal, `${pascal}Schema`, `${camel}Schema`, `${pascal}Row`, `${pascal}RowSchema`, `${camel}RowSchema`]
}

function listSchemaFiles(schemasDir: string): string[] {
  return readdirSync(schemasDir).filter((f) => /\.(?:ts|mts)$/.test(f) && !/\.(?:test|spec|d)\.m?ts$/.test(f))
}

export function checkDdlZodParity(opts: ParityOptions = {}): GateResult {
  const root = opts.repoRoot ?? defaultRoot()
  const migrationsDir = opts.migrationsDir ?? join(root, 'apps', 'workspace-service', 'migrations')
  const schemasDir = opts.schemasDir ?? join(root, 'packages', 'shared', 'src', 'domain')
  const gate = 'ddl-zod-parity'

  const sqlFiles = existsSync(migrationsDir) && statSync(migrationsDir).isDirectory()
    ? readdirSync(migrationsDir).filter((f) => UNIFIED_MIGRATION_RE.test(f)).sort()
    : []
  if (sqlFiles.length === 0) return pending(gate, 'apps/workspace-service/migrations/5NN-*.sql', '1502')
  const tables = extractUnifiedTables(sqlFiles.map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), 'utf8') })))
  const schemaFiles = existsSync(schemasDir) && statSync(schemasDir).isDirectory() ? listSchemaFiles(schemasDir) : []

  const objects = new Map<string, { file: string; keys: string[] }>()
  const fileSources = new Map<string, string>()
  for (const file of schemaFiles) {
    const src = readFileSync(join(schemasDir, file), 'utf8')
    fileSources.set(file, src)
    for (const [name, keys] of extractZodObjects(src)) if (!objects.has(name)) objects.set(name, { file, keys })
  }

  const resolvePair = (table: string): { label: string; keys: string[] } | null => {
    const override = opts.tableToSchema?.(table)
    if (override) {
      const src = fileSources.get(override) ?? (existsSync(join(schemasDir, override)) ? readFileSync(join(schemasDir, override), 'utf8') : null)
      if (src !== null) return { label: override, keys: extractZodKeys(src) }
    }
    for (const name of zodNameCandidates(table)) {
      const hit = objects.get(name)
      if (hit) return { label: `${hit.file}#${name}`, keys: hit.keys }
    }
    for (const cand of [`${table}.ts`, `${table}.schema.ts`]) {
      const src = fileSources.get(cand)
      if (src !== undefined) return { label: cand, keys: extractZodKeys(src) }
    }
    return null
  }

  const allowlist = resolveAllowlist(root, DDL_ALLOWLIST_PATH, 'tables', opts.allowlist)
  const allowed = new Set(allowlist.entries)
  const violations: string[] = [...allowlist.problems]
  let compared = 0
  let unpairedAllowed = 0
  for (const [table, { file, cols }] of tables) {
    const pair = schemaFiles.length > 0 ? resolvePair(table) : null
    if (!pair) {
      if (allowed.has(table)) unpairedAllowed += 1
      else violations.push(`${file}:${table}: no zod schema (name it ${zodNameCandidates(table).slice(0, 3).join(' / ')}) and not in ${DDL_ALLOWLIST_PATH.split('\\').join('/')}`)
      continue
    }
    compared += 1
    if (allowed.has(table)) violations.push(`${file}:${table}: now pairs with ${pair.label}; remove it from the unpaired allowlist (the allowlist only shrinks)`)
    const keys = new Set(pair.keys.map(normalizeFieldName))
    for (const col of cols) {
      if (!keys.has(normalizeFieldName(col))) violations.push(`${file}:${table}: column '${col}' has no zod key in ${pair.label}`)
    }
  }
  for (const entry of allowlist.entries) {
    if (!tables.has(entry)) violations.push(`unpaired allowlist entry '${entry}' is not a table in the 5NN migrations; remove it`)
  }
  const tail = `${tables.size} table(s) in ${sqlFiles.length} 5NN file(s), ${unpairedAllowed} allowlisted unpaired`
  if (schemaFiles.length > 0 && compared === 0) {
    violations.unshift(
      `no ${basename(migrationsDir)}/5NN-*.sql table maps to a zod object in ${basename(schemasDir)}/: name the object after the table ` +
        `(work_item → WorkItem / WorkItemSchema / workItemSchema) or pass tableToSchema`,
    )
    return { gate, status: 'fail', summary: `0 table↔schema pairs among ${tables.size} table(s) and ${schemaFiles.length} zod module(s)`, violations }
  }
  if (violations.length > 0) return { gate, status: 'fail', summary: `${violations.length} violation(s); ${tail}`, violations }
  if (schemaFiles.length === 0) {
    return { gate, status: 'pending', summary: `pending (input not present: packages/shared/src/domain/*.ts from #1503); allowlist holds: ${tail}` }
  }
  return { gate, status: 'pass', summary: `${compared}/${tables.size} table(s) paired, columns match zod keys; ${tail}` }
}
