/**
 * W1-04 (#1501) — Directory read model port, Postgres adapter and in-memory
 * adapter (tests, local composition). Read-only.
 */

import type { SQL, TransactionSQL } from 'bun'
import {
  MAX_DIRECTORY_PAGE,
  MAX_MANAGER_CHAIN,
  sqlDepartmentMembers,
  sqlDepartments,
  sqlDirectReports,
  sqlManagerChain,
  sqlMembers,
  sqlPrincipal,
} from './queries.ts'

type Database = SQL | TransactionSQL

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DirectoryPrincipalKind = 'human' | 'bot' | 'guest' | 'service'
export type DirectoryPrincipalStatus = 'active' | 'placeholder' | 'deactivated'
export type DirectoryMemberStatus = 'invited' | 'active' | 'left' | 'removed'

export interface DirectoryEntry {
  principalId: string
  kind: DirectoryPrincipalKind
  status: DirectoryPrincipalStatus
  memberRole: 'owner' | 'member'
  memberStatus: DirectoryMemberStatus
  displayName: string | null
  givenName: string | null
  familyName: string | null
  username: string | null
  avatarUrl: string | null
  title: string | null
  managerId: string | null
  timeZone: string | null
  locale: string | null
  departmentIds: string[]
}

export interface DirectoryDepartmentEntry {
  departmentId: string
  parentId: string | null
  name: string
  headId: string | null
}

export interface DirectoryPage {
  members: DirectoryEntry[]
  nextCursor: string | null
}

/** Read port the directory service depends on (Postgres or in-memory). */
export interface DirectoryReadPort {
  members(workspaceId: string, limit: number, after?: string): Promise<DirectoryPage>
  principal(workspaceId: string, principalId: string): Promise<DirectoryEntry | null>
  departments(workspaceId: string): Promise<DirectoryDepartmentEntry[]>
  departmentMembers(workspaceId: string, departmentId: string): Promise<string[]>
  managerChain(workspaceId: string, principalId: string): Promise<string[]>
  directReports(workspaceId: string, managerId: string): Promise<string[]>
}

interface PrincipalRow {
  principal_id: string
  kind: DirectoryPrincipalKind
  status: DirectoryPrincipalStatus | null
  member_role: 'owner' | 'member'
  member_status: DirectoryMemberStatus | null
  display_name: string | null
  given_name: string | null
  family_name: string | null
  username: string | null
  avatar_url: string | null
  title: string | null
  manager_id: string | null
  time_zone: string | null
  locale: string | null
  department_ids: string[] | null
}

/** Pure row mapper (exported for tests). */
export function entryFromRow(row: PrincipalRow): DirectoryEntry {
  return {
    principalId: row.principal_id,
    kind: row.kind,
    status: row.status ?? 'active',
    memberRole: row.member_role,
    memberStatus: row.member_status ?? 'active',
    displayName: row.display_name,
    givenName: row.given_name,
    familyName: row.family_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    title: row.title,
    managerId: row.manager_id,
    timeZone: row.time_zone,
    locale: row.locale,
    departmentIds: row.department_ids ?? [],
  }
}

function clampLimit(limit: number): number {
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_DIRECTORY_PAGE) : 100
}

export class PostgresDirectoryRepository implements DirectoryReadPort {
  private readonly prefix: string

  constructor(private readonly database: Database, schema = 'public') {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid directory database schema')
    this.prefix = `"${schema}".`
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return await this.database.unsafe<T[]>(sql, params)
  }

  async members(workspaceId: string, limit: number, after = ''): Promise<DirectoryPage> {
    if (!UUID.test(workspaceId)) return { members: [], nextCursor: null }
    const size = clampLimit(limit)
    const rows = await this.query<PrincipalRow>(sqlMembers(this.prefix), [workspaceId, size + 1, after])
    const members = rows.slice(0, size).map(entryFromRow)
    return { members, nextCursor: rows.length > size ? members.at(-1)!.principalId : null }
  }

  async principal(workspaceId: string, principalId: string): Promise<DirectoryEntry | null> {
    if (!UUID.test(workspaceId) || !UUID.test(principalId)) return null
    const [row] = await this.query<PrincipalRow>(sqlPrincipal(this.prefix), [workspaceId, principalId])
    return row ? entryFromRow(row) : null
  }

