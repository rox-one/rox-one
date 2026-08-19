import { createHash, randomUUID } from 'node:crypto';
import { isCredentialRefId, isStorageMode, type CredentialRefId, type StorageMode } from './credential-types.ts';
import { ConnectionFabricError } from './provider-contract.ts';

const CONNECTION_KEYS = new Set([
  'workspaceId',
  'integrationId',
  'credentialRefId',
  'storageMode',
  'scopes',
  'externalAccountId',
]);

export interface CreateConnectionInput {
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly credentialRefId: CredentialRefId;
  readonly storageMode: StorageMode;
  readonly scopes?: readonly string[];
  readonly externalAccountId?: string;
}

export interface ConnectionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly credentialRefId: CredentialRefId;
  readonly storageMode: StorageMode;
  readonly scopes: readonly string[];
  readonly externalAccountId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface BindConsumerInput {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly consumerId: string;
  readonly purpose: string;
  readonly allowedActions: readonly string[];
  readonly resources: readonly string[];
}

export interface ConnectionBindingRecord extends BindConsumerInput {
  readonly id: string;
}

export interface AppendConnectionAuditInput {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly credentialRefId: CredentialRefId;
  readonly consumer?: string;
  readonly action: string;
  readonly decision: 'allow' | 'deny';
  readonly versionFingerprint?: string;
  readonly eventType?: string;
}

export interface ConnectionAuditRecord {
  readonly id: string;
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly eventType: string;
  readonly occurredAt: number;
  readonly outcome: 'committed';
  readonly payloadDigest: string;
}

interface GraphState {
  connections: ConnectionRecord[];
  bindings: ConnectionBindingRecord[];
  audit: ConnectionAuditRecord[];
}

export class ConnectionWorkGraph {
  private state: GraphState = { connections: [], bindings: [], audit: [] };
  private snapshot: GraphState | undefined;

  async createConnection(input: CreateConnectionInput): Promise<ConnectionRecord> {
    this.assertConnectionKeys(input);
    if (!isCredentialRefId(input.credentialRefId)) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'credentialRefId');
    }
    if (!isStorageMode(input.storageMode)) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'storageMode');
    }
    const now = Date.now();
    const record: ConnectionRecord = {
      id: `conn_${randomUUID()}`,
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      credentialRefId: input.credentialRefId,
      storageMode: input.storageMode,
      scopes: [...(input.scopes ?? [])],
      createdAt: now,
      updatedAt: now,
      ...(input.externalAccountId ? { externalAccountId: input.externalAccountId } : {}),
    };
    this.state.connections.push(record);
    return this.cloneConnection(record);
  }

  async getConnection(workspaceId: string, connectionId: string): Promise<ConnectionRecord | null> {
    const record = this.state.connections.find(
      (item) => item.id === connectionId && item.workspaceId === workspaceId,
    );
    return record ? this.cloneConnection(record) : null;
  }

  async listConnections(workspaceId: string): Promise<ConnectionRecord[]> {
    return this.state.connections
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => this.cloneConnection(item));
  }

  async bindConsumer(input: BindConsumerInput): Promise<ConnectionBindingRecord> {
    const connection = await this.getConnection(input.workspaceId, input.connectionId);
    if (!connection) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', 'connection not found');
    const record: ConnectionBindingRecord = {
      id: `bind_${randomUUID()}`,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      consumerId: input.consumerId,
      purpose: input.purpose,
      allowedActions: [...input.allowedActions],
      resources: [...input.resources],
    };
    this.state.bindings.push(record);
    return { ...record, allowedActions: [...record.allowedActions], resources: [...record.resources] };
  }

  async affectedClosure(workspaceId: string, connectionId: string): Promise<readonly string[]> {
    const ids = this.state.bindings
      .filter((binding) => binding.workspaceId === workspaceId && binding.connectionId === connectionId)
      .map((binding) => binding.consumerId);
    return [...new Set(ids)].sort();
  }

  async appendConnectionAudit(input: AppendConnectionAuditInput): Promise<ConnectionAuditRecord> {
    const connection = await this.getConnection(input.workspaceId, input.connectionId);
    if (!connection) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', 'connection not found');
    const digest = createHash('sha256')
      .update(input.connectionId)
      .update('\0')
      .update(input.action)
      .update('\0')
      .update(input.decision)
      .update('\0')
      .update(input.versionFingerprint ?? '')
      .digest('hex');
    const record: ConnectionAuditRecord = {
      id: `audit_${randomUUID()}`,
      connectionId: input.connectionId,
      workspaceId: input.workspaceId,
      eventType: input.eventType ?? 'connection-audit',
      occurredAt: Date.now(),
      outcome: 'committed',
      payloadDigest: digest,
    };
    this.state.audit.push(record);
    return { ...record };
  }

  async listConnectionAudit(workspaceId: string, connectionId: string): Promise<ConnectionAuditRecord[]> {
    return this.state.audit
      .filter((item) => item.workspaceId === workspaceId && item.connectionId === connectionId)
      .map((item) => ({ ...item }));
  }

  rewriteAudit(_id: string, _patch: { outcome: string }): never {
    throw new Error('workgraph ledger is immutable');
  }

  async transact<T>(fn: (tx: ConnectionWorkGraph) => Promise<T>): Promise<T> {
    this.snapshot = this.cloneState();
    try {
      const result = await fn(this);
      this.snapshot = undefined;
      return result;
    } catch (error) {
      if (this.snapshot) this.state = this.snapshot;
      this.snapshot = undefined;
      throw error;
    }
  }

  private assertConnectionKeys(input: CreateConnectionInput): void {
    for (const key of Object.keys(input as object)) {
      if (!CONNECTION_KEYS.has(key)) {
        throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', `metadata field ${key}`);
      }
    }
  }

  private cloneConnection(record: ConnectionRecord): ConnectionRecord {
    return { ...record, scopes: [...record.scopes] };
  }

  private cloneState(): GraphState {
    return {
      connections: this.state.connections.map((item) => this.cloneConnection(item)),
      bindings: this.state.bindings.map((item) => ({
        ...item,
        allowedActions: [...item.allowedActions],
        resources: [...item.resources],
      })),
      audit: this.state.audit.map((item) => ({ ...item })),
    };
  }
}
