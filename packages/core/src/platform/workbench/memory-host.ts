/**
 * In-memory WorkspaceSurfaceHost — second adapter of the host seam
 * (ADR-0001 addendum). Pure WorkbenchLayout reducers, no renderer/URL.
 */

import type { Disposable } from '../types.ts';
import type { SurfaceTab } from '../surfaces/types.ts';
import type { WorkspaceSurfaceHost } from '../surfaces/host.ts';
import type {
  IdGenerator,
  LayoutMutation,
  OpenSurfaceOptions,
  SurfaceInstanceId,
  TabGroupId,
  WorkbenchLayout,
} from './types.ts';
import { createSequentialIdGenerator } from './types.ts';
import {
  activateTab,
  closeSurface,
  createEmptyWorkbenchLayout,
  moveSurface,
  moveSurfaceToNewGroup,
  openSurface,
  pinSurface,
} from './layout.ts';

export interface InMemoryWorkspaceSurfaceHostOptions {
  workspaceId: string;
  ids?: IdGenerator;
  now?: () => number;
}

export function createInMemoryWorkspaceSurfaceHost(
  options: InMemoryWorkspaceSurfaceHostOptions,
): WorkspaceSurfaceHost {
  const ids = options.ids ?? createSequentialIdGenerator('surface');
  const now = options.now ?? Date.now;
  let current = createEmptyWorkbenchLayout(options.workspaceId);
  const listeners = new Set<() => void>();
  const bounds = new Map<
    SurfaceInstanceId,
    { x: number; y: number; width: number; height: number } | null
  >();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const setLayout = (next: WorkbenchLayout): void => {
    current = next;
    notify();
  };

  return {
    open(tab: SurfaceTab, openOptions?: Partial<OpenSurfaceOptions>): SurfaceInstanceId | null {
      const result = openSurface(current, tab, openOptions, ids, now());
      setLayout(result.layout);
      return result.instanceId;
    },

    close(surfaceInstanceId: SurfaceInstanceId, closeOptions?: { force?: boolean }): LayoutMutation {
      const result = closeSurface(current, surfaceInstanceId, closeOptions);
      if (result.ok) setLayout(result.layout);
      return result;
    },

    pin(surfaceInstanceId: SurfaceInstanceId): void {
      setLayout(pinSurface(current, surfaceInstanceId));
    },

    move(
      surfaceInstanceId: SurfaceInstanceId,
      targetGroupId: TabGroupId,
      targetIndex?: number,
    ): void {
      setLayout(moveSurface(current, surfaceInstanceId, targetGroupId, targetIndex, now()));
    },

    activate(groupId: TabGroupId, surfaceInstanceId: SurfaceInstanceId): void {
      setLayout(activateTab(current, groupId, surfaceInstanceId, now()));
    },

    split(surfaceInstanceId: SurfaceInstanceId, _direction: 'right' | 'down'): TabGroupId | null {
      const result = moveSurfaceToNewGroup(current, surfaceInstanceId, ids, now());
      setLayout(result.layout);
      return result.groupId;
    },

    async restore(layout: WorkbenchLayout): Promise<void> {
      setLayout(structuredClone(layout));
    },

    serializeLayout(): WorkbenchLayout {
      return structuredClone(current);
    },

    manageBounds(surfaceInstanceId, rect): void {
      bounds.set(surfaceInstanceId, rect);
    },

    layout(): WorkbenchLayout {
      return structuredClone(current);
    },

    onDidChange(listener: () => void): Disposable {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
