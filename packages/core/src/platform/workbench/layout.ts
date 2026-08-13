/**
 * Pure WorkbenchLayout v2 reducers (ADR-0001; 2026-08-13 shell-seam spec).
 *
 * Every function takes a layout and returns a NEW layout — no mutation, no
 * React, no app deps. Ids come from an injectable IdGenerator (deterministic
 * in tests); timestamps from an injectable `now`.
 *
 * Semantics:
 * - opening into 'active-group' dedups by durable ref within that group
 *   (S-02 §3.7): re-opening an already-open surface activates it instead of
 *   duplicating it;
 * - a *clean* preview replaces the group's existing preview tab in place;
 * - a *dirty* preview is pinned, then the new preview is appended;
 * - pinning, dirty-marking and cross-group moves promote preview → pinned;
 * - closing a dirty tab without `{ force: true }` is DIRTY_SURFACE;
 * - closing/moving the last tab of a group closes the group; proportions of
 *   the survivors renormalize to 1;
 * - 'new-window' is a host concern: reducers return the layout unchanged.
 */

import { surfaceTabDurableKey } from '../surfaces/descriptor.ts';
import type { SurfaceTab } from '../surfaces/types.ts';
import type {
  IdGenerator,
  LayoutMutation,
  OpenSurfaceOptions,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroup,
  TabGroupId,
  WorkbenchLayout,
} from './types.ts';
import { DEFAULT_OPEN_SURFACE_OPTIONS, WORKBENCH_LAYOUT_VERSION } from './types.ts';

