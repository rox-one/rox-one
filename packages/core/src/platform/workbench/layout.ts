import { surfaceTabDurableKey } from '../surfaces/descriptor.ts';
import type { SurfaceTab } from '../surfaces/types.ts';
import type {
  LayoutMutation,
  LegacyPanelStackEntry,
  OpenSurfaceOptions,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroup,
  TabGroupId,
  WorkbenchLayout,
  WorkbenchTab,
} from './types.ts';
import { DEFAULT_OPEN_SURFACE_OPTIONS } from './types.ts';

export function workbenchTabKey(tab: WorkbenchTab, route: string): string {
  if (tab.kind === 'legacy-route') return `legacy:${route}`;
  return surfaceTabDurableKey(tab);
}

function isSurfaceTab(tab: WorkbenchTab): tab is SurfaceTab {
  return tab.kind !== 'legacy-route';
}

export function migrateLegacyLayout(input: {
  workspaceId: string;
  entries: readonly LegacyPanelStackEntry[];
  focusedId?: string | null;
  now?: number;
}): WorkbenchLayout {
  const now = input.now ?? 0;
  const count = input.entries.length;
  const groups: TabGroup[] = input.entries.map((entry) => {
    const instance: SurfaceInstance = {
      id: entry.id,
      tab: entry.tab,
      route: entry.route,
      preview: false,
      dirty: false,
      openedAt: now,
      lastFocusedAt: now,
    };
    return {
      id: entry.id,
      tabs: [instance],
      activeTabId: entry.id,
      proportion: entry.proportion && entry.proportion > 0 ? entry.proportion : count > 0 ? 1 / count : 1,
    };
  });
  const focused = input.focusedId
    ? groups.find((group) => group.id === input.focusedId)
    : groups[0];
  return {
    version: 2,
    workspaceId: input.workspaceId,
    groups: renormalize(groups),
    activeGroupId: focused?.id ?? groups[0]?.id ?? null,
    migratedFromVersion: 1,
  };
}

export function activeInstance(layout: WorkbenchLayout): SurfaceInstance | null {
  const group = layout.groups.find((item) => item.id === layout.activeGroupId);
  if (!group || group.activeTabId === null) return null;
  return group.tabs.find((tab) => tab.id === group.activeTabId) ?? null;
}

export function activateTab(
  layout: WorkbenchLayout,
  groupId: TabGroupId,
  tabId: SurfaceInstanceId,
  now: number,
): WorkbenchLayout {
  const groups = layout.groups.map((group) => {
    if (group.id !== groupId) return group;
    const tab = group.tabs.find((item) => item.id === tabId);
    if (!tab) return group;
    return {
      ...group,
      activeTabId: tabId,
      tabs: group.tabs.map((item) =>
        item.id === tabId ? { ...item, lastFocusedAt: now } : item,
      ),
    };
  });
  return { ...layout, groups, activeGroupId: groupId };
}

export function closeSurface(
  layout: WorkbenchLayout,
  surfaceInstanceId: SurfaceInstanceId,
  options: { force?: boolean } = {},
): LayoutMutation {
  let found = false;
  let dirty = false;
  for (const group of layout.groups) {
    const tab = group.tabs.find((item) => item.id === surfaceInstanceId);
    if (!tab) continue;
    found = true;
    dirty = tab.dirty;
    break;
  }
  if (!found) return { ok: false, code: 'NOT_FOUND', layout };
  if (dirty && !options.force) return { ok: false, code: 'DIRTY_SURFACE', layout };

  const groups: TabGroup[] = [];
  for (const group of layout.groups) {
    const index = group.tabs.findIndex((tab) => tab.id === surfaceInstanceId);
    if (index < 0) {
      groups.push(group);
      continue;
    }
    const tabs = group.tabs.filter((tab) => tab.id !== surfaceInstanceId);
    if (tabs.length === 0) continue;
    const fallback = tabs[Math.min(index, tabs.length - 1)];
    groups.push({
      ...group,
      tabs,
      activeTabId: group.activeTabId === surfaceInstanceId ? (fallback?.id ?? null) : group.activeTabId,
    });
  }
  const activeGroupId =
    groups.some((group) => group.id === layout.activeGroupId)
      ? layout.activeGroupId
      : (groups[0]?.id ?? null);
  return { ok: true, layout: { ...layout, groups: renormalize(groups), activeGroupId } };
}

export function splitGroup(
  layout: WorkbenchLayout,
  groupId: TabGroupId,
  newGroupId: TabGroupId,
  newInstanceId: SurfaceInstanceId,
  now: number,
): WorkbenchLayout {
  const sourceIndex = layout.groups.findIndex((group) => group.id === groupId);
  const source = sourceIndex >= 0 ? layout.groups[sourceIndex] : undefined;
  if (!source) return layout;
  const sourceTab = source.tabs.find((tab) => tab.id === source.activeTabId) ?? source.tabs[0];
  if (!sourceTab) return layout;
  const clone: SurfaceInstance = {
    ...sourceTab,
    id: newInstanceId,
    preview: false,
    openedAt: now,
    lastFocusedAt: now,
  };
  const newGroup: TabGroup = {
    id: newGroupId,
    tabs: [clone],
    activeTabId: clone.id,
    proportion: source.proportion,
  };
  const groups = [...layout.groups];
  groups.splice(sourceIndex + 1, 0, newGroup);
  return {
    ...layout,
    groups: renormalize(groups),
    activeGroupId: newGroupId,
  };
}

