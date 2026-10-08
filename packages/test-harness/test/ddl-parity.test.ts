/** W1-10 self-test: DDL ↔ zod parity gate (good input passes, bad input fails). */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDdlZodParity, extractAddedColumns, extractTables, extractUnifiedTables, extractZodObjects, normalizeFieldName, type ParityOptions } from '../src/gates/ddl-parity.ts'

function layout(files: Record<string, string>, schemas: Record<string, string> | null): { migrationsDir: string; schemasDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'w1-10-parity-'))
  const migrationsDir = join(root, 'migrations')
  const schemasDir = join(root, 'schemas')
  mkdirSync(migrationsDir, { recursive: true })
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(migrationsDir, name), sql)
  if (schemas !== null) {
    mkdirSync(schemasDir, { recursive: true })
    for (const [name, src] of Object.entries(schemas)) writeFileSync(join(schemasDir, name), src)
  }
  return { migrationsDir, schemasDir }
}

/**
 * Run the gate with an injected allowlist (default: empty, file absent at
 * the merge-base) so self-tests never read the checked-in list or git.
 */
function run(dirs: { migrationsDir: string; schemasDir: string }, allowed: string[] = [], extra: Partial<ParityOptions> = {}) {
  return checkDdlZodParity({ ...dirs, allowlist: { entries: allowed, baseEntries: allowed }, ...extra })
}

// Shaped like 502-directory.sql: comments, two columns on one line, schema-qualified
// and multi-word types, arrays, table constraints, nested CHECK parens.
const SQL_502 = `-- 502 directory (W1-05)
CREATE TABLE user_profile (
  principal_id uuid PRIMARY KEY REFERENCES principal(principal_id),
  given_name text, family_name text,
  email public.citext NOT NULL,
  birthday date,
  score double precision CHECK (score >= 0 AND (score <= 100)),
  seen_at timestamp with time zone,
  tags text[] NOT NULL DEFAULT '{}',
  tsv tsvector,
  /* a block comment, with commas */
  person_type text NOT NULL DEFAULT 'member' CHECK (person_type IN ('member', 'guest')),
  CONSTRAINT user_profile_email_uniq UNIQUE (email),
  CHECK (length(given_name) > 0)
);
CREATE INDEX user_profile_name ON user_profile (family_name);
`
const GOOD_ZOD = `import { z } from 'zod'
export const UserProfileSchema = z.object({
  principalId: z.string().uuid(),
  givenName: z.string().nullable(), familyName: z.string().nullable(),
  email: z.string(),
  birthday: z.string().nullable(),
  score: z.number().nullable(),
  seenAt: z.string().nullable(),
  tags: z.array(z.string()),
  tsv: z.unknown(),
  personType: z.enum(['member', 'guest']),
  meta: z.object({ nested: z.string() }),
})
`

describe('ddl-zod-parity parser', () => {
  test('parses 502-style columns: multi-column lines, qualified/multi-word types, constraints skipped', () => {
    const tables = extractTables(SQL_502)
    expect([...tables.keys()]).toEqual(['user_profile'])
    expect(tables.get('user_profile')).toEqual([
      'principal_id', 'given_name', 'family_name', 'email', 'birthday', 'score', 'seen_at', 'tags', 'tsv', 'person_type',
    ])
  })
  test('schema-qualified table names and IF NOT EXISTS', () => {
    const tables = extractTables(`CREATE TABLE IF NOT EXISTS "public".kpi_entry (value numeric(12,2), period daterange);`)
    expect(tables.get('kpi_entry')).toEqual(['value', 'period'])
  })
  test('zod objects expose only their top-level keys', () => {
    expect(extractZodObjects(GOOD_ZOD).get('UserProfileSchema')).toContain('meta')
    expect(extractZodObjects(GOOD_ZOD).get('UserProfileSchema')).not.toContain('nested')
  })
  test('snake_case and camelCase normalise to the same key', () => {
    expect(normalizeFieldName('link_id')).toBe(normalizeFieldName('linkId'))
    expect(normalizeFieldName('seen_at')).toBe(normalizeFieldName('SeenAt'))
  })
})

// Shaped like #1502's 501/503: core tables extended with ALTER TABLE … ADD COLUMN.
const SQL_ALTER = `-- 501 principal extensions
ALTER TABLE principal
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent')),
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD CONSTRAINT principal_kind_chk CHECK (kind <> ''),
  ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE ONLY public.workspace ADD general_chat_id uuid;
DO $$ BEGIN
  CREATE TABLE never_parsed (x int);
  ALTER TABLE ghost ADD COLUMN y int;
END $$;
`
const PRINCIPAL_ZOD = `export const PrincipalSchema = z.object({ principalId: z.string(), kind: z.enum(['human', 'agent']), status: z.string() })
export const WorkspaceSchema = z.object({ workspaceId: z.string(), generalChatId: z.string().nullable() })
`

