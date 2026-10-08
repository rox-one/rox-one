/**
 * W1-10 (#1507) — DDL ↔ zod parity gate.
 *
 * Compares SQL in `apps/workspace-service/migrations/*.sql` (owner #1502)
 * against zod schemas in `packages/shared/src/domain/*` (owner #1503).
 * Missing input → pending. Column ↔ key comparison runs only for tables
 * that map to a schema file; the default mapping is `snake_case` table →
 * `<table>.ts` or `<table>.schema.ts` in the schemas dir (override via
 * `tableToSchema`). Both the SQL column parser and the zod key scanner
 * are dependency-free on purpose.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'

export interface ParityOptions {
  repoRoot?: string
  migrationsDir?: string
  schemasDir?: string
  tableToSchema?: (table: string) => string | null
}

function defaultRoot(): string {
  return join(import.meta.dir, '..', '..', '..', '..')
}

export function extractTables(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(([\s\S]*?)\);/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const [, name, body] = m
    const cols: string[] = []
    for (const line of body.split('\n')) {
      const cm = /^\s*["']?([a-z][a-z0-9_]*)["']?\s+(?:text|integer|bigint|boolean|jsonb?|timestamptz|timestamp|uuid|numeric|real|bytea|serial|bigserial)\b/i.exec(line)
      if (cm) cols.push(cm[1])
    }
    tables.set(name, cols)
  }
  return tables
}

const ZOD_KEY_RE = /(?:[{,\n]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\./

export function extractZodKeys(source: string): string[] {
  const keys: string[] = []
  const re = new RegExp(ZOD_KEY_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) keys.push(m[1])
  return [...new Set(keys)]
}

function defaultTableToSchema(schemasDir: string): (table: string) => string | null {
  return (table: string) => {
    for (const cand of [`${table}.ts`, `${table}.schema.ts`]) {
      if (existsSync(join(schemasDir, cand))) return cand
    }
    return null
  }
}

export function checkDdlZodParity(opts: ParityOptions = {}): GateResult {
  const root = opts.migrationsDir && opts.schemasDir ? '' : (opts.repoRoot ?? defaultRoot())
  const migrationsDir = opts.migrationsDir ?? join(root, 'apps', 'workspace-service', 'migrations')
  const schemasDir = opts.schemasDir ?? join(root, 'packages', 'shared', 'src', 'domain')
  const gate = 'ddl-zod-parity'

  if (!existsSync(migrationsDir)) return pending(gate, 'apps/workspace-service/migrations/*.sql', '1502')
  if (!existsSync(schemasDir)) return pending(gate, 'packages/shared/src/domain/*', '1503')

  const mapFn = opts.tableToSchema ?? defaultTableToSchema(schemasDir)
  const violations: string[] = []
  let compared = 0
  const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  for (const file of sqlFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    for (const [table, cols] of extractTables(sql)) {
      const schemaFile = mapFn(table)
      if (!schemaFile) continue
      compared += 1
      const keys = new Set(extractZodKeys(readFileSync(join(schemasDir, schemaFile), 'utf8')))
      for (const col of cols) {
        if (!keys.has(col)) violations.push(`${file}:${table}: column '${col}' has no zod key in ${schemaFile}`)
      }
    }
  }
  if (compared === 0) {
    return {
      gate,
      status: 'pending',
      summary: 'pending (no table↔schema pairs discovered; DDL or zod input not landed yet, #1502/#1503)',
    }
  }
  return gateFromViolations(gate, violations, `${compared} table(s) compared, columns match zod keys`)
}

export function parityInputHint(): string {
  return basename('apps/workspace-service/migrations/*.sql')
}
