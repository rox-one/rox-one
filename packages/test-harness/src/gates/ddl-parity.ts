/**
 * W1-10 (#1507) — DDL ↔ zod parity gate.
 *
 * Compares the unified server DDL `apps/workspace-service/migrations/5NN-*.sql`
 * (owner #1502) against zod schemas in `packages/shared/src/domain/*.ts`
 * (owner #1503).
 *
 * Input policy (owner decision): `pending` only while an input is absent —
 * no `5NN-*.sql` file, or no zod module in the schemas dir. Once both exist
 * the gate must compare something: zero table↔schema pairs is a FAILURE
 * (the mapping is broken), never a silent pending.
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
 * parser is dependency-free but handles comments, schema-qualified and
 * multi-word types (`public.citext`, `double precision`, `timestamp with
 * time zone`, arrays), several columns on one line, and table constraints.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'

export interface ParityOptions {
  repoRoot?: string
  migrationsDir?: string
  schemasDir?: string
  tableToSchema?: (table: string) => string | null
}

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
  const root = opts.migrationsDir && opts.schemasDir ? '' : (opts.repoRoot ?? defaultRoot())
  const migrationsDir = opts.migrationsDir ?? join(root, 'apps', 'workspace-service', 'migrations')
  const schemasDir = opts.schemasDir ?? join(root, 'packages', 'shared', 'src', 'domain')
  const gate = 'ddl-zod-parity'

  const sqlFiles = existsSync(migrationsDir) && statSync(migrationsDir).isDirectory()
    ? readdirSync(migrationsDir).filter((f) => UNIFIED_MIGRATION_RE.test(f)).sort()
    : []
  if (sqlFiles.length === 0) return pending(gate, 'apps/workspace-service/migrations/5NN-*.sql', '1502')
  const schemaFiles = existsSync(schemasDir) && statSync(schemasDir).isDirectory() ? listSchemaFiles(schemasDir) : []
  if (schemaFiles.length === 0) return pending(gate, 'packages/shared/src/domain/*.ts', '1503')

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

  const violations: string[] = []
  let compared = 0
  let tableCount = 0
  for (const file of sqlFiles) {
    for (const [table, cols] of extractTables(readFileSync(join(migrationsDir, file), 'utf8'))) {
      tableCount += 1
      const pair = resolvePair(table)
      if (!pair) continue
      compared += 1
      const keys = new Set(pair.keys.map(normalizeFieldName))
      for (const col of cols) {
        if (!keys.has(normalizeFieldName(col))) violations.push(`${file}:${table}: column '${col}' has no zod key in ${pair.label}`)
      }
    }
  }
  if (compared === 0) {
    return {
      gate,
      status: 'fail',
      summary: `0 table↔schema pairs among ${tableCount} table(s) and ${schemaFiles.length} zod module(s)`,
      violations: [
        `no ${basename(migrationsDir)}/5NN-*.sql table maps to a zod object in ${basename(schemasDir)}/: name the object after the table ` +
          `(work_item → WorkItem / WorkItemSchema / workItemSchema) or pass tableToSchema`,
      ],
    }
  }
  return gateFromViolations(gate, violations, `${compared}/${tableCount} table(s) compared, columns match zod keys`)
}
