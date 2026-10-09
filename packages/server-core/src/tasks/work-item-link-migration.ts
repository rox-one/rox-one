/**
 * W1-06 (#1503) — MIG-03: PersonalTask `links[]` / `source` → `entity_link`
 * (DATA-MODEL §6.2).
 *
 * Writes into a local entity-link store (W1-02 `EntityLinkStore` or any
 * structurally compatible sink). Idempotent: an edge that already exists in
 * the sink is skipped, so a re-run never bumps a revision. Non-destructive:
 * the v2 `links[]` / `source` stay on the task (read-only for one release).
 *
 * Runtime trigger: the local link store is gated by `entities.links.v1`
 * (inert while off) and is per workspace, whereas personal tasks are
 * config-dir scoped, so the host decides which store receives the edges
 * (TSK-1 wires it). Until then nothing is lost: `toWorkItem` still exposes
 * the links (`legacyLinks`) and the origin.
 */

import { writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EntityLink, EntityRef, EntityRelation } from '@rox/core/entities'
import { migrateTaskLinks } from '@rox/core/tasks/personal'
import type { PersonalTaskPersistStore } from './personal-persist.ts'

export interface TaskLinkSink {
  add(input: { from: EntityRef; to: EntityRef; relation: EntityRelation; role?: string; createdBy: string }): unknown
  outgoing(ref: EntityRef): EntityLink[]
}

export interface TaskLinkMigrationReport {
  id: 'MIG-03'
  dryRun: boolean
  at: number
  tasks: number
  edges: number
  added: number
  existing: number
  failed: string[]
}

export interface TaskLinkMigrationOptions {
  createdBy?: string
  dryRun?: boolean
  now?: number
  /** Where the report goes (default `{configDir}/.craft/migrations/MIG-03.json`). */
  reportPath?: string | null
}

function sameEdge(link: EntityLink, to: EntityRef, relation: string): boolean {
  return link.relation === relation && link.to.kind === to.kind && link.to.id === to.id && (link.to.fragment ?? '') === (to.fragment ?? '')
}

export function migratePersonalTaskLinks(store: PersonalTaskPersistStore, sink: TaskLinkSink, options: TaskLinkMigrationOptions = {}): TaskLinkMigrationReport {
  const report: TaskLinkMigrationReport = {
    id: 'MIG-03', dryRun: options.dryRun === true, at: options.now ?? Date.now(), tasks: 0, edges: 0, added: 0, existing: 0, failed: [],
  }
  const createdBy = options.createdBy ?? store.ownerPrincipalId
  for (const { task } of store.list()) {
    const edges = migrateTaskLinks(task)
    if (edges.length === 0) continue
    report.tasks += 1
    try {
      const from: EntityRef = { kind: 'task', id: task.id }
      const current = sink.outgoing(from)
      for (const edge of edges) {
        report.edges += 1
        const to = edge.to as EntityRef
        if (current.some(link => sameEdge(link, to, edge.relation))) { report.existing += 1; continue }
        if (!report.dryRun) sink.add({ from, to, relation: edge.relation, ...(edge.role ? { role: edge.role } : {}), createdBy })
        report.added += 1
      }
    } catch {
      report.failed.push(task.id)
    }
  }
  const path = options.reportPath === undefined ? store.migrationReportPath('MIG-03') : options.reportPath
  if (path && !report.dryRun) {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${Date.now()}-${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(report)}\n`)
    renameSync(tmp, path)
  }
  return report
}
