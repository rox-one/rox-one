import type { CredentialRefId } from './credential-types.ts';

export type AccessGrantStatus = 'active' | 'revoked' | 'expired' | 'denied';

export interface AccessGrant {
  readonly id: string;
  readonly workspaceId: string;
  readonly consumerId: string;
  readonly credentialRefId: CredentialRefId;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly expiresAt?: number;
  readonly status: AccessGrantStatus;
}

export class JsonAccessGrantStore {
  private readonly grants = new Map<string, AccessGrant>();

  put(grant: AccessGrant): AccessGrant {
    const stored = { ...grant, actions: [...grant.actions], resources: [...grant.resources] };
    this.grants.set(grant.id, stored);
    return { ...stored };
  }

  get(id: string): AccessGrant | undefined {
    const grant = this.grants.get(id);
    return grant ? { ...grant, actions: [...grant.actions], resources: [...grant.resources] } : undefined;
  }

  listActive(input: {
    consumerId: string;
    credentialRefId: CredentialRefId;
    workspaceId?: string;
  }): AccessGrant[] {
    return [...this.grants.values()]
      .filter(
        (grant) =>
          grant.status === 'active' &&
          grant.consumerId === input.consumerId &&
          grant.credentialRefId === input.credentialRefId &&
          (input.workspaceId === undefined || grant.workspaceId === input.workspaceId) &&
          (grant.expiresAt === undefined || grant.expiresAt > Date.now()),
      )
      .map((grant) => ({ ...grant, actions: [...grant.actions], resources: [...grant.resources] }));
  }
}
