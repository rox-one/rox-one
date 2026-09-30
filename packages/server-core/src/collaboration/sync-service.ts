import { NativeAuthority, type NativePrincipal } from '../authority/native-authority.ts';
import {
  NativeJournal,
  NativeJournalError,
  type JournalChangePage,
  type JournalEntitySnapshot,
  type JournalMutation,
  type JournalReceipt,
} from '../authority/native-journal.ts';

export type CollaborationMutation = Omit<JournalMutation, 'principal' | 'workspaceId' | 'nativeRoot'>;

export interface CollaborationSyncPage extends JournalChangePage {
  entities: JournalEntitySnapshot[];
  permissionFence: string;
}
export class CollaborationSyncService {
  constructor(private readonly authority: NativeAuthority, private readonly journal: NativeJournal) {}

  commit(principal: NativePrincipal, workspaceId: string, mutation: CollaborationMutation): JournalReceipt {
    this.assertMutation(mutation);
    const action = mutation.changes.some((change) => change.content === null) ? 'delete' : 'write';
    if (!this.authority.authorize(principal, workspaceId, action)) {
      throw new NativeJournalError('UNAUTHORIZED', `workspace ${action} permission is required`);
    }
    const workspace = this.authority.resolveWorkspace(workspaceId);
    if (!workspace) throw new NativeJournalError('RECOVERY_REQUIRED', 'registered workspace root is unavailable');
    return this.journal.mutate({ ...mutation, principal, workspaceId, nativeRoot: workspace.nativeRoot });
  }
  readEntity(principal: NativePrincipal, workspaceId: string, kind: string, nativeId: string): JournalEntitySnapshot | null {
    if (kind !== 'notes') throw new NativeJournalError('INVALID_INPUT', 'only notes have a registered shared canonical producer');
    if (!this.authority.authorize(principal, workspaceId, 'read')) {
      throw new NativeJournalError('UNAUTHORIZED', 'workspace read permission is required');
    }
    return this.journal.readEntity(principal, workspaceId, kind, nativeId);
  }

  pull(principal: NativePrincipal, workspaceId: string, afterSequence: number, limit = 100): CollaborationSyncPage {
    if (!this.authority.authorize(principal, workspaceId, 'read')) {
      throw new NativeJournalError('UNAUTHORIZED', 'workspace read permission is required');
    }
    const permissionFence = this.authority.permissionFence(principal, workspaceId, 'read');
    if (!permissionFence) throw new NativeJournalError('UNAUTHORIZED', 'workspace read permission is required');
    const page = this.journal.pullChanges(principal, workspaceId, afterSequence, limit);
    const changes = page.changes.filter((receipt) => receipt.kind === 'notes');
    const entitiesByIdentity = new Map<string, JournalEntitySnapshot>();
    for (const receipt of changes) {
      const identity = JSON.stringify([receipt.kind, receipt.nativeId]);
      let entity = entitiesByIdentity.get(identity);
      if (!entity) {
        entity = this.journal.readEntity(principal, workspaceId, receipt.kind, receipt.nativeId) ?? undefined;
        if (!entity || entity.workspaceId !== workspaceId || entity.kind !== receipt.kind || entity.nativeId !== receipt.nativeId) {
          throw new NativeJournalError('RECOVERY_REQUIRED', 'change receipt has no matching committed entity snapshot');
        }
        entitiesByIdentity.set(identity, entity);
      }
      if (entity.revision < receipt.revision) {
        throw new NativeJournalError('RECOVERY_REQUIRED', 'change receipt has no matching committed entity snapshot');
      }
    }
    const currentFence = this.authority.permissionFence(principal, workspaceId, 'read');
    if (currentFence !== permissionFence || !this.authority.authorize(principal, workspaceId, 'read')) {
      throw new NativeJournalError('UNAUTHORIZED', 'workspace access changed while reading replica changes');
    }
    return { ...page, changes, entities: [...entitiesByIdentity.values()], permissionFence };
  }

  private assertMutation(mutation: CollaborationMutation): void {
    if (!mutation || mutation.kind !== 'notes') {
      throw new NativeJournalError('INVALID_INPUT', 'only notes have a registered shared canonical producer');
    }
    if (!Array.isArray(mutation.changes) || mutation.changes.length === 0 || mutation.changes.length > 256) {
      throw new NativeJournalError('INVALID_INPUT', 'note changes must contain 1 to 256 files');
    }
    for (const change of mutation.changes) {
      if (!change || typeof change.path !== 'string' || change.path.length > 4096 ||
          change.path.startsWith('/') || change.path.includes('\\') ||
          (change.content !== null && typeof change.content !== 'string')) {
        throw new NativeJournalError('INVALID_INPUT', 'invalid canonical note change');
      }
      const pathParts = change.path.split('/');
      if (pathParts[0] !== 'notes' || pathParts.some((part) => !part || part === '.' || part === '..' || /^(credentials|cookies|passkeys)$/i.test(part))) {
        throw new NativeJournalError('INVALID_INPUT', 'note changes must stay inside the canonical notes directory');
      }
    }
  }
}
