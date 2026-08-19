/**
 * WorkbenchLayout v2 (ADR-0001).
 *
 * TabGroups are independent of Surface identity: one object can be open in
 * several tabs. The renderer keeps URL / NavigationContext as the focused
 * surface source of truth; this snapshot is a derived, restorable layout.
 */

import type { SurfaceTab } from '../surfaces/types.ts';

export type SurfaceInstanceId = string;
export type TabGroupId = string;

/**
 * Tab payload inside a group. Existing S-02 SurfaceTab kinds plus a
 * `legacy-route` bucket for navigator panels that are not surfaces yet
 * (settings/sources/skills). Do not add one union variant per entity.
 */
export type WorkbenchTab = SurfaceTab | { kind: 'legacy-route' };

export interface SurfaceInstance {
  id: SurfaceInstanceId;
  tab: WorkbenchTab;
  route: string;
  /** `true` = preview tab; `false` = pinned. One bit so both cannot be set. */
  preview: boolean;
  dirty: boolean;
  openedAt: number;
  lastFocusedAt: number;
}

export interface TabGroup {
  id: TabGroupId;
  tabs: SurfaceInstance[];
  activeTabId: SurfaceInstanceId | null;
  proportion: number;
}

export interface WorkbenchLayout {
  version: 2;
  workspaceId: string;
  groups: TabGroup[];
  activeGroupId: TabGroupId | null;
  /** Present when this layout was produced from SurfaceLayoutSnapshot v1 / panel stack. */
  migratedFromVersion?: 1;
}

export interface LegacyPanelStackEntry {
  id: string;
  route: string;
  tab: WorkbenchTab;
  proportion?: number;
}

export interface OpenSurfaceOptions {
  target: 'active-group' | 'new-group-right' | 'new-window';
  mode: 'preview' | 'pinned';
  focus: boolean;
}

export const DEFAULT_OPEN_SURFACE_OPTIONS: OpenSurfaceOptions = {
  target: 'active-group',
  mode: 'preview',
  focus: true,
};

export type LayoutMutationCode = 'DIRTY_SURFACE' | 'NOT_FOUND';

export type LayoutMutation =
  | { ok: true; layout: WorkbenchLayout }
  | { ok: false; code: LayoutMutationCode; layout: WorkbenchLayout };

export function isPinnedSurface(instance: SurfaceInstance): boolean {
  return !instance.preview;
}
