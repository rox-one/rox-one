import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

export interface JsonAccessGrantStoreOptions {
  readonly directory?: string;
}

const GRANTS_FILE = 'grants.json';

function atomicWriteJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, filePath);
}

function readGrants(filePath: string): AccessGrant[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return Array.isArray(raw) ? (raw as AccessGrant[]) : [];
  } catch {
    return [];
  }
}

export class JsonAccessGrantStore {
  private readonly directory: string | undefined;
  private readonly grants = new Map<string, AccessGrant>();

  constructor(options: JsonAccessGrantStoreOptions = {}) {
    this.directory = options.directory;
    if (this.directory) this.reloadFromDisk();
  }

  put(grant: AccessGrant): AccessGrant {
    const stored = { ...grant, actions: [...grant.actions], resources: [...grant.resources] };
    this.grants.set(grant.id, stored);
    this.persist();
    return { ...stored, actions: [...stored.actions], resources: [...stored.resources] };
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

  listAll(workspaceId?: string): AccessGrant[] {
    return [...this.grants.values()]
      .filter((grant) => workspaceId === undefined || grant.workspaceId === workspaceId)
      .map((grant) => ({ ...grant, actions: [...grant.actions], resources: [...grant.resources] }));
  }

  listForConsumer(consumer: { readonly id: string; readonly workspaceId: string }): AccessGrant[] {
    return [...this.grants.values()]
      .filter(
        (grant) =>
          grant.consumerId === consumer.id &&
          grant.workspaceId === consumer.workspaceId,
      )
      .map((grant) => ({ ...grant, actions: [...grant.actions], resources: [...grant.resources] }));
  }

  private reloadFromDisk(): void {
    if (!this.directory) return;
    mkdirSync(this.directory, { recursive: true });
    this.grants.clear();
    for (const grant of readGrants(join(this.directory, GRANTS_FILE))) {
      this.grants.set(grant.id, {
        ...grant,
        actions: [...grant.actions],
        resources: [...grant.resources],
      });
    }
  }

  private persist(): void {
    if (!this.directory) return;
    mkdirSync(this.directory, { recursive: true });
    atomicWriteJson(join(this.directory, GRANTS_FILE), [...this.grants.values()]);
  }
}
