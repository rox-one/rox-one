/**
 * WorkbenchLayout v2 — real tab groups over the canonical SurfaceTab union
 * (ADR-0001 decisions 1/2/14/15; 2026-08-13 addendum).
 *
 * Replaces the flat `panelStackAtom` projection: each visible split is a
 * TabGroup with its own tabs and active tab; exactly one tab per group is
 * visible. Tabs reference the canonical `SurfaceTab` durable refs (S-02
 * §3.1/§3.7) — instance ids are ephemeral and never leave the session.
 *
 * Boundary notes (ADR-0001 Consequences):
 * - Panel-slot visibility/widths stay in `PanelRegistryState` /
 *   `LayoutProfile` (S-03 §3.7); they are NOT duplicated here.
 * - No `route` field: the renderer derives routes from the durable tab ref
 *   via `surfaceTabToRoute`; URL/NavigationContext stays the source of truth
 *   for the focused surface.
 * - Persisted layouts never contain empty groups (closing the last tab of a
 *   group closes the group); a host may render an empty group transiently.
 * - Geometry is 1D: groups are a row. Split-tree (`down`) is a later increment.
 */

import type { SurfaceTab } from '../surfaces/types.ts';

export type SurfaceInstanceId = string;
export type TabGroupId = string;

export const WORKBENCH_LAYOUT_VERSION = 2 as const;

export interface SurfaceInstance {
  id: SurfaceInstanceId;
  /** Durable ref (S-02 §3.7) — the only identity that survives restart. */
  tab: SurfaceTab;
  /**
   * Preview tabs (single-click open): one per group, replaced by the next
   * *clean* preview, promoted (preview → false) on edit, explicit pin, or
   * when a dirty preview would otherwise be replaced.
   * `preview === false` means the tab is pinned.
   */
  preview: boolean;
  dirty: boolean;
  openedAt: number;
  lastFocusedAt: number;
}

export function isPinnedSurface(instance: SurfaceInstance): boolean {
  return !instance.preview;
}

export interface TabGroup {
  id: TabGroupId;
  tabs: SurfaceInstance[];
  activeTabId: SurfaceInstanceId | null;
  /** Relative split share; group proportions within a layout normalize to 1. */
  proportion: number;
}

export interface WorkbenchLayout {
  version: typeof WORKBENCH_LAYOUT_VERSION;
  workspaceId: string;
  groups: TabGroup[];
  activeGroupId: TabGroupId | null;
}

export type OpenSurfaceTarget =
  | 'active-group'
  | 'new-group-right'
  /** Host concern: the pure reducers leave the layout unchanged. */
  | 'new-window';

export interface OpenSurfaceOptions {
  target: OpenSurfaceTarget;
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

/** Injectable id source so reducers stay deterministic under test. */
export interface IdGenerator {
  next(): string;
}

export function createSequentialIdGenerator(prefix = 'id'): IdGenerator {
  let next = 0;
  return { next: () => `${prefix}-${++next}` };
}