export function moveSurface(
  layout: WorkbenchLayout,
  surfaceInstanceId: SurfaceInstanceId,
  targetGroupId: TabGroupId,
): WorkbenchLayout {
  let moving: SurfaceInstance | undefined;
  const stripped: TabGroup[] = [];
  for (const group of layout.groups) {
    const tab = group.tabs.find((item) => item.id === surfaceInstanceId);
    if (!tab) {
      stripped.push(group);
      continue;
    }
    moving = tab;
    const tabs = group.tabs.filter((item) => item.id !== surfaceInstanceId);
    if (tabs.length === 0) continue;
    stripped.push({
      ...group,
      tabs,
      activeTabId: group.activeTabId === surfaceInstanceId ? (tabs[0]?.id ?? null) : group.activeTabId,
    });
  }
  if (!moving) return layout;
  const moved = moving;
  const groups = stripped.map((group) => {
    if (group.id !== targetGroupId) return group;
    if (group.tabs.some((tab) => tab.id === moved.id)) return group;
    return {
      ...group,
      tabs: [...group.tabs, moved],
      activeTabId: moved.id,
    };
  });
  if (!groups.some((group) => group.id === targetGroupId)) return layout;
  return {
    ...layout,
    groups: renormalize(groups),
    activeGroupId: targetGroupId,
  };
}

export function openSurface(
  layout: WorkbenchLayout,
  instance: SurfaceInstance,
  options: Partial<OpenSurfaceOptions> = {},
  newGroupId?: TabGroupId,
): WorkbenchLayout {
  const resolved: OpenSurfaceOptions = { ...DEFAULT_OPEN_SURFACE_OPTIONS, ...options };
  if (resolved.target === 'new-window') {
    // Renderer owns native windows; layout is unchanged.
    return layout;
  }
  if (resolved.target === 'new-group-right') {
    const groupId = newGroupId ?? instance.id;
    const group: TabGroup = {
      id: groupId,
      tabs: [{ ...instance, preview: resolved.mode === 'preview' }],
      activeTabId: instance.id,
      proportion: 1,
    };
    const groups = [...layout.groups, group];
    return {
      ...layout,
      groups: renormalize(groups),
      activeGroupId: resolved.focus ? groupId : layout.activeGroupId ?? groupId,
    };
  }

  const groupId = layout.activeGroupId ?? layout.groups[0]?.id;
  if (!groupId) {
    return openSurface(layout, instance, { ...resolved, target: 'new-group-right' }, newGroupId);
  }
  const groups = layout.groups.map((group) => {
    if (group.id !== groupId) return group;
    const key = workbenchTabKey(instance.tab, instance.route);
    const existing = group.tabs.find((tab) => workbenchTabKey(tab.tab, tab.route) === key);
    if (existing) {
      return {
        ...group,
        activeTabId: resolved.focus ? existing.id : group.activeTabId,
        tabs: group.tabs.map((tab) =>
          tab.id === existing.id ? { ...tab, lastFocusedAt: instance.lastFocusedAt } : tab,
        ),
      };
    }
    let tabs = group.tabs;
    if (resolved.mode === 'preview') {
      const previewIndex = tabs.findIndex((tab) => tab.preview && !tab.dirty);
      if (previewIndex >= 0) {
        tabs = tabs.map((tab, index) => (index === previewIndex ? { ...instance, preview: true } : tab));
        return { ...group, tabs, activeTabId: resolved.focus ? instance.id : group.activeTabId };
      }
      tabs = tabs.map((tab) => (tab.preview && tab.dirty ? { ...tab, preview: false } : tab));
    }
    const next: SurfaceInstance = {
      ...instance,
      preview: resolved.mode === 'preview',
    };
    return {
      ...group,
      tabs: [...tabs, next],
      activeTabId: resolved.focus ? instance.id : group.activeTabId,
    };
  });
  return {
    ...layout,
    groups,
    activeGroupId: resolved.focus ? groupId : layout.activeGroupId,
  };
}

export function pinSurface(layout: WorkbenchLayout, surfaceInstanceId: SurfaceInstanceId): WorkbenchLayout {
  return {
    ...layout,
    groups: layout.groups.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) =>
        tab.id === surfaceInstanceId ? { ...tab, preview: false } : tab,
      ),
    })),
  };
}

export function workbenchLayoutToPanelEntries(
  layout: WorkbenchLayout,
): Array<{ id: string; route: string; proportion: number }> {
  return layout.groups.map((group) => {
    const active = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
    return {
      id: group.id,
      route: active?.route ?? '',
      proportion: group.proportion,
    };
  });
}

function renormalize(groups: TabGroup[]): TabGroup[] {
  if (groups.length === 0) return groups;
  const total = groups.reduce((sum, group) => sum + group.proportion, 0);
  if (total <= 0) {
    const equal = 1 / groups.length;
    return groups.map((group) => ({ ...group, proportion: equal }));
  }
  return groups.map((group) => ({ ...group, proportion: group.proportion / total }));
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function describeWorkbenchTab(tab: WorkbenchTab): string {
  if (!isSurfaceTab(tab)) return 'legacy-route';
  switch (tab.kind) {
    case 'session':
      return `session:${tab.sessionId}`;
    case 'browser':
      return `browser:${tab.tabId}`;
    case 'knowledge':
      return `knowledge:${tab.ref.id}`;
    case 'database':
      return `database:${tab.ref.id}`;
    case 'cloud-run':
      return `cloud-run:${tab.runId}`;
    case 'extension':
      return `extension:${tab.extensionId}`;
    case 'diff':
      return `diff:${tab.proposalId}`;
    default: {
      const _exhaustive: never = tab;
      return assertNever(_exhaustive);
    }
  }
}