function randomIds(): IdGenerator {
  return {
    next: () => `surface-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

export function createEmptyWorkbenchLayout(workspaceId: string): WorkbenchLayout {
  return { version: WORKBENCH_LAYOUT_VERSION, workspaceId, groups: [], activeGroupId: null };
}

export interface SurfaceLocation {
  groupIndex: number;
  tabIndex: number;
  group: TabGroup;
  instance: SurfaceInstance;
}

export function findSurfaceLocation(
  layout: WorkbenchLayout,
  instanceId: SurfaceInstanceId,
): SurfaceLocation | null {
  for (let groupIndex = 0; groupIndex < layout.groups.length; groupIndex++) {
    const group = layout.groups[groupIndex];
    if (!group) continue;
    const tabIndex = group.tabs.findIndex((t) => t.id === instanceId);
    if (tabIndex === -1) continue;
    const instance = group.tabs[tabIndex];
    if (!instance) continue;
    return { groupIndex, tabIndex, group, instance };
  }
  return null;
}

export function getActiveSurface(layout: WorkbenchLayout): SurfaceInstance | null {
  const group = layout.groups.find((g) => g.id === layout.activeGroupId);
  if (!group || group.activeTabId === null) return null;
  return group.tabs.find((t) => t.id === group.activeTabId) ?? null;
}

/** Rescale proportions to sum 1; an all-zero input splits equally. */
export function normalizeGroupProportions(groups: TabGroup[]): TabGroup[] {
  if (groups.length === 0) return groups;
  const total = groups.reduce((sum, g) => sum + g.proportion, 0);
  if (total <= 0) {
    const equal = 1 / groups.length;
    return groups.map((g) => ({ ...g, proportion: equal }));
  }
  return groups.map((g) => ({ ...g, proportion: g.proportion / total }));
}

function createInstance(
  tab: SurfaceTab,
  mode: OpenSurfaceOptions['mode'],
  ids: IdGenerator,
  now: number,
): SurfaceInstance {
  return {
    id: ids.next(),
    tab,
    preview: mode === 'preview',
    dirty: false,
    openedAt: now,
    lastFocusedAt: now,
  };
}

/** Insert-share math: the new group gets 1/(n+1), existing groups scale down proportionally. */
function insertGroup(
  groups: TabGroup[],
  group: TabGroup,
  insertIndex: number,
): TabGroup[] {
  const share = 1 / (groups.length + 1);
  const scale = 1 - share;
  const scaled = groups.map((g) => ({ ...g, proportion: g.proportion * scale }));
  const at = Math.min(Math.max(insertIndex, 0), scaled.length);
  return [...scaled.slice(0, at), { ...group, proportion: share }, ...scaled.slice(at)];
}

export interface OpenSurfaceResult {
  layout: WorkbenchLayout;
  /** Null only for target 'new-window' (host concern). */
  instanceId: SurfaceInstanceId | null;
}

export function openSurface(
  layout: WorkbenchLayout,
  tab: SurfaceTab,
  options: Partial<OpenSurfaceOptions> = {},
  ids: IdGenerator = randomIds(),
  now: number = Date.now(),
): OpenSurfaceResult {
  const opts: OpenSurfaceOptions = { ...DEFAULT_OPEN_SURFACE_OPTIONS, ...options };
  if (opts.target === 'new-window') return { layout, instanceId: null };

  // --- New split group (also the fallback when no group exists yet) ---
  if (layout.groups.length === 0 || opts.target !== 'active-group') {
    const instance = createInstance(tab, opts.mode, ids, now);
    const group: TabGroup = {
      id: ids.next(),
      tabs: [instance],
      activeTabId: instance.id,
      proportion: 1,
    };
    const activeIndex = layout.groups.findIndex((g) => g.id === layout.activeGroupId);
    const groups = insertGroup(layout.groups, group, activeIndex + 1);
    return {
      layout: {
        ...layout,
        groups,
        activeGroupId: opts.focus || layout.activeGroupId === null ? group.id : layout.activeGroupId,
      },
      instanceId: instance.id,
    };
  }

  // --- Into the active group ---
  const groupIndex = Math.max(
    layout.groups.findIndex((g) => g.id === layout.activeGroupId),
    0,
  );
  const group = layout.groups[groupIndex];
  if (!group) return { layout, instanceId: null };

  // Dedup by durable ref within the target group.
  const key = surfaceTabDurableKey(tab);
  const existingIndex = group.tabs.findIndex((t) => surfaceTabDurableKey(t.tab) === key);
  const existing = existingIndex === -1 ? undefined : group.tabs[existingIndex];
  if (existing) {
    const promoted: SurfaceInstance = {
      ...existing,
      preview: opts.mode === 'pinned' ? false : existing.preview,
      lastFocusedAt: opts.focus ? now : existing.lastFocusedAt,
    };
    const tabs = group.tabs.map((t, i) => (i === existingIndex ? promoted : t));
    const groups = layout.groups.map((g, i) =>
      i === groupIndex
        ? { ...g, tabs, activeTabId: opts.focus ? existing.id : g.activeTabId }
        : g,
    );
    return {
      layout: {
        ...layout,
        groups,
        activeGroupId: opts.focus ? group.id : layout.activeGroupId,
      },
      instanceId: existing.id,
    };
  }

  const instance = createInstance(tab, opts.mode, ids, now);

  const previewIndex = instance.preview ? group.tabs.findIndex((t) => t.preview) : -1;
  const existingPreview = previewIndex === -1 ? undefined : group.tabs[previewIndex];
  let tabs: SurfaceInstance[];
  if (previewIndex === -1 || !existingPreview) {
    tabs = [...group.tabs, instance];
  } else if (existingPreview.dirty) {
    const pinnedDirty: SurfaceInstance = { ...existingPreview, preview: false };
    tabs = [
      ...group.tabs.map((t, i) => (i === previewIndex ? pinnedDirty : t)),
      instance,
    ];
  } else {
    tabs = group.tabs.map((t, i) => (i === previewIndex ? instance : t));
  }

  const groups = layout.groups.map((g, i) =>
    i === groupIndex
      ? { ...g, tabs, activeTabId: opts.focus || g.activeTabId === null ? instance.id : g.activeTabId }
      : g,
  );
  return {
    layout: {
      ...layout,
      groups,
      activeGroupId: opts.focus ? group.id : layout.activeGroupId,
    },
    instanceId: instance.id,
  };
}

export function closeSurface(
  layout: WorkbenchLayout,
  instanceId: SurfaceInstanceId,
  options: { force?: boolean } = {},
): LayoutMutation {
  const location = findSurfaceLocation(layout, instanceId);
  if (!location) return { ok: false, code: 'NOT_FOUND', layout };
  if (location.instance.dirty && !options.force) {
    return { ok: false, code: 'DIRTY_SURFACE', layout };
  }

  const { groupIndex, tabIndex, group } = location;
  const tabs = group.tabs.filter((_, i) => i !== tabIndex);
  if (tabs.length > 0) {
    const activeTabId =
      group.activeTabId === instanceId
        ? (tabs[Math.min(tabIndex, tabs.length - 1)]?.id ?? null)
        : group.activeTabId;
    const groups = layout.groups.map((g, i) => (i === groupIndex ? { ...g, tabs, activeTabId } : g));
    return { ok: true, layout: { ...layout, groups } };
  }

  const groups = normalizeGroupProportions(layout.groups.filter((_, i) => i !== groupIndex));
  const activeGroupId =
    layout.activeGroupId === group.id
      ? (groups[Math.min(groupIndex, groups.length - 1)]?.id ?? null)
      : layout.activeGroupId;
  return { ok: true, layout: { ...layout, groups, activeGroupId } };
}

export function activateTab(
  layout: WorkbenchLayout,
  groupId: TabGroupId,
  instanceId: SurfaceInstanceId,
  now: number = Date.now(),
): WorkbenchLayout {
  const group = layout.groups.find((g) => g.id === groupId);
  if (!group || !group.tabs.some((t) => t.id === instanceId)) return layout;
  const groups = layout.groups.map((g) =>
    g.id === groupId
      ? {
          ...g,
          activeTabId: instanceId,
          tabs: g.tabs.map((t) => (t.id === instanceId ? { ...t, lastFocusedAt: now } : t)),
        }
      : g,
  );
  return { ...layout, groups, activeGroupId: groupId };
}

export function activateGroup(layout: WorkbenchLayout, groupId: TabGroupId): WorkbenchLayout {
  if (!layout.groups.some((g) => g.id === groupId)) return layout;
  return { ...layout, activeGroupId: groupId };
}

export function pinSurface(layout: WorkbenchLayout, instanceId: SurfaceInstanceId): WorkbenchLayout {
  const location = findSurfaceLocation(layout, instanceId);
  if (!location) return layout;
  const groups = layout.groups.map((g, i) =>
    i === location.groupIndex
      ? {
          ...g,
          tabs: g.tabs.map((t, j) =>
            j === location.tabIndex ? { ...t, preview: false } : t,
          ),
        }
      : g,
  );
  return { ...layout, groups };
}

/** Editing a preview tab pins it (convergence plan §35.1). */
export function markSurfaceDirty(
  layout: WorkbenchLayout,
  instanceId: SurfaceInstanceId,
  dirty: boolean,
): WorkbenchLayout {
  const location = findSurfaceLocation(layout, instanceId);
  if (!location) return layout;
  const groups = layout.groups.map((g, i) =>
    i === location.groupIndex
      ? {
          ...g,
          tabs: g.tabs.map((t, j) =>
            j === location.tabIndex
              ? dirty
                ? { ...t, dirty: true, preview: false }
                : { ...t, dirty: false }
              : t,
          ),
        }
      : g,
  );
  return { ...layout, groups };
}

/**
 * Move a tab into another group (drag between groups). Explicit moves promote
 * preview → pinned and activate the target. An empty source group closes.
 */
export function moveSurface(
  layout: WorkbenchLayout,
  instanceId: SurfaceInstanceId,
  targetGroupId: TabGroupId,
  targetIndex?: number,
  now: number = Date.now(),
): WorkbenchLayout {
  const location = findSurfaceLocation(layout, instanceId);
  if (!location) return layout;
  const targetGroup = layout.groups.find((g) => g.id === targetGroupId);
  if (!targetGroup) return layout;

  const moved: SurfaceInstance = { ...location.instance, preview: false, lastFocusedAt: now };

  if (location.group.id === targetGroupId) {
    const without = targetGroup.tabs.filter((t) => t.id !== instanceId);
    const at = Math.min(Math.max(targetIndex ?? without.length, 0), without.length);
    const tabs = [...without.slice(0, at), moved, ...without.slice(at)];
    const groups = layout.groups.map((g) =>
      g.id === targetGroupId ? { ...g, tabs, activeTabId: instanceId } : g,
    );
    return { ...layout, groups, activeGroupId: targetGroupId };
  }

  const withoutSource = closeSurface(layout, instanceId, { force: true });
  const tabs = [...targetGroup.tabs];
  const at = Math.min(Math.max(targetIndex ?? tabs.length, 0), tabs.length);
  tabs.splice(at, 0, moved);
  const groups = withoutSource.layout.groups.map((g) =>
    g.id === targetGroupId ? { ...g, tabs, activeTabId: instanceId } : g,
  );
  return { ...withoutSource.layout, groups, activeGroupId: targetGroupId };
}

export interface MoveToNewGroupResult {
  layout: WorkbenchLayout;
  groupId: TabGroupId | null;
}

/** Drag-to-edge split: the tab leaves its group and lands in a new adjacent one. */
export function moveSurfaceToNewGroup(
  layout: WorkbenchLayout,
  instanceId: SurfaceInstanceId,
  ids: IdGenerator = randomIds(),
  now: number = Date.now(),
): MoveToNewGroupResult {
  const location = findSurfaceLocation(layout, instanceId);
  if (!location) return { layout, groupId: null };

  const moved: SurfaceInstance = { ...location.instance, preview: false, lastFocusedAt: now };
  const sourceIndex = location.groupIndex;
  const withoutSource = closeSurface(layout, instanceId, { force: true });

  const group: TabGroup = {
    id: ids.next(),
    tabs: [moved],
    activeTabId: moved.id,
    proportion: 1,
  };
  const anchorId = withoutSource.layout.groups[sourceIndex]?.id ?? withoutSource.layout.groups[sourceIndex - 1]?.id;
  const anchorIndex = withoutSource.layout.groups.findIndex((g) => g.id === anchorId);
  const groups = insertGroup(withoutSource.layout.groups, group, anchorIndex + 1);
  return {
    layout: { ...withoutSource.layout, groups, activeGroupId: group.id },
    groupId: group.id,
  };
}
