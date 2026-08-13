/**
 * SurfaceTab ↔ SurfaceDescriptor mapping and durable identity
 * (S-02 §3.2 downgrade rules, §3.7 durable refs).
 */

import type { KnowledgeRef, SurfaceDescriptor, SurfaceTab } from './types.ts';
import { KNOWLEDGE_KINDS, type KnowledgeKind } from '../../knowledge/refs.ts';

/**
 * UI-level tab → host-level descriptor (S-02 §3.2):
 * - 'session'  → 'chat';
 * - 'database' → 'knowledge' with ref.kind 'database';
 * - 'extension' → null: extension views render through the plugin-bridge
 *   sandbox; they are not part of the host descriptor union.
 */
export function surfaceTabToDescriptor(tab: SurfaceTab): SurfaceDescriptor | null {
  switch (tab.kind) {
    case 'session':
      return { kind: 'chat', sessionId: tab.sessionId };
    case 'browser':
      return { kind: 'browser', tabId: tab.tabId };
    case 'knowledge':
      return { kind: 'knowledge', ref: tab.ref };
    case 'database':
      return { kind: 'knowledge', ref: { scheme: tab.ref.scheme, kind: 'database', id: tab.ref.id } };
    case 'cloud-run':
      return { kind: 'cloud-run', runId: tab.runId };
    case 'diff':
      return { kind: 'diff', proposalId: tab.proposalId };
    case 'extension':
      return null;
  }
}

/**
 * Default dedup key over the durable ref (S-02 §3.7): what gets serialized
 * and survives restart — never an ephemeral instance id. Contributions may
 * override via policy.singletonPer; this is the shared default.
 */
export function surfaceTabDurableKey(tab: SurfaceTab): string {
  switch (tab.kind) {
    case 'session':
      return `session:${tab.sessionId}`;
    case 'browser':
      return `browser:${tab.tabId}`;
    case 'knowledge':
      return `knowledge:siyuan/${tab.ref.kind}/${tab.ref.id}`;
    case 'database':
      return `database:siyuan/${tab.ref.kind}/${tab.ref.id}`;
    case 'cloud-run':
      return `cloud-run:${tab.runId}`;
    case 'extension':
      return `extension:${tab.extensionId}/${tab.viewId}`;
    case 'diff':
      return `diff:${tab.proposalId}`;
  }
}

function isKnowledgeKind(value: string): value is KnowledgeKind {
  return (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

function parseKnowledgeRefObject(raw: unknown): KnowledgeRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const ref = raw as Record<string, unknown>;
  if (ref.scheme !== 'siyuan') return null;
  if (typeof ref.kind !== 'string' || !isKnowledgeKind(ref.kind)) return null;
  if (typeof ref.id !== 'string' || ref.id.length === 0) return null;
  return { scheme: 'siyuan', kind: ref.kind, id: ref.id };
}

/** Typed read of a SurfaceTab; unknown kinds / missing fields → null. */
export function parseSurfaceTab(raw: unknown): SurfaceTab | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case 'session':
      return typeof o.sessionId === 'string' && o.sessionId.length > 0
        ? { kind: 'session', sessionId: o.sessionId }
        : null;
    case 'browser':
      return typeof o.tabId === 'string' && o.tabId.length > 0
        ? { kind: 'browser', tabId: o.tabId }
        : null;
    case 'cloud-run':
      return typeof o.runId === 'string' && o.runId.length > 0
        ? { kind: 'cloud-run', runId: o.runId }
        : null;
    case 'diff':
      return typeof o.proposalId === 'string' && o.proposalId.length > 0
        ? { kind: 'diff', proposalId: o.proposalId }
        : null;
    case 'extension':
      return typeof o.extensionId === 'string' &&
        o.extensionId.length > 0 &&
        typeof o.viewId === 'string' &&
        o.viewId.length > 0
        ? { kind: 'extension', extensionId: o.extensionId, viewId: o.viewId }
        : null;
    case 'knowledge':
    case 'database': {
      const parsed = parseKnowledgeRefObject(o.ref);
      if (!parsed) return null;
      return o.kind === 'database'
        ? { kind: 'database', ref: parsed }
        : { kind: 'knowledge', ref: parsed };
    }
    default:
      return null;
  }
}
