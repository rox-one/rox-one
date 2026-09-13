/**
 * EntityRef + ExternalBinding registry with unique remote index and CAS (issue #320).
 */

import { createHash } from 'node:crypto'
import type { Rox2Entity, Rox2EntityKind, Rox2EntityRef, Rox2ExternalBinding } from './platform-contract.ts'
import { externalBindingKey, formatRox2EntityId, formatRox2EntityRef } from './platform-contract.ts'
import { quarantine, sha256Json, type Rox2Quarantine } from './ontology.ts'

export type Rox2IdentityRecord = {
  kind: Rox2EntityKind
  ref: Rox2EntityRef
  displayName: string
  binding?: Rox2ExternalBinding
}

export type Rox2IdentitySnapshot = {
  revision: number
  sha256: string
  records: Rox2IdentityRecord[]
  quarantined: Rox2Quarantine[]
}

export class Rox2RevisionConflict extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Rox2 identity CAS failed: expected ${expectedRevision}, actual ${actualRevision}`)
    this.name = 'Rox2RevisionConflict'
  }
}

export class Rox2IdentityRegistry {
  private records = new Map<string, Rox2IdentityRecord>()
  private byBinding = new Map<string, string>()
  private quarantined: Rox2Quarantine[] = []
  private revision = 0

  snapshot(): Rox2IdentitySnapshot {
    const records = [...this.records.values()].map((record) => structuredClone(record))
    const quarantined = this.quarantined.map((item) => structuredClone(item))
    return {
      revision: this.revision,
      sha256: sha256Json({ revision: this.revision, records, quarantined }),
      records,
      quarantined,
    }
  }

  get(kind: Rox2EntityKind, ref: Rox2EntityRef): Rox2IdentityRecord | undefined {
    return this.records.get(formatRox2EntityRef(kind, ref))
  }

  lookupBinding(binding: Rox2ExternalBinding): Rox2IdentityRecord | undefined {
    const key = this.byBinding.get(externalBindingKey(binding))
    return key ? this.records.get(key) : undefined
  }

  /**
   * Import or upsert. Re-importing the same remote binding returns the existing
   * record and does not mint a duplicate. Same remoteId on another account is distinct.
   */
  importRecord(record: Rox2IdentityRecord, expectedRevision?: number): Rox2IdentityRecord {
    this.assertCas(expectedRevision)
    if (record.binding) {
      const existingKey = this.byBinding.get(externalBindingKey(record.binding))
      if (existingKey) {
        const existing = this.records.get(existingKey)
        if (!existing) throw new Error('Rox2 binding index is corrupt')
        const renamed: Rox2IdentityRecord = {
          ...existing,
          displayName: record.displayName,
          ref: { ...existing.ref, revisionId: record.ref.revisionId || existing.ref.revisionId },
        }
        if (existing.ref.entityId !== record.ref.entityId || existing.ref.workspaceId !== record.ref.workspaceId) {
          this.quarantined.push(quarantine('collision', { incoming: record, existing }))
        }
        this.records.set(existingKey, renamed)
        this.revision += 1
        return renamed
      }
    }
    const key = formatRox2EntityRef(record.kind, record.ref)
    this.records.set(key, structuredClone(record))
    if (record.binding) this.byBinding.set(externalBindingKey(record.binding), key)
    this.revision += 1
    return record
  }

  rename(kind: Rox2EntityKind, ref: Rox2EntityRef, displayName: string, expectedRevision?: number): Rox2IdentityRecord {
    this.assertCas(expectedRevision)
    const key = formatRox2EntityRef(kind, ref)
    const existing = this.records.get(key)
    if (!existing) throw new Error(`Unknown Rox2 entity ${key}`)
    const next = { ...existing, displayName }
    this.records.set(key, next)
    this.revision += 1
    return next
  }

  toEntity(record: Rox2IdentityRecord): Rox2Entity {
    return {
      id: formatRox2EntityId(record.kind, record.ref.entityId),
      kind: record.kind,
      displayName: record.displayName,
      workspaceId: record.ref.workspaceId,
      source: record.binding ? 'hybrid' : 'native',
      permissions: ['read'],
      updatedAt: Date.now(),
      ref: record.ref,
      binding: record.binding,
    }
  }

  restore(snapshot: Rox2IdentitySnapshot, expectedRevision?: number): void {
    this.assertCas(expectedRevision)
    const next = new Map<string, Rox2IdentityRecord>()
    const byBinding = new Map<string, string>()
    for (const record of snapshot.records) {
      const key = formatRox2EntityRef(record.kind, record.ref)
      next.set(key, structuredClone(record))
      if (record.binding) byBinding.set(externalBindingKey(record.binding), key)
    }
    this.records = next
    this.byBinding = byBinding
    this.quarantined = snapshot.quarantined.map((item) => structuredClone(item))
    this.revision = snapshot.revision
  }

  private assertCas(expectedRevision?: number): void {
    if (expectedRevision == null) return
    if (expectedRevision !== this.revision) {
      throw new Rox2RevisionConflict(expectedRevision, this.revision)
    }
  }
}

export function fingerprintRecord(record: Rox2IdentityRecord): string {
  return createHash('sha256').update(sha256Json(record), 'utf8').digest('hex')
}
