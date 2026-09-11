/**
 * Convert collection filter slices into ViewConfig expressions.
 * Pure shared helpers — no renderer / localStorage.
 */

import type { CollectionFilters, DueRange } from '../sessions/collection-types.ts';
import { localDayBounds } from '../sessions/collection-query.ts';
import { getDefaultViews } from './defaults.ts';
import type { ViewConfig } from './types.ts';

export const SLICE_VIEW_ID_PREFIX = 'slice:';

export interface CollectionSliceLike {
  id: string;
  name?: string;
  nameKey?: string;
  filters: CollectionFilters;
  builtin?: boolean;
}

export type SliceLike = CollectionSliceLike;

const DEFAULT_SESSION_VIEW_IDS = new Set(getDefaultViews().map((view) => view.id));

/** Same signature as renderer collection-slices: sorted array JSON. */
export function filtersSignature(filters: CollectionFilters): string {
  return JSON.stringify({
    status: filters.status?.slice().sort() ?? null,
    priority: filters.priority?.slice().sort() ?? null,
    projectId: filters.projectId?.slice().sort() ?? null,
    labels: filters.labels?.slice().sort() ?? null,
    due: filters.due ?? null,
    flagged: filters.flagged ?? null,
    hasUnread: filters.hasUnread ?? null,
    model: filters.model?.slice().sort() ?? null,
  });
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function orEquals(field: string, values: string[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return `${field} == ${quote(values[0]!)}`;
  return `(${values.map((v) => `${field} == ${quote(v)}`).join(' or ')})`;
}

function dueClause(due: DueRange, now: number = Date.now()): string {
  switch (due.type) {
    case 'none':
      return 'dueBucket == "none"';
    case 'overdue':
      return 'dueBucket == "overdue"';
    case 'today':
      return 'dueBucket == "today"';
    case 'next_n_days': {
      const { start } = localDayBounds(now);
      const end = start + due.days * 24 * 60 * 60 * 1000 - 1;
      return `dueDate >= ${start} and dueDate <= ${end}`;
    }
    case 'range':
      return `dueDate >= ${due.start} and dueDate <= ${due.end}`;
  }
}

/** Compile CollectionFilters into a Filtrex expression. Empty → "true". */
export function filtersToExpression(filters: CollectionFilters, now: number = Date.now()): string {
  const parts: string[] = [];
  const status = orEquals('sessionStatus', filters.status ?? []);
  if (status) parts.push(status);
  const priority = orEquals('priority', filters.priority ?? []);
  if (priority) parts.push(priority);
  const projectId = orEquals('projectId', filters.projectId ?? []);
  if (projectId) parts.push(projectId);
  if (filters.labels && filters.labels.length > 0) {
    if (filters.labels.length === 1) {
      parts.push(`contains(labels, ${quote(filters.labels[0]!)})`);
    } else {
      parts.push(`(${filters.labels.map((l) => `contains(labels, ${quote(l)})`).join(' or ')})`);
    }
  }
  if (filters.due) parts.push(dueClause(filters.due, now));
  if (typeof filters.flagged === 'boolean') {
    parts.push(`isFlagged == ${filters.flagged}`);
  }
  if (typeof filters.hasUnread === 'boolean') {
    parts.push(`hasUnread == ${filters.hasUnread}`);
  }
  const model = orEquals('model', filters.model ?? []);
  if (model) parts.push(model);
  return parts.length === 0 ? 'true' : parts.join(' and ');
}

export const collectionFiltersToExpression = filtersToExpression;

function sliceName(slice: CollectionSliceLike): string {
  if (slice.name && slice.name.trim()) return slice.name.trim();
  return slice.id;
}

export function sliceToView(slice: CollectionSliceLike): ViewConfig {
  const rawId = slice.id.startsWith(SLICE_VIEW_ID_PREFIX) ? slice.id : `${SLICE_VIEW_ID_PREFIX}${slice.id}`;
  return {
    id: rawId,
    name: sliceName(slice),
    domain: 'sessions',
    expression: filtersToExpression(slice.filters),
    collectionFilters: slice.filters,
  };
}

export const sliceToViewConfig = sliceToView;

export function viewToCollectionSlice(view: ViewConfig): CollectionSliceLike | null {
  if ((view.domain ?? 'sessions') !== 'sessions') return null;
  if (!view.collectionFilters) return null;
  return {
    id: view.id,
    name: view.name,
    filters: { ...view.collectionFilters },
    builtin: false,
  };
}

export function userCollectionSlices(views: readonly ViewConfig[]): CollectionSliceLike[] {
  const out: CollectionSliceLike[] = [];
  for (const view of views) {
    if (DEFAULT_SESSION_VIEW_IDS.has(view.id)) continue;
    if ((view.domain ?? 'sessions') !== 'sessions') continue;
    const slice = viewToCollectionSlice(view);
    if (slice) out.push(slice);
  }
  return out;
}

function isManagedSliceView(view: ViewConfig): boolean {
  if ((view.domain ?? 'sessions') !== 'sessions') return false;
  if (DEFAULT_SESSION_VIEW_IDS.has(view.id)) return false;
  if (view.id.startsWith(SLICE_VIEW_ID_PREFIX) || view.id.startsWith('slice-')) return true;
  return Boolean(view.collectionFilters);
}

/**
 * Replace managed Filter-menu slice views. Knowledge views and default
 * session views (New/Plan/Explore/Processing) are kept. Built-in Filter
 * shortcuts are never written to views.json.
 */
export function mergeSliceViews(
  existing: readonly ViewConfig[],
  slices: readonly CollectionSliceLike[],
): ViewConfig[] {
  const kept = existing.filter((view) => !isManagedSliceView(view));
  const sliceViews = slices.filter((slice) => !slice.builtin).map(sliceToView);
  return [...kept, ...sliceViews];
}
