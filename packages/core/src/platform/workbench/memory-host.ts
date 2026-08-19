/**
 * In-memory WorkbenchLayout host — second adapter of the layout seam.
 * Pure reducers; no renderer/URL. S-02 WorkspaceSurfaceHost stays the
 * panel-stack snapshot interface until the renderer write path migrates.
 */

import type { Disposable } from '../types.ts';
import {
  activateTab,
  closeSurface,
  migrateLegacyLayout,
  moveSurface,
  openSurface,
  pinSurface,
  splitGroup,
} from './layout.ts';
import { parseWorkbenchLayout } from './migrate.ts';
import type {
  LayoutMutation,
  OpenSurfaceOptions,
  SurfaceInstance,
  SurfaceInstanceId,
  TabGroupId,
  WorkbenchLayout,
} from './types.ts';

export interface WorkbenchLayoutHost {
  open(instance: SurfaceInstance, options?: Partial<OpenSurfaceOptions>, newGroupId?: TabGroupId): SurfaceInstanceId;
  close(surfaceInstanceId: SurfaceInstanceId, options?: { force?: boolean }): LayoutMutation;
  pin(surfaceInstanceId: SurfaceInstanceId): void;
  move(surfaceInstanceId: SurfaceInstanceId, targetGroupId: TabGroupId): void;
  activate(groupId: TabGroupId, surfaceInstanceId: SurfaceInstanceId): void;
  split(groupId: TabGroupId, direction: 'right' | 'down'): TabGroupId | null;
  restore(raw: unknown): boolean;
  serializeLayout(): WorkbenchLayout;
  layout(): WorkbenchLayout;
  onDidChange(listener: () => void): Disposable;
}

export interface InMemoryWorkbenchLayoutHostOptions {
  workspaceId: string;
  now?: () => number;
}

export function createInMemoryWorkbenchLayoutHost(
  options: InMemoryWorkbenchLayoutHostOptions,
): WorkbenchLayoutHost {
  const now = options.now ?? Date.now;
  let current = migrateLegacyLayout({ workspaceId: options.workspaceId, entries: [], now: now() });
  const listeners = new Set<() => void>();
  let splitSeq = 0;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const setLayout = (next: WorkbenchLayout): void => {
    current = next;
    notify();
  };

  return {
    open(instance, openOptions, newGroupId) {
      setLayout(openSurface(current, instance, openOptions, newGroupId));
      return instance.id;
    },

    close(surfaceInstanceId, closeOptions) {
      const result = closeSurface(current, surfaceInstanceId, closeOptions);
      if (result.ok) setLayout(result.layout);
      return result;
    },

    pin(surfaceInstanceId) {
      setLayout(pinSurface(current, surfaceInstanceId));
    },

    move(surfaceInstanceId, targetGroupId) {
      setLayout(moveSurface(current, surfaceInstanceId, targetGroupId));
    },

    activate(groupId, surfaceInstanceId) {
      setLayout(activateTab(current, groupId, surfaceInstanceId, now()));
    },

    split(groupId, _direction) {
      const newGroupId = `${groupId}-split-${++splitSeq}`;
      const newInstanceId = `${newGroupId}-tab`;
      const before = current.groups.length;
      const next = splitGroup(current, groupId, newGroupId, newInstanceId, now());
      setLayout(next);
      if (next.groups.length === before) return null;
      return newGroupId;
    },

    restore(raw) {
      const parsed = parseWorkbenchLayout(raw);
      if (!parsed) return false;
      setLayout(structuredClone(parsed));
      return true;
    },

    serializeLayout() {
      return structuredClone(current);
    },

    layout() {
      return structuredClone(current);
    },

    onDidChange(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
