/**
 * Convert collection filter slices into ViewConfig expressions.
 * Pure shared helpers — no renderer / localStorage.
 */

import type { CollectionFilters, DueRange } from '../sessions/collection-types.ts';
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

function dueClause(due: DueRange): string {
  switch (due.type) {
    case 'none':
      return 'dueBucket == "none"';
    case 'overdue':
      return 'dueBucket == "overdue"';
    case 'today':
      return 'dueBucket == "today"';
    case 'next_n_days':
      return `dueDate >= startOfToday() and dueDate <= startOfToday() + ${due.days} * 86400000 - 1`;
    case 'range':
      return `dueDate >= ${due.start} and dueDate <= ${due.end}`;
  }
}

/** Compile CollectionFilters into a Filtrex expression. Empty → "true". */
export function filtersToExpression(filters: CollectionFilters): string {
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
  if (filters.due) parts.push(dueClause(filters.due));
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
    const slice = viewToCollectionSlice(view);
    if (slice) out.push(slice);
  }
  return out;
}

/**
 * Append slice-derived views that are not already present (by id or
 * collectionFilters signature). Existing views are never rewritten.
 */
export function mergeSliceViews(
  existing: readonly ViewConfig[],
  slices: readonly CollectionSliceLike[],
): ViewConfig[] {
  const ids = new Set(existing.map((v) => v.id));
  const signatures = new Set(
    existing
      .map((v) => (v.collectionFilters ? filtersSignature(v.collectionFilters) : null))
      .filter((s): s is string => s != null),
  );
  const next = [...existing];
  for (const slice of slices) {
    const view = sliceToView(slice);
    const sig = filtersSignature(slice.filters);
    if (ids.has(view.id) || signatures.has(sig)) continue;
    ids.add(view.id);
    signatures.add(sig);
    next.push(view);
  }
  return next;
}
