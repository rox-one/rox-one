import { createHash } from 'node:crypto'
import { IdentityDomainError, type AuthenticatedActor, type RoxCommand } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { AuditReleaseLicense, LicenseAuthority, LicenseDecisionReference, LicenseRepositoryPort } from '../../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
const MAX_COMMAND_TEXT = 256
function object(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IdentityDomainError('INVALID_PAYLOAD')
  if (Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new IdentityDomainError('INVALID_PAYLOAD')
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > MAX_COMMAND_TEXT) throw new IdentityDomainError('INVALID_PAYLOAD'); return value }
export function licenseDigest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new IdentityDomainError('INVALID_PAYLOAD'); return value }
export function licenseRevision(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new IdentityDomainError('INVALID_PAYLOAD'); return value }
export function decimal(value: unknown): string { if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value)) throw new IdentityDomainError('INVALID_PAYLOAD'); return value }
export function decisionReference(value: unknown): LicenseDecisionReference {
  const input = object(value, ['resourceId', 'policyEpoch', 'reviewRevision', 'reviewSha256', 'checkerRevision', 'checkerSha256', 'buildSha256'])
  return { resourceId: requireUuid(input.resourceId), policyEpoch: decimal(input.policyEpoch), reviewRevision: licenseRevision(input.reviewRevision), reviewSha256: licenseDigest(input.reviewSha256), checkerRevision: licenseRevision(input.checkerRevision), checkerSha256: licenseDigest(input.checkerSha256), buildSha256: licenseDigest(input.buildSha256) }
}
export function parseLicenseCommand(value: unknown): RoxCommand<AuditReleaseLicense> {
  const input = object(value, ['commandId', 'schemaVersion', 'workspaceId', 'idempotencyKey', 'expectedRevision', 'payload'])
  if (input.schemaVersion !== 2) throw new IdentityDomainError('SCHEMA_VERSION_UNSUPPORTED')
  const payload = object(input.payload, ['artifactDigest', 'sbomDigest', 'decisionManifest'])
  return { commandId: text(input.commandId), schemaVersion: 2, workspaceId: requireUuid(input.workspaceId), idempotencyKey: text(input.idempotencyKey), expectedRevision: decimal(input.expectedRevision), payload: { artifactDigest: licenseDigest(payload.artifactDigest), sbomDigest: licenseDigest(payload.sbomDigest), decisionManifest: decisionReference(payload.decisionManifest) } }
}
export function licenseRequestHash(command: RoxCommand<AuditReleaseLicense>): string {
  return createHash('sha256').update(JSON.stringify({ action: 'audit.releaseLicense', schemaVersion: 2, workspaceId: command.workspaceId, expectedRevision: command.expectedRevision, payload: command.payload })).digest('hex')
}
function scope(actor: AuthenticatedActor | null | undefined, workspaceId: string) { return requireActor(actor, requireUuid(workspaceId)) }
function page(value: unknown, resource: boolean) {
  const input = object(value, ['limit', 'cursor', ...(resource ? ['entityId'] : [])], resource ? ['entityId'] : [])
  const limit = input.limit ?? 25
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new IdentityDomainError('INVALID_PAYLOAD')
  return { limit, ...(input.cursor === undefined ? {} : { cursor: requireUuid(input.cursor) }), ...(resource ? { resourceId: resourceId(input.entityId) } : {}) }
}
export function resourceId(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('license-component:')) throw new IdentityDomainError('INVALID_PAYLOAD')
  return requireUuid(value.slice('license-component:'.length))
}
export class LicenseCommands implements LicenseAuthority {
  constructor(private readonly repository: LicenseRepositoryPort) {}
  /** Host-only outbound port: no RPC channel can select this check or supply a new Actor. */
  async assertReadableResponse(actor: AuthenticatedActor | null | undefined, workspaceId: string, operation: string, body: unknown, result: unknown): Promise<void> {
    const authenticated=scope(actor,workspaceId)
    const ids:string[]=[]
    if(operation==='audit'){const command=parseLicenseCommand(body);if(command.workspaceId!==workspaceId)throw new IdentityDomainError('WORKSPACE_MISMATCH');ids.push(command.payload.decisionManifest.resourceId)}
    else if(operation==='get'||operation==='events'){const input=object(body,operation==='get'?['entityId']:['entityId','limit','cursor'],['entityId']);ids.push(resourceId(input.entityId))}
    else if(operation==='list'){
      if(!result||typeof result!=='object'||!('items'in result)||!Array.isArray(result.items)||result.items.length>100)throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
      const items:readonly unknown[]=result.items
      for(const item of items){if(!item||typeof item!=='object'||!('entity'in item)||!item.entity||typeof item.entity!=='object'||!('entityId'in item.entity))throw new IdentityDomainError('PROVIDER_UNAVAILABLE');ids.push(resourceId(item.entity.entityId))}
    }else throw new IdentityDomainError('INVALID_PAYLOAD')
    await this.repository.assertRead(authenticated,workspaceId,ids)
  }
  auditReleaseLicense(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown) {
    const authenticated = scope(actor, workspaceId); const command = parseLicenseCommand(body)
    if (command.workspaceId !== workspaceId) throw new IdentityDomainError('WORKSPACE_MISMATCH')
    return this.repository.audit(authenticated, command)
  }
  getLicenseComponent(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown) {
    const input = object(body, ['entityId']); return this.repository.get(scope(actor, workspaceId), workspaceId, resourceId(input.entityId))
  }
  listLicenseComponents(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown) {
    const input = page(body, false); return this.repository.list(scope(actor, workspaceId), workspaceId, input.limit, input.cursor)
  }
  licenseEvents(actor: AuthenticatedActor | null | undefined, workspaceId: string, body: unknown) {
    const input = page(body, true); if (!input.resourceId) throw new IdentityDomainError('INVALID_PAYLOAD')
    return this.repository.events(scope(actor, workspaceId), workspaceId, input.resourceId, input.limit, input.cursor)
  }
}
