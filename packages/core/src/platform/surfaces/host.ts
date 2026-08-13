/**
 * WorkspaceSurfaceHost — S-02 §3.4 rewritten to speak WorkbenchLayout
 * (ADR-0001 2026-08-13 addendum). There is no second WorkbenchApi.
 *
 * Geometry is 1D: split('right' | 'down') both insert a group to the right.
 * URL/NavigationContext remains focus SoT in the renderer adapter; this
 * interface owns TabGroup membership, preview/dirty, and split shares.
 */

import type { Disposable } from '../types.ts';
import type { SurfaceTab } from './types.ts';
import type {
  LayoutMutation,
  OpenSurfaceOptions,
  SurfaceInstanceId,
  TabGroupId,
  WorkbenchLayout,
} from '../workbench/types.ts';

export interface WorkspaceSurfaceHost {
  open(tab: SurfaceTab, options?: Partial<OpenSurfaceOptions>): SurfaceInstanceId | null;
  close(surfaceInstanceId: SurfaceInstanceId, options?: { force?: boolean }): LayoutMutation;
  pin(surfaceInstanceId: SurfaceInstanceId): void;
  move(
    surfaceInstanceId: SurfaceInstanceId,
    targetGroupId: TabGroupId,
    targetIndex?: number,
  ): void;
  activate(groupId: TabGroupId, surfaceInstanceId: SurfaceInstanceId): void;
  /**
   * Returns the new group id. Both directions insert to the right until a
   * split-tree increment exists.
   */
  split(
    surfaceInstanceId: SurfaceInstanceId,
    direction: 'right' | 'down',
    proportion?: number,
  ): TabGroupId | null;
  restore(layout: WorkbenchLayout): Promise<void>;
  serializeLayout(): WorkbenchLayout;
  manageBounds(
    surfaceInstanceId: SurfaceInstanceId,
    rect: { x: number; y: number; width: number; height: number } | null,
  ): void;
  layout(): WorkbenchLayout;
  onDidChange(listener: () => void): Disposable;
}
