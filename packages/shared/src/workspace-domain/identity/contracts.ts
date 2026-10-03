import type { AuthenticatedActor, Rox2CanonicalResult, Rox2EntityRef } from '../../../../core/src/rox2/platform-contract.ts'

export type { AuthenticatedActor } from '../../../../core/src/rox2/platform-contract.ts'

/** Native and HTTP inputs share the normative Project text boundary. */
export const SHARED_PROJECT_TEXT_MAX_LENGTH = 10000

export interface RoxCommand<T> {
  readonly commandId: string
  readonly schemaVersion: 2
  readonly workspaceId: string
  readonly idempotencyKey: string
  readonly expectedRevision?: string
  readonly payload: T
}

export interface CreateSharedProject {
  readonly name: string
  readonly workspaceName: string
  readonly visibility: 'private' | 'members'
}

export interface SharedProject {
  readonly entity: Rox2EntityRef
  readonly ownerPrincipalId: string
  readonly name: string
  readonly visibility: 'private' | 'members'
  readonly schemaVersion: 1
  readonly revision: string
  readonly policyEpoch: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Wire status retains the existing canonical execution/lifecycle/verification triad. */
export interface SharedProjectResult extends Rox2CanonicalResult {
  readonly status: 'applied'
  readonly commandId: string
  readonly requestHash: string
  readonly observedRevision: string
  readonly entity: Rox2EntityRef
  readonly receiptId: string
  readonly verifiedAt: string
  readonly data: SharedProject
}

export interface ProjectPage {
  readonly items: readonly SharedProject[]
  /** Opaque, durable, actor/workspace/policy-bound cursor; never an exposed hidden total. */
  readonly nextCursor?: string
}

export interface IdentityDomainEvent {
  readonly id: string
  readonly type: 'workspace.member_joined' | 'project.created' | 'audit.license_reviewed'
  readonly workspaceId: string
  readonly entityRef?: Rox2EntityRef
  readonly actorPrincipalId: string
  readonly schemaVersion: 1
  readonly aggregateRevision: string
  readonly policyEpoch: string
  readonly causationId: string
  readonly correlationId: string
  readonly at: string
  /** References only: no private title, email, body, transcript or token. */
  readonly payload: Readonly<Record<string, string>>
}

export interface IdentityEventPage {
  readonly events: readonly IdentityDomainEvent[]
  readonly nextCursor: string
}

export type IdentityErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'WORKSPACE_MISMATCH'
  | 'INVALID_PAYLOAD' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT'
  | 'SCHEMA_VERSION_UNSUPPORTED' | 'CURSOR_INVALID' | 'NOT_FOUND' | 'PROVIDER_UNAVAILABLE'

const ERROR_STATUS: Record<IdentityErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, WORKSPACE_MISMATCH: 403,
  INVALID_PAYLOAD: 400, REVISION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409,
  SCHEMA_VERSION_UNSUPPORTED: 400, CURSOR_INVALID: 400, NOT_FOUND: 404,
  PROVIDER_UNAVAILABLE: 503,
}

/** Constant messages prevent authorization failures from disclosing a resource title. */
export class IdentityDomainError extends Error {
  readonly statusCode: number
  constructor(readonly code: IdentityErrorCode) {
    super(code)
    this.name = 'IdentityDomainError'
    this.statusCode = ERROR_STATUS[code]
  }
}

export interface IdentityRepositoryPort {
  createSharedProject(actor: AuthenticatedActor, command: RoxCommand<CreateSharedProject>, requestHash: string): Promise<SharedProjectResult>
  getProject(actor: AuthenticatedActor, workspaceId: string, projectId: string): Promise<SharedProject>
  listProjects(actor: AuthenticatedActor, workspaceId: string, limit: number, cursor?: string): Promise<ProjectPage>
  replayEvents(actor: AuthenticatedActor, workspaceId: string, limit: number, cursor?: string): Promise<IdentityEventPage>
}

export interface SharedProjectAuthority {
  createSharedProject(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown): Promise<SharedProjectResult>
  getProject(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown): Promise<SharedProject>
  listProjects(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown): Promise<ProjectPage>
  replayEvents(actor: AuthenticatedActor | null | undefined, routeWorkspaceId: string, body: unknown): Promise<IdentityEventPage>
}

export const DOMAIN_PROJECT_RPC = {
  CREATE_SHARED: 'domain.project.createShared',
  GET: 'domain.project.get',
  LIST: 'domain.project.list',
  EVENTS: 'domain.project.events',
} as const
