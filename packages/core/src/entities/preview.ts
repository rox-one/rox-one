/**
 * W1-02 — Preview contract.
 *
 * Renderers consume a `PreviewModel` (chips, hover cards, cards). When a ref
 * is not readable, resolvers MUST redact it to a `RestrictedPreview` — the
 * title/fields/people of a forbidden entity never cross the wire
 * (TECH-SPEC §3.3, "restricted" redaction).
 */

import type { Authority, EntityKind } from './kinds.ts'
import type { EntityRef } from './refs.ts'

export const PREVIEW_STATUSES = ['ok', 'no_access', 'minimal', 'tombstone', 'moved', 'unavailable'] as const

export type PreviewStatus = (typeof PREVIEW_STATUSES)[number]

export interface Badge {
  id: string
  label: string
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
}

export interface PreviewField {
  id: string
  label: string
  value: string
}

export type PreviewActionKind = 'open' | 'copy-link' | 'assign' | 'complete' | 'custom'

export interface PreviewAction {
  id: string
  label: string
  kind: PreviewActionKind
}

/** Resolver-produced entity preview (server side of the contract). */
export interface EntityPreview {
  ref: EntityRef
  status: PreviewStatus
  title: string
  kindLabel: string
  icon: string
  container?: { ref: EntityRef; title: string }[]
  authority: Authority
  badges?: Badge[]
  fields?: PreviewField[]
  actions?: PreviewAction[]
  movedTo?: EntityRef
  updatedAt?: string
  etag: string
}

export interface PreviewModelPerson {
  ref: EntityRef
  name: string
  avatarUrl?: string
}

export interface PreviewModelDates {
  created?: string
  updated?: string
  due?: string
  started?: string
  completed?: string
}

export interface PreviewModelProgress {
  done?: number
  total?: number
  percent?: number
  label?: string
}

/** Renderer-facing preview model (PLAN.md §3 W1-02). */
export interface PreviewModel {
  ref: EntityRef
  title: string
  icon: string
  status: PreviewStatus
  kindLabel: string
  restricted: boolean
  people?: PreviewModelPerson[]
  dates?: PreviewModelDates
  progress?: PreviewModelProgress
  badges?: Badge[]
  fields?: PreviewField[]
  actions?: PreviewAction[]
  updatedAt?: string
  etag: string
}

/** Redacted preview: only the ref survives; no entity data is exposed. */
export interface RestrictedPreview {
  ref: EntityRef | null
  kind: EntityKind
  status: Extract<PreviewStatus, 'no_access' | 'unavailable' | 'tombstone'>
  kindLabel: string
  icon: string
  title: string
  restricted: true
}

export function isRestrictedPreview(value: PreviewModel | RestrictedPreview): value is RestrictedPreview {
  return (value as RestrictedPreview).restricted === true
}

/** Opaque redaction marker returned by `applyPreviewRedaction` for bad refs. */
export interface RedactedEntityPreview {
  ref: EntityRef
  restricted: true
}

export function isRedactedPreviewRef(value: unknown): value is RedactedEntityPreview {
  return typeof value === 'object' && value !== null
    && (value as RedactedEntityPreview).restricted === true
    && typeof (value as RedactedEntityPreview).ref === 'object'
}

export function redactedEntityPreview(ref: EntityRef): RedactedEntityPreview {
  return { ref, restricted: true }
}

/** Build a `RestrictedPreview` for an unreadable ref. */
export function restrictPreview(ref: EntityRef | null, kind: EntityKind, icon: string, kindLabel: string): RestrictedPreview {
  return {
    ref,
    kind,
    status: 'no_access',
    kindLabel,
    icon,
    title: '',
    restricted: true,
  }
}

export interface PreviewModelExtras {
  people?: PreviewModelPerson[]
  dates?: PreviewModelDates
  progress?: PreviewModelProgress
}

/** Project a resolver `EntityPreview` into the renderer `PreviewModel`. */
export function previewModelFromEntityPreview(preview: EntityPreview, extras: PreviewModelExtras = {}): PreviewModel {
  return {
    ref: preview.ref,
    title: preview.title,
    icon: preview.icon,
    status: preview.status,
    kindLabel: preview.kindLabel,
    restricted: false,
    people: extras.people,
    dates: extras.dates,
    progress: extras.progress,
    badges: preview.badges,
    fields: preview.fields,
    actions: preview.actions,
    updatedAt: preview.updatedAt,
    etag: preview.etag,
  }
}

/**
 * Convert a resolver preview into a renderer model, redacting statuses that
 * must not expose entity data.
 */
export function applyPreviewRedaction(
  preview: EntityPreview,
  extras: PreviewModelExtras = {},
): PreviewModel | RestrictedPreview {
  if (preview.status === 'no_access' || preview.status === 'unavailable' || preview.status === 'tombstone') {
    const kindLabel = preview.kindLabel
    const icon = preview.icon
    return {
      ref: preview.ref,
      kind: preview.ref.kind,
      status: preview.status,
      kindLabel,
      icon,
      title: '',
      restricted: true,
    }
  }
  return previewModelFromEntityPreview(preview, extras)
}