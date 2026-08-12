/**
 * WorkbenchLayout v2 — real tab groups over the canonical SurfaceTab union
 * (ADR-0001 decisions 1/2/14/15).
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
 */

import type { Disposable } from '../types.ts';
import type { SurfaceTab } from '../surfaces/types.ts';

export type SurfaceInstanceId = string;
export type TabGroupId = string;

export const WORKBENCH_LAYOUT_VERSION = 2 as const;

export interface SurfaceInstance {
  id: SurfaceInstanceId;
  /** Durable ref (S-02 §3.7) — the only identity that survives restart. */
  tab: SurfaceTab;
  pinned: boolean;
  /**
   * Preview tabs (single-click open): one per group, replaced by the next
   * preview, promoted to pinned on edit or explicit pin.
   */
  preview: boolean;
  dirty: boolean;
  openedAt: number;
  lastFocusedAt: number;
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
  | 'new-group-bottom'
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

/**
 * Host-facing workbench API (convergence plan §35.1). Implementations keep
 * `WorkbenchLayout` as the single layout state and emit onDidChange after
 * every mutation.
 */
export interface WorkbenchApi {
  open(tab: SurfaceTab, options?: Partial<OpenSurfaceOptions>): SurfaceInstanceId | null;
  close(surfaceInstanceId: SurfaceInstanceId): void;
  pin(surfaceInstanceId: SurfaceInstanceId): void;
  move(surfaceInstanceId: SurfaceInstanceId, targetGroupId: TabGroupId): void;
  activate(groupId: TabGroupId, surfaceInstanceId: SurfaceInstanceId): void;
  layout(): WorkbenchLayout;
  onDidChange(listener: () => void): Disposable;
}

/** Injectable id source so reducers stay deterministic under test. */
export interface IdGenerator {
  next(): string;
}
