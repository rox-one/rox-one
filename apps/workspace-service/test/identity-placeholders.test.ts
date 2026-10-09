/**
 * W1-11 (#1508) — The identity SQL bridge against the real DDL
 * (`513-identity-lifecycle.sql`, DATA-MODEL §5.11).
 *
 * No database is started: the migrations in this repo are the source of truth
 * for the columns, so the test parses them and fails for any column or
 * invariant a statement references that the DDL does not declare. That is the
 * drift check that keeps the wave-2 identity module (ONB) honest.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GENERAL_CHAT_UNIQUE,
  INVITATION_PENDING_UNIQUE,
  PLACEHOLDER_DDL_FILES,
  activatePlaceholder,
  createWorkspaceWithGeneralChat,
  insertInvitation,
  insertPendingChatMember,
  insertPlaceholderPrincipal,
  mergePlaceholderStatements,
} from '../src/modules/identity/placeholders.ts'

const MIGRATIONS = join(import.meta.dir, '../migrations')

function migrationText(): string {
  return PLACEHOLDER_DDL_FILES.map(file => readFileSync(join(MIGRATIONS, file), 'utf8')).join('\n')
}

/** Columns declared by `CREATE TABLE` and `ALTER TABLE … ADD COLUMN`. */
function declaredColumns(sql: string): Map<string, Set<string>> {
  const columns = new Map<string, Set<string>>()
  const ensure = (table: string): Set<string> => {
    const existing = columns.get(table)
    if (existing) return existing
    const created = new Set<string>()
    columns.set(table, created)
    return created
  }
  for (const match of sql.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const table = match[1] as string
    const body = match[2] as string
    for (const line of body.split('\n')) {
      const column = /^\s{2}(\w+)\s/.exec(line)
      if (column) ensure(table).add(column[1] as string)
    }
  }
  for (const match of sql.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) {
    const table = match[1] as string
    const body = match[2] as string
    for (const column of body.matchAll(/ADD COLUMN (\w+)/g)) ensure(table).add(column[1] as string)
  }
  return columns
}

/** Columns a statement references: INSERT column lists and UPDATE assignments. */
function referencedColumns(statement: string): Array<{ table: string; column: string }> {
  const references: Array<{ table: string; column: string }> = []
  for (const match of statement.matchAll(/INSERT INTO (?:\w+\.)?(\w+)\s*\(([^)]*)\)/g)) {
    const table = match[1] as string
    for (const column of (match[2] as string).split(',')) references.push({ table, column: column.trim() })
  }
  for (const match of statement.matchAll(/UPDATE (?:\w+\.)?(\w+)\s+SET([\s\S]*?)(?:WHERE|$)/g)) {
    const table = match[1] as string
    for (const assignment of (match[2] as string).matchAll(/(\w+)\s*=/g)) references.push({ table, column: assignment[1] as string })
  }
  return references
}

/**
 * Columns the contract requires but W1-05's migration does not declare yet.
 * Kept explicit so the exception cannot grow silently: the last test in this
 * file asserts the list is exactly this one entry and that the migration really
 * lacks it. Wave 2 adds `principal.merged_into` (see UNDONE in the W1-11
 * report); W1-11 does not author migrations.
 */
const PENDING_DDL_COLUMNS: readonly string[] = ['principal.merged_into']

const ALL_STATEMENTS: Array<[string, string]> = [
  ['createWorkspaceWithGeneralChat', createWorkspaceWithGeneralChat()],
  ['insertPlaceholderPrincipal', insertPlaceholderPrincipal()],
  ['insertInvitation', insertInvitation()],
  ['insertPendingChatMember', insertPendingChatMember()],
  ['activatePlaceholder', activatePlaceholder()],
  ...mergePlaceholderStatements().map((statement, index) => [`mergePlaceholderStatements[${index}]`, statement] as [string, string]),
]

