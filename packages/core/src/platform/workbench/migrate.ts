/**
 * SurfaceLayoutSnapshot v1 → WorkbenchLayout v2 migration (ADR-0001 decision
 * 14; convergence plan §38 phase C).
 *
 * Every legacy panel becomes a TabGroup with a single pinned tab — the flat
 * stack rendered all panels side by side, so each one maps to its own split.
 * Group ids reuse the legacy `panelId` so key-preserving restore (S-02 §3.10
 * step 1) keeps existing panels/sessions alive. Instance ids derive
 * deterministically (`<panelId>/tab-0`): restart restore must be stable.
 *
 * Rollback: v1 snapshots are never overwritten by this function; readers keep
 * accepting v1 for at least two releases.
 */

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
      pinned: true,
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

/**
 * Typed read with fallback (S-03 §3.7 invariant 1): returns null on anything
 * that is not a v2 layout — never throws. v1 snapshots are NOT accepted here;
 * run `migrateSurfaceLayoutSnapshotToWorkbench` explicitly instead.
 */
export function parseWorkbenchLayout(raw: unknown): WorkbenchLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<WorkbenchLayout>;
  if (candidate.version !== WORKBENCH_LAYOUT_VERSION) return null;
  if (typeof candidate.workspaceId !== 'string') return null;
  if (!Array.isArray(candidate.groups)) return null;
  for (const group of candidate.groups) {
    if (typeof group !== 'object' || group === null) return null;
    if (typeof group.id !== 'string' || !Array.isArray(group.tabs)) return null;
    if (typeof group.proportion !== 'number') return null;
    for (const tab of group.tabs) {
      if (typeof tab !== 'object' || tab === null) return null;
      if (typeof tab.id !== 'string' || typeof tab.tab !== 'object' || tab.tab === null) return null;
    }
  }
  if (candidate.activeGroupId !== null && typeof candidate.activeGroupId !== 'string') return null;
  return raw as WorkbenchLayout;
}