  async departments(workspaceId: string): Promise<DirectoryDepartmentEntry[]> {
    if (!UUID.test(workspaceId)) return []
    const rows = await this.query<{ department_id: string; parent_id: string | null; name: string; head_id: string | null }>(
      sqlDepartments(this.prefix), [workspaceId])
    return rows.map(r => ({ departmentId: r.department_id, parentId: r.parent_id, name: r.name, headId: r.head_id }))
  }

  async departmentMembers(workspaceId: string, departmentId: string): Promise<string[]> {
    if (!UUID.test(workspaceId) || !UUID.test(departmentId)) return []
    const rows = await this.query<{ principal_id: string }>(sqlDepartmentMembers(this.prefix), [workspaceId, departmentId])
    return rows.map(r => r.principal_id)
  }

  async managerChain(workspaceId: string, principalId: string): Promise<string[]> {
    if (!UUID.test(workspaceId) || !UUID.test(principalId)) return []
    const rows = await this.query<{ principal_id: string }>(sqlManagerChain(this.prefix), [workspaceId, principalId, MAX_MANAGER_CHAIN])
    return rows.map(r => r.principal_id)
  }

  async directReports(workspaceId: string, managerId: string): Promise<string[]> {
    if (!UUID.test(workspaceId) || !UUID.test(managerId)) return []
    const rows = await this.query<{ principal_id: string }>(sqlDirectReports(this.prefix), [workspaceId, managerId])
    return rows.map(r => r.principal_id)
  }
}

/** In-memory directory (tests and the local single-user composition). */
export class MemoryDirectoryRepository implements DirectoryReadPort {
  private readonly entries = new Map<string, Map<string, DirectoryEntry>>()
  private readonly depts = new Map<string, Map<string, DirectoryDepartmentEntry & { members: string[] }>>()

  setEntry(workspaceId: string, entry: DirectoryEntry): void {
    let ws = this.entries.get(workspaceId)
    if (!ws) this.entries.set(workspaceId, ws = new Map())
    ws.set(entry.principalId, { ...entry, departmentIds: [...entry.departmentIds] })
  }

  setDepartment(workspaceId: string, department: DirectoryDepartmentEntry, members: readonly string[] = []): void {
    let ws = this.depts.get(workspaceId)
    if (!ws) this.depts.set(workspaceId, ws = new Map())
    ws.set(department.departmentId, { ...department, members: [...members].sort() })
  }

  private active(workspaceId: string): DirectoryEntry[] {
    return [...(this.entries.get(workspaceId)?.values() ?? [])]
      .filter(e => e.memberStatus === 'active')
      .sort((a, b) => a.principalId.localeCompare(b.principalId))
  }

  async members(workspaceId: string, limit: number, after = ''): Promise<DirectoryPage> {
    const size = clampLimit(limit)
    const rows = this.active(workspaceId).filter(e => after === '' || e.principalId > after)
    const members = rows.slice(0, size).map(e => ({ ...e, departmentIds: [...e.departmentIds] }))
    return { members, nextCursor: rows.length > size ? members.at(-1)!.principalId : null }
  }

  async principal(workspaceId: string, principalId: string): Promise<DirectoryEntry | null> {
    const entry = this.entries.get(workspaceId)?.get(principalId)
    return entry ? { ...entry, departmentIds: [...entry.departmentIds] } : null
  }

  async departments(workspaceId: string): Promise<DirectoryDepartmentEntry[]> {
    return [...(this.depts.get(workspaceId)?.values() ?? [])]
      .map(({ members: _members, ...d }) => d)
      .sort((a, b) => a.name.localeCompare(b.name) || a.departmentId.localeCompare(b.departmentId))
  }

  async departmentMembers(workspaceId: string, departmentId: string): Promise<string[]> {
    const active = new Set(this.active(workspaceId).map(e => e.principalId))
    return (this.depts.get(workspaceId)?.get(departmentId)?.members ?? []).filter(id => active.has(id))
  }

  async managerChain(workspaceId: string, principalId: string): Promise<string[]> {
    const ws = this.entries.get(workspaceId)
    const chain: string[] = []
    const seen = new Set([principalId])
    let current = ws?.get(principalId)?.managerId ?? null
    while (current && !seen.has(current) && chain.length < MAX_MANAGER_CHAIN) {
      seen.add(current)
      if (ws?.has(current)) chain.push(current)
      current = ws?.get(current)?.managerId ?? null
    }
    return chain
  }

  async directReports(workspaceId: string, managerId: string): Promise<string[]> {
    return this.active(workspaceId).filter(e => e.managerId === managerId).map(e => e.principalId)
  }
}