describe('identity lifecycle SQL against the DDL', () => {
  const columns = declaredColumns(migrationText())

  it('parses the DDL it depends on', () => {
    for (const table of ['workspace', 'principal', 'invitation', 'chat', 'chat_member', 'workspace_member', 'work_item_member', 'entity_link', 'message', 'auth_subject_alias']) {
      expect(columns.get(table), table).toBeDefined()
      expect(columns.get(table)?.size, table).toBeGreaterThan(0)
    }
    expect(columns.get('workspace')).toContain('general_chat_id')
    expect(columns.get('principal')).toContain('status')
    expect(columns.get('principal')).toContain('primary_email')
    expect(columns.get('chat')).toContain('system_role')
    expect(columns.get('chat')).toContain('posting_policy')
    expect(columns.get('chat')).toContain('invite_policy')
    expect(columns.get('workspace_member')).toContain('status')
  })

  for (const [name, statement] of ALL_STATEMENTS) {
    it(`${name} references only declared columns`, () => {
      const references = referencedColumns(statement)
      // A DELETE has no column list; every INSERT / UPDATE must have one.
      if (!statement.trimStart().startsWith('DELETE')) {
        expect(references.length, `${name} must reference at least one column`).toBeGreaterThan(0)
      }
      for (const { table, column } of references) {
        const key = `${table}.${column}`
        if (PENDING_DDL_COLUMNS.includes(key)) continue
        const declared = columns.get(table)
        expect(declared, `${name}: table ${table} is not in the DDL`).toBeDefined()
        expect(declared?.has(column), `${name}: ${key} is not declared in the DDL`).toBe(true)
      }
    })
  }

  it('the merge re-points other tables and only deactivates the principal row', () => {
    const statements = mergePlaceholderStatements()
    expect(statements).toHaveLength(9)
    // The placeholder's row is never rewritten to the account: it is deactivated.
    const principalStatement = statements[statements.length - 1] as string
    expect(principalStatement).toMatch(/UPDATE principal\s+SET status = 'deactivated', merged_into = \$2/)
    expect(principalStatement).not.toMatch(/SET principal_id/)
    // Every other collection does move to the account.
    const repointing = statements.slice(0, -1).join('\n')
    expect(repointing).toContain('UPDATE chat_member SET principal_id = $2')
    expect(repointing).toContain('UPDATE workspace_member SET principal_id = $2')
    expect(repointing).toContain('UPDATE work_item_member SET principal_id = $2')
    expect(repointing).toContain('UPDATE entity_link SET from_id = $2')
    expect(repointing).toContain('UPDATE entity_link SET to_id = $2')
    expect(repointing).toContain('UPDATE message SET mentions = array_replace')
  })

  it('the pending-column exception is exactly one entry, and the DDL really lacks it', () => {
    expect([...PENDING_DDL_COLUMNS]).toEqual(['principal.merged_into'])
    for (const key of PENDING_DDL_COLUMNS) {
      const [table, column] = key.split('.') as [string, string]
      expect(columns.get(table)?.has(column), `${key} should be missing from the W1-05 DDL`).toBe(false)
    }
  })

  it('the invariants the migration pins exist', () => {
    const sql = migrationText()
    expect(sql).toContain(`CREATE UNIQUE INDEX ${INVITATION_PENDING_UNIQUE}`)
    expect(sql).toContain(`CREATE UNIQUE INDEX ${GENERAL_CHAT_UNIQUE}`)
    expect(sql).toContain('chat_general_public')
    // A General chat is a public group by constraint, and it is unique per workspace.
    expect(sql).toMatch(/chat_general_public[\s\S]*kind = 'group' AND visibility = 'public'/)
  })

  it('a schema-qualified statement quotes the schema', () => {
    expect(createWorkspaceWithGeneralChat('workspace_1')).toContain('"workspace_1".workspace')
    expect(insertInvitation('workspace_1')).toContain('"workspace_1".invitation')
    expect(mergePlaceholderStatements('workspace_1')[4]).toContain('"workspace_1".work_item_member')
  })
})