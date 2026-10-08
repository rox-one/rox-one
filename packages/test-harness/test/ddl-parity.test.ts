/** W1-10 self-test: DDL ↔ zod parity gate (good input passes, bad input fails). */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDdlZodParity, extractTables, extractZodObjects, normalizeFieldName } from '../src/gates/ddl-parity.ts'

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

describe('ddl-zod-parity gate', () => {
  test('passes when snake_case columns match camelCase zod keys', () => {
    const res = checkDdlZodParity(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD }))
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('1/1')
  })
  test('fails when a column has no zod key', () => {
    const res = checkDdlZodParity(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD.replace('  birthday: z.string().nullable(),\n', '') }))
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain(`column 'birthday'`)
  })
  test('both inputs present but zero pairs is a failure, not pending', () => {
    const res = checkDdlZodParity(layout({ '502-directory.sql': SQL_502 }, { 'directory.ts': `export const Unrelated = z.object({ id: z.string() })` }))
    expect(res.status).toBe('fail')
    expect(res.summary).toContain('0 table')
  })
  test('legacy <table>.ts file mapping and the tableToSchema override still pair', () => {
    const zod = `export const Anything = z.object({ ${GOOD_ZOD.split('z.object({')[1]!}`
    expect(checkDdlZodParity(layout({ '502-directory.sql': SQL_502 }, { 'user_profile.ts': zod })).status).toBe('pass')
    expect(checkDdlZodParity({ ...layout({ '502-directory.sql': SQL_502 }, { 'people.ts': zod }), tableToSchema: (t) => (t === 'user_profile' ? 'people.ts' : null) }).status).toBe('pass')
  })
  test('pending only while an input is absent', () => {
    const noSchemas = checkDdlZodParity(layout({ '502-directory.sql': SQL_502 }, null))
    expect(noSchemas.status).toBe('pending')
    expect(noSchemas.summary).toContain('#1503')
    const no5nn = checkDdlZodParity(layout({ '01-domain-contract.sql': SQL_502, '48-license-audit.sql': SQL_502 }, { 'directory.ts': GOOD_ZOD }))
    expect(no5nn.status).toBe('pending')
    expect(no5nn.summary).toContain('#1502')
    const emptySchemas = checkDdlZodParity(layout({ '502-directory.sql': SQL_502 }, { 'README.md': '# later' }))
    expect(emptySchemas.status).toBe('pending')
  })
})
