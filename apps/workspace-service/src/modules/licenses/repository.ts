import { RpcCallCounter } from '../../../../../packages/server-core/src/observability/rpc-call-counter.ts'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { SQL, TransactionSQL } from 'bun'
import { lockPostgresActorSession } from '../../auth/postgres-identity.ts'
import { AuthenticationError } from '../../auth/verified-actor.ts'
import { IdentityDomainError, type AuthenticatedActor, type IdentityDomainEvent, type RoxCommand } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { AuditReleaseLicense, LicenseAuditResult, LicenseComponent, LicenseDecisionReference, LicenseRepositoryPort } from '../../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import { requireActor, requireUuid } from '../identity/commands.ts'
import { decimal, licenseRequestHash, parseLicenseCommand } from './commands.ts'
import { licenseCanonical, licenseHash, TrustedLicenseRegistry, validateLicenseEvidence, type TrustedLicenseResource } from './registry.ts'
type ResourceRow = { workspace_id: string; resource_id: string; label: string; binding_sha256: string; artifact_digest: string; sbom_digest: string; revision: string; policy_epoch: string; can_read: boolean; can_write: boolean; can_action: boolean; evidence: unknown; audit_digest: string | null; audited_at: Date | null; projection_watermark: string }
type Membership = { owner_principal_id: string; role: string; policy_epoch: string }
type ReceiptRow = { command_id: string; idempotency_key: string; receipt_id: string; request_hash: string; binding_sha256: string; artifact_digest: string; sbom_digest: string; review_revision: string; review_sha256: string; checker_revision: string; checker_sha256: string; build_sha256: string; aggregate_revision: string; policy_epoch: string; event_id: string; event_revision: string | null; event_epoch: string | null; event_sequence: string | null; event_at: Date | null; event_payload: unknown; event_correlation: string | null; projection_watermark: string; audit_digest: string; evidence: unknown; result: unknown; created_at: Date }
const ROW = '*, revision::text, policy_epoch::text, projection_watermark::text'
const CURSOR_TTL_SECONDS = 86400
export class LicenseRepository implements LicenseRepositoryPort {
  private readonly counter = new RpcCallCounter()
  readonly observability = Object.freeze({ snapshot: () => Object.freeze({ applied: this.counter.get('applied'), replayed: this.counter.get('replayed'), conflicts: this.counter.get('conflicts'), failed: this.counter.get('failed') }) })
  private readonly prefix: string
  constructor(private readonly database: SQL, private readonly registry: TrustedLicenseRegistry, private readonly schema = 'public') {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid license schema')
    this.prefix = '"' + schema + '".'
  }
  private async query<T>(tx: TransactionSQL, sql: string, values: unknown[] = []): Promise<T[]> { return tx.unsafe<T[]>(sql, values) }
  /** Host-only registration. This port is never RPC; policy has explicit read/write/action grants. */
  async registerTrustedResources(): Promise<void> {
    await this.database.begin(async tx => {
      for (const resource of this.registry.resources) {
        const binding = licenseHash(licenseCanonical({ binding: resource.bindingSha256, policyMode: resource.policy.mode }))
        const [row] = await this.query<ResourceRow>(tx, `SELECT ${ROW} FROM ${this.prefix}license_component WHERE workspace_id=$1 AND resource_id=$2 FOR UPDATE`, [resource.workspaceId, resource.resourceId])
        if (row && (row.binding_sha256 !== binding || row.label !== resource.label || row.artifact_digest !== resource.buildReceipt.artifactDigest || row.sbom_digest !== resource.buildReceipt.sbomDigest)) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
        if (!row) await this.query(tx, `INSERT INTO ${this.prefix}license_component (workspace_id,resource_id,label,binding_sha256,artifact_digest,sbom_digest,can_read,can_write,can_action) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [resource.workspaceId,resource.resourceId,resource.label,binding,resource.buildReceipt.artifactDigest,resource.buildReceipt.sbomDigest,resource.policy.read,resource.policy.write,resource.policy.action])
        else if (row.can_read !== resource.policy.read || row.can_write !== resource.policy.write || row.can_action !== resource.policy.action) await this.query(tx, `UPDATE ${this.prefix}license_component SET can_read=$3,can_write=$4,can_action=$5,policy_epoch=policy_epoch+1 WHERE workspace_id=$1 AND resource_id=$2`, [resource.workspaceId,resource.resourceId,resource.policy.read,resource.policy.write,resource.policy.action])
      }
    })
  }
  private async membership(tx: TransactionSQL, actor: AuthenticatedActor, workspaceId: string): Promise<Membership> {
    requireActor(actor, requireUuid(workspaceId))
    try { await lockPostgresActorSession(tx, this.schema, actor) } catch (error) { if (error instanceof AuthenticationError) throw new IdentityDomainError('UNAUTHENTICATED'); throw error }
    const [row] = await this.query<Membership>(tx, `SELECT w.owner_principal_id,m.role,w.policy_epoch::text FROM ${this.prefix}workspace_member m JOIN ${this.prefix}workspace w USING(workspace_id) JOIN ${this.prefix}principal p ON p.principal_id=m.principal_id WHERE m.workspace_id=$1 AND m.principal_id=$2 AND m.deleted_at IS NULL AND w.deleted_at IS NULL AND p.deleted_at IS NULL FOR SHARE OF m,w,p`, [workspaceId,actor.principalId])
    if (!row || row.role !== 'owner' || row.owner_principal_id !== actor.principalId) throw new IdentityDomainError('FORBIDDEN')
    return row
  }
  private async authorized(tx: TransactionSQL, actor: AuthenticatedActor, workspaceId: string, resourceId: string, write: boolean): Promise<ResourceRow> {
    await this.membership(tx, actor, workspaceId)
    const [row] = await this.query<ResourceRow>(tx, `SELECT ${ROW} FROM ${this.prefix}license_component WHERE workspace_id=$1 AND resource_id=$2 ${write ? 'FOR UPDATE' : 'FOR SHARE'}`, [workspaceId,resourceId])
    if (!row || !row.can_read || (write && (!row.can_write || !row.can_action))) throw new IdentityDomainError('FORBIDDEN')
    const trusted = this.registry.resource(resourceId, workspaceId)
    if (row.label !== trusted.label || row.artifact_digest !== trusted.buildReceipt.artifactDigest || row.sbom_digest !== trusted.buildReceipt.sbomDigest || row.binding_sha256 !== licenseHash(licenseCanonical({ binding: trusted.bindingSha256, policyMode: trusted.policy.mode }))) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    return row
  }
  private view(row: ResourceRow, resource: TrustedLicenseResource): LicenseComponent {
    if (row.workspace_id !== resource.workspaceId || row.resource_id !== resource.resourceId || row.label !== resource.label
      || row.artifact_digest !== resource.buildReceipt.artifactDigest || row.sbom_digest !== resource.buildReceipt.sbomDigest
      || row.binding_sha256 !== licenseHash(licenseCanonical({ binding: resource.bindingSha256, policyMode: resource.policy.mode }))
      || (row.evidence === null) !== (row.audited_at === null) || (row.evidence === null) !== (row.audit_digest === null)) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const evidence = row.evidence === null ? null : validateLicenseEvidence(row.evidence)
    if (evidence && licenseHash(licenseCanonical(evidence)) !== row.audit_digest) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    return { entity: { workspaceId: row.workspace_id, entityId: 'license-component:' + row.resource_id, revisionId: decimal(row.revision) }, label: row.label, revision: decimal(row.revision), policyEpoch: decimal(row.policy_epoch), artifactDigest: row.artifact_digest, sbomDigest: row.sbom_digest, decisionManifest: this.registry.reference(resource,row.policy_epoch), evidence, auditDigest: row.audit_digest, auditedAt: row.audited_at?.toISOString() ?? null, projectionWatermark: decimal(row.projection_watermark), canAudit: row.can_read && row.can_write && row.can_action, permissionMode: 'owner_bootstrap' }
  }
  private async readView(tx: TransactionSQL, row: ResourceRow, resource: TrustedLicenseResource): Promise<LicenseComponent> {
    const view = this.view(row,resource)
    if (row.evidence === null) {
      if (row.revision !== '0' || row.projection_watermark !== '0') throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
      return view
    }
    const [receipt] = await this.query<{event_id:string;evidence:unknown;audit_digest:string;created_at:Date;projection_watermark:string;policy_epoch:string}>(tx,
      `SELECT event_id,evidence,audit_digest,created_at,projection_watermark::text,policy_epoch::text FROM ${this.prefix}license_audit_receipt WHERE workspace_id=$1 AND resource_id=$2 AND aggregate_revision=$3 FOR SHARE`,[row.workspace_id,row.resource_id,row.revision])
    if (!receipt) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const event = await this.verifyEvent(tx,receipt.event_id)
    if (event.aggregateRevision !== row.revision || BigInt(receipt.policy_epoch)>BigInt(row.policy_epoch)
      || !isDeepStrictEqual(row.evidence,receipt.evidence) || row.audit_digest !== receipt.audit_digest
      || row.audited_at?.toISOString() !== receipt.created_at.toISOString() || row.projection_watermark !== receipt.projection_watermark) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    return view
  }
  private result(commandId: string, requestHash: string, receiptId: string, view: LicenseComponent, at: string): LicenseAuditResult {
    return { executionMode: 'live', lifecycle: 'succeeded', verification: 'receipt_verified', ok: true, status: 'applied', commandId, requestHash, observedRevision: view.revision, entityId: view.entity.entityId, entity: view.entity, receiptId, verifiedAt: at, data: view, receipt: { provider: 'rox-workspace', remoteId: view.entity.entityId, requestId: commandId, observedRevision: view.revision, verifiedAt: at } }
  }
  private retained(command: RoxCommand<AuditReleaseLicense>, row: ReceiptRow, resource: ResourceRow): LicenseAuditResult {
    const evidence = validateLicenseEvidence(row.evidence); const reference: LicenseDecisionReference = { resourceId: resource.resource_id, policyEpoch: row.policy_epoch, reviewRevision: row.review_revision, reviewSha256: row.review_sha256, checkerRevision: row.checker_revision, checkerSha256: row.checker_sha256, buildSha256: row.build_sha256 }
    const eventPayload = { entityId: 'license-component:' + resource.resource_id, artifactDigest: row.artifact_digest, sbomDigest: row.sbom_digest, auditDigest: row.audit_digest }
    if (row.event_correlation !== row.command_id || row.event_at?.toISOString() !== row.created_at.toISOString() || row.event_sequence !== row.projection_watermark || row.aggregate_revision !== (BigInt(command.expectedRevision ?? '0') + 1n).toString() || row.artifact_digest !== resource.artifact_digest || row.sbom_digest !== resource.sbom_digest || !isDeepStrictEqual(reference,this.registry.reference(this.registry.resource(resource.resource_id,resource.workspace_id),row.policy_epoch)) || row.binding_sha256 !== resource.binding_sha256 || row.artifact_digest !== command.payload.artifactDigest || row.sbom_digest !== command.payload.sbomDigest || !isDeepStrictEqual(reference,command.payload.decisionManifest) || row.policy_epoch !== row.event_epoch || row.aggregate_revision !== row.event_revision || !isDeepStrictEqual(eventPayload,row.event_payload) || licenseHash(licenseCanonical(evidence)) !== row.audit_digest) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const at = row.created_at.toISOString()
    const view: LicenseComponent = { ...this.view({ ...resource, can_read: true, can_write: true, can_action: true, evidence, audit_digest: row.audit_digest, audited_at: row.created_at, revision: row.aggregate_revision, policy_epoch: row.policy_epoch, projection_watermark: row.projection_watermark },this.registry.resource(resource.resource_id,resource.workspace_id)), decisionManifest: reference }
    const result = this.result(row.command_id,row.request_hash,row.receipt_id,view,at)
    if (!isDeepStrictEqual(result,row.result)) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    return result
  }
  async audit(actor: AuthenticatedActor, input: RoxCommand<AuditReleaseLicense>): Promise<LicenseAuditResult> {
    const command = parseLicenseCommand(input); const requestHash = licenseRequestHash(command); const id = command.payload.decisionManifest.resourceId
    let outcome: 'applied' | 'replayed' = 'applied'
    try { const result = await this.database.begin(async tx => {
      const row = await this.authorized(tx,actor,command.workspaceId,id,true)
      await this.query(tx,'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['license-command',command.workspaceId,actor.principalId,command.commandId])])
      await this.query(tx,'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['license-idempotency',command.workspaceId,actor.principalId,command.idempotencyKey])])
      const receipts = await this.query<ReceiptRow>(tx,`SELECT r.*,r.aggregate_revision::text,r.policy_epoch::text,r.projection_watermark::text,e.aggregate_revision::text AS event_revision,e.policy_epoch::text AS event_epoch,e.sequence::text AS event_sequence,e.created_at AS event_at,e.payload AS event_payload,e.correlation_id AS event_correlation FROM ${this.prefix}license_audit_receipt r LEFT JOIN ${this.prefix}project_event e ON e.event_id=r.event_id AND e.workspace_id=r.workspace_id AND e.type='audit.license_reviewed' AND e.actor_principal_id=r.actor_principal_id AND e.causation_id=r.command_id WHERE r.workspace_id=$1 AND r.actor_principal_id=$2 AND (r.idempotency_key=$3 OR r.command_id=$4)`,[command.workspaceId,actor.principalId,command.idempotencyKey,command.commandId])
      if (receipts.length > 1) throw new IdentityDomainError('IDEMPOTENCY_CONFLICT')
      const retained = receipts[0]
      if (retained) { if (retained.request_hash !== requestHash || retained.idempotency_key !== command.idempotencyKey) throw new IdentityDomainError('IDEMPOTENCY_CONFLICT'); outcome='replayed'; return this.retained(command,retained,row) }
      if (row.revision !== command.expectedRevision) throw new IdentityDomainError('REVISION_CONFLICT')
      const trusted = this.registry.resource(id,command.workspaceId)
      if (row.artifact_digest !== command.payload.artifactDigest || row.sbom_digest !== command.payload.sbomDigest || !isDeepStrictEqual(this.registry.reference(trusted,row.policy_epoch),command.payload.decisionManifest)) throw new IdentityDomainError('INVALID_PAYLOAD')
      const evidence = await this.registry.evaluate(trusted); const auditDigest = licenseHash(licenseCanonical(evidence))
      // Fresh clock/session and current Resource grants are checked again after actual checker I/O.
      const current = await this.authorized(tx,actor,command.workspaceId,id,true)
      if (current.revision !== row.revision || current.policy_epoch !== row.policy_epoch || current.binding_sha256 !== row.binding_sha256) throw new IdentityDomainError('REVISION_CONFLICT')
      const [updated] = await this.query<ResourceRow>(tx,`UPDATE ${this.prefix}license_component SET revision=revision+1,evidence=$3::jsonb,audit_digest=$4,audited_at=clock_timestamp() WHERE workspace_id=$1 AND resource_id=$2 AND revision=$5 RETURNING ${ROW}`,[command.workspaceId,id,evidence,auditDigest,row.revision])
      if (!updated) throw new IdentityDomainError('REVISION_CONFLICT')
      await this.query(tx,'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['project-events:'+this.prefix])
      const eventId = randomUUID(); const payload = { entityId: 'license-component:'+id,artifactDigest:row.artifact_digest,sbomDigest:row.sbom_digest,auditDigest }
      const [event] = await this.query<{ sequence: string; created_at: Date }>(tx,`INSERT INTO ${this.prefix}project_event(event_id,workspace_id,actor_principal_id,type,aggregate_revision,policy_epoch,causation_id,correlation_id,payload) VALUES ($1,$2,$3,'audit.license_reviewed',$4,$5,$6,$6,$7::jsonb) RETURNING sequence::text,created_at`,[eventId,command.workspaceId,actor.principalId,updated.revision,updated.policy_epoch,command.commandId,payload])
      if (!event) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
      updated.projection_watermark=event.sequence; updated.audited_at=event.created_at
      await this.query(tx,`UPDATE ${this.prefix}license_component SET projection_watermark=$3,audited_at=$4 WHERE workspace_id=$1 AND resource_id=$2`,[command.workspaceId,id,event.sequence,event.created_at])
      const result=this.result(command.commandId,requestHash,randomUUID(),this.view(updated,trusted),event.created_at.toISOString()); const ref=command.payload.decisionManifest
      await this.query(tx,`INSERT INTO ${this.prefix}license_audit_receipt(workspace_id,resource_id,actor_principal_id,command_id,idempotency_key,receipt_id,request_hash,binding_sha256,artifact_digest,sbom_digest,review_revision,review_sha256,checker_revision,checker_sha256,build_sha256,aggregate_revision,policy_epoch,event_id,projection_watermark,audit_digest,evidence,result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23)`,[command.workspaceId,id,actor.principalId,command.commandId,command.idempotencyKey,result.receiptId,requestHash,row.binding_sha256,row.artifact_digest,row.sbom_digest,ref.reviewRevision,ref.reviewSha256,ref.checkerRevision,ref.checkerSha256,ref.buildSha256,updated.revision,updated.policy_epoch,eventId,event.sequence,auditDigest,evidence,result,event.created_at])
      return result
    })
      this.counter.record(outcome);return result
    }catch(error){this.counter.record(error instanceof IdentityDomainError && ['IDEMPOTENCY_CONFLICT','REVISION_CONFLICT'].includes(error.code)?'conflicts':'failed');throw error}
  }
  /** Internal outbox proof: actual immutable host binding, independent columns and original receipt. Never registered as RPC. */
  async verifyEvent(tx: TransactionSQL, eventId: string): Promise<IdentityDomainEvent> {
    const [event] = await this.query<{event_id:string;workspace_id:string;actor_principal_id:string;aggregate_revision:string;policy_epoch:string;causation_id:string;correlation_id:string;created_at:Date;payload:unknown;sequence:string}>(tx,
      `SELECT e.*,e.aggregate_revision::text,e.policy_epoch::text,e.sequence::text FROM ${this.prefix}project_event e WHERE event_id=$1 AND type='audit.license_reviewed' FOR SHARE`,[requireUuid(eventId)])
    if (!event || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const payload = Object.fromEntries(Object.entries(event.payload))
    if (Object.keys(payload).sort().join(',') !== 'artifactDigest,auditDigest,entityId,sbomDigest' || typeof payload.entityId !== 'string'
      || !/^license-component:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.entityId)
      || ![payload.artifactDigest,payload.sbomDigest,payload.auditDigest].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))
      || event.causation_id !== event.correlation_id) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const id = requireUuid(payload.entityId.slice('license-component:'.length))
    const [resource] = await this.query<ResourceRow>(tx,`SELECT ${ROW} FROM ${this.prefix}license_component WHERE workspace_id=$1 AND resource_id=$2 FOR SHARE`,[event.workspace_id,id])
    const [receipt] = await this.query<ReceiptRow>(tx,`SELECT r.*,r.aggregate_revision::text,r.policy_epoch::text,r.projection_watermark::text,e.aggregate_revision::text AS event_revision,e.policy_epoch::text AS event_epoch,e.sequence::text AS event_sequence,e.created_at AS event_at,e.payload AS event_payload,e.correlation_id AS event_correlation FROM ${this.prefix}license_audit_receipt r JOIN ${this.prefix}project_event e ON e.event_id=r.event_id AND e.workspace_id=r.workspace_id AND e.type='audit.license_reviewed' AND e.actor_principal_id=r.actor_principal_id AND e.causation_id=r.command_id WHERE r.event_id=$1 AND r.workspace_id=$2 AND r.resource_id=$3 FOR SHARE OF r`,[event.event_id,event.workspace_id,id])
    if (!resource || !receipt || receipt.command_id !== event.causation_id || receipt.event_correlation !== event.causation_id
      || receipt.aggregate_revision === '0') throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    const reference: LicenseDecisionReference = { resourceId:id,policyEpoch:receipt.policy_epoch,reviewRevision:receipt.review_revision,reviewSha256:receipt.review_sha256,checkerRevision:receipt.checker_revision,checkerSha256:receipt.checker_sha256,buildSha256:receipt.build_sha256 }
    const command = parseLicenseCommand({commandId:receipt.command_id,schemaVersion:2,workspaceId:event.workspace_id,idempotencyKey:receipt.idempotency_key,expectedRevision:String(BigInt(receipt.aggregate_revision)-1n),payload:{artifactDigest:receipt.artifact_digest,sbomDigest:receipt.sbom_digest,decisionManifest:reference}})
    if (receipt.request_hash !== licenseRequestHash(command)) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
    this.retained(command,receipt,resource)
    return {id:event.event_id,type:'audit.license_reviewed',workspaceId:event.workspace_id,entityRef:{workspaceId:event.workspace_id,entityId:payload.entityId,revisionId:decimal(event.aggregate_revision)},actorPrincipalId:event.actor_principal_id,schemaVersion:1,aggregateRevision:decimal(event.aggregate_revision),policyEpoch:decimal(event.policy_epoch),causationId:event.causation_id,correlationId:event.correlation_id,at:event.created_at.toISOString(),payload:{entityId:payload.entityId,artifactDigest:String(payload.artifactDigest),sbomDigest:String(payload.sbomDigest),auditDigest:String(payload.auditDigest)}}
  }
  async assertRead(actor: AuthenticatedActor, workspaceId: string, resourceIds: readonly string[]): Promise<void> {
    await this.database.begin(async tx=>{
      await this.membership(tx,actor,workspaceId)
      for(const id of resourceIds) await this.authorized(tx,actor,workspaceId,requireUuid(id),false)
    })
  }
  async get(actor: AuthenticatedActor,workspaceId:string,resourceId:string) { return this.database.begin(async tx=>{const row=await this.authorized(tx,actor,workspaceId,resourceId,false);return this.readView(tx,row,this.registry.resource(resourceId,workspaceId))}) }
  private async cursor(tx:TransactionSQL,actor:AuthenticatedActor,workspaceId:string,epoch:string,kind:string,token?:string):Promise<Record<string,unknown>> {
    if(!token)return {}
    const [row]=await this.query<{position:unknown}>(tx,`SELECT position FROM ${this.prefix}project_query_cursor WHERE cursor_id=$1 AND workspace_id=$2 AND principal_id=$3 AND kind=$4 AND policy_epoch=$5 AND expires_at>clock_timestamp()`,[token,workspaceId,actor.principalId,kind,epoch])
    if(!row?.position||typeof row.position!=='object'||Array.isArray(row.position))throw new IdentityDomainError('CURSOR_INVALID')
    return Object.fromEntries(Object.entries(row.position))
  }
  private async saveCursor(tx:TransactionSQL,actor:AuthenticatedActor,workspaceId:string,epoch:string,kind:string,position:unknown) {
    const id=randomUUID();await this.query(tx,`INSERT INTO ${this.prefix}project_query_cursor(cursor_id,workspace_id,principal_id,kind,policy_epoch,position,expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp()+$7::integer*interval '1 second')`,[id,workspaceId,actor.principalId,kind,epoch,position,CURSOR_TTL_SECONDS]);return id
  }
  async list(actor:AuthenticatedActor,workspaceId:string,limit:number,token?:string) {
    return this.database.begin(async tx=>{const member=await this.membership(tx,actor,workspaceId);const position=await this.cursor(tx,actor,workspaceId,member.policy_epoch,'license-list',token)
      const after=position.after===undefined?null:requireUuid(position.after)
      if(Object.keys(position).some(k=>k!=='after'))throw new IdentityDomainError('CURSOR_INVALID')
      const rows=await this.query<ResourceRow>(tx,`SELECT ${ROW} FROM ${this.prefix}license_component WHERE workspace_id=$1 AND can_read AND ($2::uuid IS NULL OR resource_id>$2) ORDER BY resource_id LIMIT $3 FOR SHARE`,[workspaceId,after,limit+1]);const visible=rows.slice(0,limit);const last=visible[visible.length-1]
      const nextCursor=rows.length>limit&&last?await this.saveCursor(tx,actor,workspaceId,member.policy_epoch,'license-list',{after:last.resource_id}):undefined
      const items:LicenseComponent[]=[]
      for(const row of visible) items.push(await this.readView(tx,row,this.registry.resource(row.resource_id,workspaceId)))
      return {items,...(nextCursor?{nextCursor}:{})}
    })
  }
  async events(actor:AuthenticatedActor,workspaceId:string,resourceId:string,limit:number,token?:string) {
    return this.database.begin(async tx=>{const resource=await this.authorized(tx,actor,workspaceId,resourceId,false);const position=await this.cursor(tx,actor,workspaceId,resource.policy_epoch,'license-events',token)
      if(Object.keys(position).some(k=>!['resourceId','sequence'].includes(k))||(token&&position.resourceId!==resourceId))throw new IdentityDomainError('CURSOR_INVALID')
      const sequence=position.sequence===undefined?'0':decimal(position.sequence)
      const rows=await this.query<{event_id:string;actor_principal_id:string;aggregate_revision:string;policy_epoch:string;causation_id:string;correlation_id:string;created_at:Date;payload:unknown;sequence:string}>(tx,`SELECT e.*,e.aggregate_revision::text,e.policy_epoch::text,e.sequence::text FROM ${this.prefix}project_event e LEFT JOIN ${this.prefix}license_audit_receipt r ON r.event_id=e.event_id AND r.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.type='audit.license_reviewed' AND (r.resource_id=$2 OR e.payload->>'entityId'='license-component:'||$2::text) AND e.sequence>$3 ORDER BY e.sequence LIMIT $4`,[workspaceId,resourceId,sequence,limit])
      const events:IdentityDomainEvent[]=[]
      for (const row of rows) events.push(await this.verifyEvent(tx,row.event_id))
      const next=rows[rows.length-1]?.sequence??sequence;const nextCursor=await this.saveCursor(tx,actor,workspaceId,resource.policy_epoch,'license-events',{resourceId,sequence:next});return {events,nextCursor}
    })
  }
}
