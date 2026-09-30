import { z } from 'zod'
import type { RoxCommand } from '../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { AuditReleaseLicense, LicenseAuditResult, LicenseComponent, LicenseEventPage, LicensePage } from '../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import { ProjectAuthorityError } from './project-authority'

export const LICENSE_PAGE_LIMIT = 25
export const MAX_LICENSE_EVIDENCE_ENTRIES = 100000
export const MAX_LICENSE_EVIDENCE_TEXT = 4096
export const MAX_LICENSE_EVENT_REPLAY_PAGES = 100
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const decimal = z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const revision = z.string().regex(/^[0-9a-f]{40}$/)
const timestamp = z.string().datetime()
const entityId = z.string().regex(/^license-component:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const entity = z.object({ workspaceId: uuid, entityId, revisionId: decimal }).strict()
const reference = z.object({ resourceId: uuid, policyEpoch: decimal, reviewRevision: revision, reviewSha256: digest,
  checkerRevision: revision, checkerSha256: digest, buildSha256: digest }).strict()
const payload = z.object({ artifactDigest: digest, sbomDigest: digest, decisionManifest: reference }).strict()
const evidence = z.object({ state: z.enum(['review_required', 'reviewed_exact_artifact']),
  findings: z.array(z.object({ code: z.string().min(1).max(256), subject: z.string().max(MAX_LICENSE_EVIDENCE_TEXT) }).strict()).max(MAX_LICENSE_EVIDENCE_ENTRIES),
  components: z.array(z.object({ id: z.string().min(1).max(256), name: z.string().min(1).max(256), version: z.string().max(256),
    componentSha256: digest, licenseExpression: z.string().max(MAX_LICENSE_EVIDENCE_TEXT).nullable() }).strict()).max(MAX_LICENSE_EVIDENCE_ENTRIES),
}).strict()
const component = z.object({ entity, label: z.string().min(1).max(256), revision: decimal, policyEpoch: decimal,
  artifactDigest: digest, sbomDigest: digest, decisionManifest: reference, evidence: evidence.nullable(),
  auditDigest: digest.nullable(), auditedAt: timestamp.nullable(), projectionWatermark: decimal,
  canAudit: z.boolean(), permissionMode: z.literal('owner_bootstrap'),
}).strict().superRefine((value, context) => {
  if (value.entity.revisionId !== value.revision || value.entity.entityId !== 'license-component:' + value.decisionManifest.resourceId
    || value.decisionManifest.policyEpoch !== value.policyEpoch
    || (value.evidence === null) !== (value.auditDigest === null) || (value.auditDigest === null) !== (value.auditedAt === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent license reference' })
  }
})
const command = z.object({ commandId: z.string().min(1).max(256), schemaVersion: z.literal(2), workspaceId: uuid,
  idempotencyKey: z.string().min(1).max(256), expectedRevision: decimal, payload }).strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return parsed.data
}
export function requireLicenseComponent(value: unknown, workspaceId: string): LicenseComponent {
  const parsed = parse(component, value)
  if (parsed.entity.workspaceId !== workspaceId) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
  return parsed
}
export function requireLicensePage(value: unknown, workspaceId: string): LicensePage {
  const parsed = parse(z.object({ items: z.array(component).max(LICENSE_PAGE_LIMIT), nextCursor: uuid.optional() }).strict(), value)
  for (const item of parsed.items) requireLicenseComponent(item, workspaceId)
  if (new Set(parsed.items.map(item => item.entity.entityId)).size !== parsed.items.length) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return parsed
}
export function requireLicenseCommand(value: unknown): RoxCommand<AuditReleaseLicense> { return parse(command, value) }
export function createLicenseAuditIntent(localWorkspaceId: string, value: LicenseComponent): RoxCommand<AuditReleaseLicense> {
  return requireLicenseCommand({ commandId: crypto.randomUUID(), schemaVersion: 2, workspaceId: localWorkspaceId,
    idempotencyKey: crypto.randomUUID(), expectedRevision: value.revision,
    payload: { artifactDigest: value.artifactDigest, sbomDigest: value.sbomDigest, decisionManifest: value.decisionManifest } })
}
export async function licenseCommandRequestHash(value: RoxCommand<AuditReleaseLicense>): Promise<string> {
  const intent = requireLicenseCommand(value)
  const bytes = new TextEncoder().encode(JSON.stringify({ action: 'audit.releaseLicense', schemaVersion: 2,
    workspaceId: intent.workspaceId, expectedRevision: intent.expectedRevision, payload: intent.payload }))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function requireLicenseAuditResult(value: unknown, intent: RoxCommand<AuditReleaseLicense>, workspaceId: string): Promise<LicenseAuditResult> {
  const parsed = parse(z.object({ ok: z.literal(true), executionMode: z.literal('live'), lifecycle: z.literal('succeeded'),
    verification: z.literal('receipt_verified'), status: z.literal('applied'), commandId: z.string(), requestHash: digest,
    observedRevision: decimal, entity, entityId, receiptId: uuid, verifiedAt: timestamp, data: component,
    receipt: z.object({ provider: z.literal('rox-workspace'), remoteId: entityId, requestId: z.string(),
      observedRevision: decimal, verifiedAt: timestamp }).strict(),
  }).strict(), value)
  const data = requireLicenseComponent(parsed.data, workspaceId)
  if (intent.workspaceId !== workspaceId || intent.expectedRevision === undefined || parsed.commandId !== intent.commandId || parsed.receipt.requestId !== intent.commandId
    || parsed.entityId !== data.entity.entityId || parsed.entity.entityId !== data.entity.entityId
    || parsed.entity.workspaceId !== workspaceId || parsed.entity.revisionId !== data.revision
    || parsed.receipt.remoteId !== data.entity.entityId || parsed.receipt.observedRevision !== data.revision
    || parsed.observedRevision !== data.revision || parsed.receipt.verifiedAt !== parsed.verifiedAt || parsed.verifiedAt !== data.auditedAt
    || data.revision !== String(BigInt(intent.expectedRevision) + 1n)
    || data.artifactDigest !== intent.payload.artifactDigest || data.sbomDigest !== intent.payload.sbomDigest
    || JSON.stringify(data.decisionManifest) !== JSON.stringify(intent.payload.decisionManifest) || data.evidence === null) {
    throw new ProjectAuthorityError('INVALID_PAYLOAD')
  }
  if (parsed.requestHash !== await licenseCommandRequestHash(intent)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return parsed
}
/** Retained audit identity stays exact while a fresh authorized read may advance Resource policy. */
export function requireLicenseAuditReadback(value: unknown, result: LicenseAuditResult): LicenseComponent {
  const readback = requireLicenseComponent(value, result.entity.workspaceId)
  const original = requireLicenseComponent(result.data, result.entity.workspaceId)
  const retainedAudit = (view: LicenseComponent) => ({
    entity: view.entity, label: view.label, revision: view.revision, artifactDigest: view.artifactDigest,
    sbomDigest: view.sbomDigest, evidence: view.evidence, auditDigest: view.auditDigest, auditedAt: view.auditedAt,
    projectionWatermark: view.projectionWatermark, permissionMode: view.permissionMode,
    decisionManifest: { resourceId: view.decisionManifest.resourceId, reviewRevision: view.decisionManifest.reviewRevision,
      reviewSha256: view.decisionManifest.reviewSha256, checkerRevision: view.decisionManifest.checkerRevision,
      checkerSha256: view.decisionManifest.checkerSha256, buildSha256: view.decisionManifest.buildSha256 },
  })
  if (BigInt(readback.policyEpoch) < BigInt(original.policyEpoch)
    || (readback.policyEpoch === original.policyEpoch && readback.canAudit !== original.canAudit)
    || JSON.stringify(retainedAudit(readback)) !== JSON.stringify(retainedAudit(original))) {
    throw new ProjectAuthorityError('INVALID_PAYLOAD')
  }
  return readback
}
export function requireLicenseEvents(value: unknown, workspaceId: string, requestedEntityId: string): LicenseEventPage {
  const event = z.object({ id: uuid, type: z.literal('audit.license_reviewed'), workspaceId: uuid, entityRef: entity,
    actorPrincipalId: uuid, schemaVersion: z.literal(1), aggregateRevision: decimal, policyEpoch: decimal,
    causationId: z.string().min(1).max(256), correlationId: z.string().min(1).max(256), at: timestamp,
    payload: z.object({ entityId, artifactDigest: digest, sbomDigest: digest, auditDigest: digest }).strict(),
  }).strict()
  const parsed = parse(z.object({ events: z.array(event).max(LICENSE_PAGE_LIMIT), nextCursor: uuid }).strict(), value)
  for (const row of parsed.events) {
    if (row.workspaceId !== workspaceId || row.entityRef.workspaceId !== workspaceId || row.entityRef.entityId !== requestedEntityId
      || row.payload.entityId !== requestedEntityId || row.aggregateRevision !== row.entityRef.revisionId
      || row.causationId !== row.correlationId) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  }
  if (new Set(parsed.events.map(row => row.id)).size !== parsed.events.length) throw new ProjectAuthorityError('INVALID_PAYLOAD')
  return parsed
}
/** Locate the independently retained command event with bounded opaque cursor replay. */
export async function requireLicenseAuditEventReplay(result: LicenseAuditResult, actorPrincipalId: string,
  readPage: (cursor?: string) => Promise<unknown>, isCurrent: () => boolean): Promise<LicenseEventPage['events'][number]> {
  const seenIds = new Set<string>(), seenCursors = new Set<string>()
  let cursor: string | undefined
  for (let index = 0; index < MAX_LICENSE_EVENT_REPLAY_PAGES; index++) {
    if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    const page = requireLicenseEvents(await readPage(cursor), result.entity.workspaceId, result.entity.entityId)
    if (!isCurrent()) throw new ProjectAuthorityError('WORKSPACE_MISMATCH')
    for (const row of page.events) {
      if (seenIds.has(row.id)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
      seenIds.add(row.id)
    }
    const matching = page.events.filter(row => row.causationId === result.commandId)
    if (matching.length > 1) throw new ProjectAuthorityError('INVALID_PAYLOAD')
    const event = matching[0]
    if (event) {
      if (event.actorPrincipalId !== actorPrincipalId || event.correlationId !== result.commandId
        || event.entityRef?.revisionId !== result.observedRevision || event.aggregateRevision !== result.data.revision
        || event.policyEpoch !== result.data.policyEpoch || event.at !== result.verifiedAt
        || event.payload.artifactDigest !== result.data.artifactDigest || event.payload.sbomDigest !== result.data.sbomDigest
        || event.payload.auditDigest !== result.data.auditDigest) throw new ProjectAuthorityError('INVALID_PAYLOAD')
      return event
    }
    if (!page.events.length) throw Object.assign(new Error('UNKNOWN_EXTERNAL_EFFECT'), { code: 'UNKNOWN_EXTERNAL_EFFECT' })
    if (seenCursors.has(page.nextCursor)) throw new ProjectAuthorityError('INVALID_PAYLOAD')
    seenCursors.add(page.nextCursor); cursor = page.nextCursor
  }
  throw Object.assign(new Error('UNKNOWN_EXTERNAL_EFFECT'), { code: 'UNKNOWN_EXTERNAL_EFFECT' })
}