describe('ALTER TABLE … ADD COLUMN', () => {
  test('added columns are parsed; constraints, ALTER COLUMN and dollar-quoted bodies are not', () => {
    expect(Object.fromEntries(extractAddedColumns(SQL_ALTER))).toEqual({ principal: ['kind', 'status'], workspace: ['general_chat_id'] })
    const unified = extractUnifiedTables([{ file: '501-principal.sql', sql: SQL_ALTER }, { file: '502-directory.sql', sql: SQL_502 }])
    expect([...unified.keys()].sort()).toEqual(['principal', 'user_profile', 'workspace'])
    expect(unified.get('principal')).toEqual({ file: '501-principal.sql', cols: ['kind', 'status'] })
  })
  test('drift on an added column fails', () => {
    const res = run(layout({ '501-principal.sql': SQL_ALTER }, { 'directory.ts': PRINCIPAL_ZOD.replace(', status: z.string()', '') }))
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([`501-principal.sql:principal: column 'status' has no zod key in directory.ts#PrincipalSchema`])
    expect(run(layout({ '501-principal.sql': SQL_ALTER }, { 'directory.ts': PRINCIPAL_ZOD })).status).toBe('pass')
  })
})

describe('ddl-zod-parity gate', () => {
  test('passes when snake_case columns match camelCase zod keys', () => {
    const res = run(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD }))
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('1/1')
  })
  test('fails when a column has no zod key', () => {
    const res = run(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD.replace('  birthday: z.string().nullable(),\n', '') }))
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain(`column 'birthday'`)
  })
  test('both inputs present but zero pairs is a failure, not pending', () => {
    const res = run(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': `export const Unrelated = z.object({ id: z.string() })` }))
    expect(res.status).toBe('fail')
    expect(res.summary).toContain('0 table')
  })
  test('legacy <table>.ts file mapping and the tableToSchema override still pair', () => {
    const zod = `export const Anything = z.object({ ${GOOD_ZOD.split('z.object({')[1]!}`
    expect(run(layout({ '502-directory.sql': SQL_502 }, { 'user_profile.ts': zod })).status).toBe('pass')
    expect(run(layout({ '502-directory.sql': SQL_502 }, { 'people.ts': zod }), [], { tableToSchema: (t) => (t === 'user_profile' ? 'people.ts' : null) }).status).toBe('pass')
  })
  test('pending only while an input is absent, and only while the allowlist holds', () => {
    const noSchemas = run(layout({ '502-directory.sql': SQL_502 }, null), ['user_profile'])
    expect(noSchemas.status).toBe('pending')
    expect(noSchemas.summary).toContain('#1503')
    expect(noSchemas.summary).toContain('1 allowlisted unpaired')
    const no5nn = run(layout({ '01-domain-contract.sql': SQL_502, '48-license-audit.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD }))
    expect(no5nn.status).toBe('pending')
    expect(no5nn.summary).toContain('#1502')
    const emptySchemas = run(layout({ '502-directory.sql': SQL_502 }, { 'README.md': '# later' }), ['user_profile'])
    expect(emptySchemas.status).toBe('pending')
  })
})

describe('unpaired tables and the shrink-only allowlist', () => {
  const TWO = SQL_502 + `\nCREATE TABLE audit_trail (id uuid PRIMARY KEY, note text);\n`
  test('an unpaired table fails even when other tables pair (no silent N/M compared)', () => {
    const res = run(layout({ '502-directory.sql': TWO }, { 'directory.ts': GOOD_ZOD }))
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([
      '502-directory.sql:audit_trail: no zod schema (name it AuditTrail / AuditTrailSchema / auditTrailSchema) and not in packages/test-harness/allowlists/ddl-unpaired-tables.json',
    ])
    const allowed = run(layout({ '502-directory.sql': TWO }, { 'directory.ts': GOOD_ZOD }), ['audit_trail'])
    expect(allowed.status).toBe('pass')
    expect(allowed.summary).toContain('1/2 table(s) paired')
    expect(allowed.summary).toContain('1 allowlisted unpaired')
  })
  test('a new table without a schema fails before #1503 too (pending needs every table listed)', () => {
    const res = run(layout({ '502-directory.sql': TWO }, null), ['user_profile'])
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('audit_trail: no zod schema')
  })
  test('stale entries fail: the table now pairs, or is not a 5NN table at all', () => {
    const res = run(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD }), ['user_profile', 'dropped_table'])
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([
      '502-directory.sql:user_profile: now pairs with directory.ts#UserProfileSchema; remove it from the unpaired allowlist (the allowlist only shrinks)',
      "unpaired allowlist entry 'dropped_table' is not a table in the 5NN migrations; remove it",
    ])
  })
  test('an entry added since the merge-base fails', () => {
    const res = checkDdlZodParity({ ...layout({ '502-directory.sql': SQL_502 }, null), allowlist: { entries: ['user_profile'], baseEntries: [] } })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain("'user_profile' was added; the allowlist may only shrink")
  })
  test('the checked-in allowlist is well-formed, sorted and has no duplicates (it may shrink to empty)', async () => {
    const { readAllowlist } = await import('../src/gates/allowlist.ts')
    const read = readAllowlist(join(import.meta.dir, '..', '..', '..'), 'packages/test-harness/allowlists/ddl-unpaired-tables.json', 'tables')
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect([...read.entries].sort()).toEqual(read.entries)
    }
  })
})
