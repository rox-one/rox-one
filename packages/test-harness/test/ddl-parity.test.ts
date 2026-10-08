/** W1-10 self-test: DDL ↔ zod parity gate (good input passes, bad input fails). */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDdlZodParity } from '../src/gates/ddl-parity.ts'

function layout(sql: string, schema: string | null): { migrationsDir: string; schemasDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'w1-10-parity-'))
  const migrationsDir = join(root, 'migrations')
  const schemasDir = join(root, 'schemas')
  mkdirSync(migrationsDir, { recursive: true })
  mkdirSync(schemasDir, { recursive: true })
  writeFileSync(join(migrationsDir, '02-test.sql'), sql)
  if (schema !== null) writeFileSync(join(schemasDir, 'goal.ts'), schema)
  return { migrationsDir, schemasDir }
}

const GOOD_SQL = `CREATE TABLE goal (
  id text PRIMARY KEY,
  title text NOT NULL,
  progress integer NOT NULL DEFAULT 0
);`
const GOOD_SCHEMA = `import { z } from 'zod';
export const Goal = z.object({ id: z.string(), title: z.string(), progress: z.number() });`
const BAD_SCHEMA = `import { z } from 'zod';
export const Goal = z.object({ id: z.string(), title: z.string() });`

describe('ddl-zod-parity gate', () => {
  test('passes on matching DDL and zod', () => {
    const { migrationsDir, schemasDir } = layout(GOOD_SQL, GOOD_SCHEMA)
    const res = checkDdlZodParity({ migrationsDir, schemasDir })
    expect(res.status).toBe('pass')
  })
  test('fails when a column has no zod key', () => {
    const { migrationsDir, schemasDir } = layout(GOOD_SQL, BAD_SCHEMA)
    const res = checkDdlZodParity({ migrationsDir, schemasDir })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('progress')
  })
  test('pending when the schemas dir is missing (#1503 not landed)', () => {
    const { migrationsDir } = layout(GOOD_SQL, GOOD_SCHEMA)
    const res = checkDdlZodParity({ migrationsDir, schemasDir: join(migrationsDir, 'nope') })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('#1503')
  })
})
