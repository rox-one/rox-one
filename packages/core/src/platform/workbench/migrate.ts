/**
 * SurfaceLayoutSnapshot v1 ↔ WorkbenchLayout v2 migration (ADR-0001 decision
 * 14; 2026-08-13 addendum).
 *
 * v1 → v2: every legacy panel becomes a TabGroup with a single pinned tab.
 * Group ids reuse the legacy `panelId`. Instance ids derive deterministically
 * (`<panelId>/tab-0`).
 *
 * v2 → v1: flatten every tab to its own v1 panel so no surface is lost.
 * Grouping is not preserved (v1 cannot encode multi-tab groups).
 *
 * Rollback: v1 snapshots are never overwritten by the forward function;
 * readers keep accepting v1 for at least two releases.
 */

import { parseSurfaceTab } from '../surfaces/descriptor.ts';
import type { SurfaceLayoutSnapshot } from '../surfaces/types.ts';
import type { SurfaceInstance, TabGroup, WorkbenchLayout } from './types.ts';
import { WORKBENCH_LAYOUT_VERSION } from './types.ts';
import { normalizeGroupProportions } from './layout.ts';

export interface MigrateWorkbenchLayoutOptions {
  /** Timestamp stamped onto migrated instances; defaults to the snapshot's savedAt. */
  now?: number;
}

export function migrateSurfaceLayoutSnapshotToWorkbench(
  snapshot: SurfaceLayoutSnapshot,
  options: MigrateWorkbenchLayoutOptions = {},
): WorkbenchLayout {
  const now = options.now ?? snapshot.savedAt;

  const groups: TabGroup[] = snapshot.tabs.map((entry) => {
    const instance: SurfaceInstance = {
      id: `${entry.panelId}/tab-0`,
      tab: entry.tab,
      preview: false,
      dirty: false,
      openedAt: now,
      lastFocusedAt: now,
    };
    return {
      id: entry.panelId,
      tabs: [instance],
      activeTabId: instance.id,
      proportion: entry.proportion,
    };
  });

  const focused =
    snapshot.tabs.length === 0
      ? undefined
      : snapshot.tabs[Math.min(Math.max(snapshot.focusedIndex, 0), snapshot.tabs.length - 1)];

  return {
    version: WORKBENCH_LAYOUT_VERSION,
    workspaceId: snapshot.workspaceId,
    groups: normalizeGroupProportions(groups),
    activeGroupId: focused?.panelId ?? null,
  };
}

export interface MigrateWorkbenchToSnapshotOptions {
  savedAt?: number;
}

/**
 * Flatten v2 groups into v1 panels. Each tab becomes its own panel; group
 * share is split equally across the group's tabs. Focused tab → focusedIndex.
 */
export function migrateWorkbenchToSurfaceLayoutSnapshot(
  layout: WorkbenchLayout,
  options: MigrateWorkbenchToSnapshotOptions = {},
): SurfaceLayoutSnapshot {
  const tabs: SurfaceLayoutSnapshot['tabs'] = [];
  let focusedIndex = 0;
  const active = layout.groups.find((g) => g.id === layout.activeGroupId);

  for (const group of layout.groups) {
    if (group.tabs.length === 0) continue;
    const share = group.proportion / group.tabs.length;
    for (const instance of group.tabs) {
      if (active && instance.id === active.activeTabId) {
        focusedIndex = tabs.length;
      }
      tabs.push({
        panelId: instance.id,
        laneId: 'main',
        tab: instance.tab,
        proportion: share,
      });
    }
  }

  const normalized = tabs.length === 0
    ? tabs
    : (() => {
        const total = tabs.reduce((sum, t) => sum + t.proportion, 0);
        if (total <= 0) {
          const equal = 1 / tabs.length;
          return tabs.map((t) => ({ ...t, proportion: equal }));
        }
        return tabs.map((t) => ({ ...t, proportion: t.proportion / total }));
      })();

  return {
    version: 1,
    workspaceId: layout.workspaceId,
    lanes: [{ laneId: 'main', locked: false }],
    tabs: normalized,
    focusedIndex,
    savedAt: options.savedAt ?? Date.now(),
  };
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Typed read with fallback (S-03 §3.7 invariant 1): returns null on anything
 * that is not a valid v2 layout — never throws. v1 snapshots are NOT accepted
 * here; run `migrateSurfaceLayoutSnapshotToWorkbench` explicitly instead.
 */
export function parseWorkbenchLayout(raw: unknown): WorkbenchLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== WORKBENCH_LAYOUT_VERSION) return null;
  if (typeof candidate.workspaceId !== 'string') return null;
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
      const parsedTab = parseSurfaceTab(tab.tab);
      if (!parsedTab) return null;
      const preview =
        typeof tab.preview === 'boolean'
          ? tab.preview
          : tab.pinned !== true;
      const dirty = typeof tab.dirty === 'boolean' ? tab.dirty : false;
      if (typeof tab.openedAt !== 'number' || !Number.isFinite(tab.openedAt)) return null;
      if (typeof tab.lastFocusedAt !== 'number' || !Number.isFinite(tab.lastFocusedAt)) return null;
      tabs.push({
        id: tab.id,
        tab: parsedTab,
        preview,
        dirty,
        openedAt: tab.openedAt,
        lastFocusedAt: tab.lastFocusedAt,
      });
    }

    if (group.activeTabId !== null && typeof group.activeTabId !== 'string') return null;
    if (group.activeTabId !== null && !tabs.some((t) => t.id === group.activeTabId)) return null;

    groups.push({
      id: group.id,
      tabs,
      activeTabId: group.activeTabId as string | null,
      proportion: group.proportion,
    });
  }

  if (candidate.activeGroupId !== null && !groupIds.has(candidate.activeGroupId)) return null;

  return {
    version: WORKBENCH_LAYOUT_VERSION,
    workspaceId: candidate.workspaceId,
    groups,
    activeGroupId: candidate.activeGroupId,
  };
}
