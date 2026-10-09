/**
 * W1-09 (#1506) — renderer registry for activity items (TECH-SPEC §4.11).
 *
 * Modules register one renderer **per event type** (or for their whole module
 * prefix); the Feed and the Inbox look up `activityRendererFor(item.type)` and
 * mount whatever they get, so neither surface knows a module's components.
 * Registration is a wave-2 concern (GOAL, TSK, DOCS, …): this file is the
 * contract plus the process-wide registry they register into.
 *
 * The lookup rules live in `@rox/core/notify` (`ActivityRendererRegistry`), the
 * same object the workspace/agent surfaces use, so there is exactly one
 * resolution order: exact event type → module prefix → nothing.
 */

import type { ComponentType } from 'react'
import {
  ActivityRendererRegistry,
  type ActivityItem,
  type ActivityRendererRegistration,
} from '@rox/core/notify'

export interface ActivityRenderProps {
  /** Ids-only activity item (`type`, actor, subject, refs, revision, when). */
  item: ActivityItem
  /** Open the entity the item is about; titles are resolved by the host. */
  onOpen?(ref: NonNullable<ActivityItem['subject']>): void
}

export type ActivityRenderer = ComponentType<ActivityRenderProps>

/** One module's renderer registration (`eventTypes` omitted → the whole module). */
export type ActivityRendererEntry = ActivityRendererRegistration<ActivityRenderer>

const registry = new ActivityRendererRegistry<ActivityRenderer>()

/**
 * Register a module renderer. Called from module bootstrap code (wave 2):
 * registering the same event type or module twice throws — a silent
 * last-one-wins would make the Feed depend on import order.
 */
export function registerActivityRenderer(entry: ActivityRendererEntry): void {
  registry.register(entry)
}

export function activityRendererFor(eventType: string): ActivityRendererEntry | undefined {
  return registry.forEvent(eventType)
}

export function hasActivityRenderer(eventType: string): boolean {
  return registry.has(eventType)
}

export function listActivityRenderers(): readonly ActivityRendererEntry[] {
  return registry.list()
}

/** Test seam: module bootstrap is process-wide, so suites reset it. */
export function __resetActivityRenderersForTests(): void {
  registry.clear()
}