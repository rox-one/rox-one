/**
 * Typed WorkbenchLayout parse + v2→legacy flatten (rollback).
 *
 * parse never throws. v1 snapshots are rejected here — callers migrate
 * with migrateLegacyLayout. Legacy JSON that still has `pinned` is accepted:
 * `preview` wins when both are present.
 */

import { KNOWLEDGE_KINDS, type KnowledgeKind, type KnowledgeRef } from '../../knowledge/refs.ts';
import type {
  SurfaceInstance,
  TabGroup,
  WorkbenchLayout,
  WorkbenchTab,
} from './types.ts';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseKnowledgeRefValue(raw: unknown): KnowledgeRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const ref = raw as Record<string, unknown>;
  if (ref.scheme !== 'siyuan') return null;
  if (typeof ref.kind !== 'string' || !(KNOWLEDGE_KINDS as readonly string[]).includes(ref.kind)) {
    return null;
  }
  if (!isNonEmptyString(ref.id)) return null;
  return { scheme: 'siyuan', kind: ref.kind as KnowledgeKind, id: ref.id };
}

export function parseWorkbenchTab(raw: unknown): WorkbenchTab | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const tab = raw as Record<string, unknown>;
  if (tab.kind === 'legacy-route') return { kind: 'legacy-route' };
  if (tab.kind === 'session' && isNonEmptyString(tab.sessionId)) {
    return { kind: 'session', sessionId: tab.sessionId };
  }
  if (tab.kind === 'browser' && isNonEmptyString(tab.tabId)) {
    return { kind: 'browser', tabId: tab.tabId };
  }
  if (tab.kind === 'cloud-run' && isNonEmptyString(tab.runId)) {
    return { kind: 'cloud-run', runId: tab.runId };
  }
  if (tab.kind === 'diff' && isNonEmptyString(tab.proposalId)) {
    return { kind: 'diff', proposalId: tab.proposalId };
  }
  if (tab.kind === 'terminal' && isNonEmptyString(tab.terminalId)) {
    return {
      kind: 'terminal',
      terminalId: tab.terminalId,
      ...(isNonEmptyString(tab.sessionId) ? { sessionId: tab.sessionId } : {}),
    };
  }
  if (tab.kind === 'extension' && isNonEmptyString(tab.extensionId) && isNonEmptyString(tab.viewId)) {
    return { kind: 'extension', extensionId: tab.extensionId, viewId: tab.viewId };
  }
  if (tab.kind === 'knowledge' || tab.kind === 'database') {
    const ref = parseKnowledgeRefValue(tab.ref);
    if (!ref) return null;
    return tab.kind === 'knowledge' ? { kind: 'knowledge', ref } : { kind: 'database', ref };
  }
  return null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseWorkbenchLayout(raw: unknown): WorkbenchLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 2) return null;
  if (!isNonEmptyString(candidate.workspaceId)) return null;
  if (!Array.isArray(candidate.groups)) return null;
  if (candidate.activeGroupId !== null && typeof candidate.activeGroupId !== 'string') return null;

  const groupIds = new Set<string>();
  const tabIds = new Set<string>();
  const groups: TabGroup[] = [];

  for (const groupRaw of candidate.groups) {
    if (typeof groupRaw !== 'object' || groupRaw === null) return null;
    const group = groupRaw as Record<string, unknown>;
    if (typeof group.id !== 'string' || group.id.length === 0) return null;
    if (groupIds.has(group.id)) return null;
    groupIds.add(group.id);
    if (!Array.isArray(group.tabs) || group.tabs.length === 0) return null;
    if (!isFiniteNonNegative(group.proportion)) return null;

    const tabs: SurfaceInstance[] = [];
    for (const tabRaw of group.tabs) {
      if (typeof tabRaw !== 'object' || tabRaw === null) return null;
      const tab = tabRaw as Record<string, unknown>;
      if (typeof tab.id !== 'string' || tab.id.length === 0) return null;
      if (tabIds.has(tab.id)) return null;
      tabIds.add(tab.id);
      const parsedTab = parseWorkbenchTab(tab.tab);
      if (!parsedTab) return null;
      if (!isNonEmptyString(tab.route)) return null;
      const preview =
        typeof tab.preview === 'boolean' ? tab.preview : tab.pinned !== true;
      const dirty = typeof tab.dirty === 'boolean' ? tab.dirty : false;
      if (typeof tab.openedAt !== 'number' || !Number.isFinite(tab.openedAt)) return null;
      if (typeof tab.lastFocusedAt !== 'number' || !Number.isFinite(tab.lastFocusedAt)) return null;
      tabs.push({
        id: tab.id,
        tab: parsedTab,
        route: tab.route,
        preview,
        dirty,
        openedAt: tab.openedAt,
        lastFocusedAt: tab.lastFocusedAt,
      });
    }

    if (group.activeTabId !== null && typeof group.activeTabId !== 'string') return null;
    if (group.activeTabId !== null && !tabs.some((item) => item.id === group.activeTabId)) return null;

    groups.push({
      id: group.id,
      tabs,
      activeTabId: group.activeTabId as string | null,
      proportion: group.proportion,
    });
  }

  if (candidate.activeGroupId !== null && !groupIds.has(candidate.activeGroupId)) return null;

  const layout: WorkbenchLayout = {
    version: 2,
    workspaceId: candidate.workspaceId,
    groups,
    activeGroupId: candidate.activeGroupId,
  };
  if (candidate.migratedFromVersion === 1) layout.migratedFromVersion = 1;
  return layout;
}

/**
 * Flatten every v2 tab into its own legacy panel so no surface is lost.
 * Grouping is not preserved. Prefer workbenchLayoutToPanelEntries for the
 * live 1-panel-per-group write path.
 */
export function flattenWorkbenchLayoutToLegacyEntries(
  layout: WorkbenchLayout,
): Array<{ id: string; route: string; proportion: number }> {
  const entries: Array<{ id: string; route: string; proportion: number }> = [];
  for (const group of layout.groups) {
    if (group.tabs.length === 0) continue;
    const share = group.proportion / group.tabs.length;
    for (const tab of group.tabs) {
      entries.push({ id: tab.id, route: tab.route, proportion: share });
    }
  }
  return entries;
}
