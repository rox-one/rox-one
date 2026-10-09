/**
 * W1-09 (#1506) — Activity renderer contract (TECH-SPEC §4.11).
 *
 * Modules register one renderer per event type (or for their whole module
 * prefix) so the Feed and the Inbox render activity items without knowing any
 * module: the host looks up `forEvent(item.type)` and mounts what it gets.
 *
 * The registry is renderer-agnostic — `R` is a React component on the Electron
 * side, a view descriptor elsewhere — which keeps `@rox/core` free of UI
 * dependencies while the lookup rules stay in one place.
 */

import { moduleOfEventType } from './activity.ts'

export interface ActivityRendererRegistration<R> {
  /** Stable id (diagnostics, duplicates, i18n keys). */
  id: string
  /** Owner module (`goal`, `task`, `docs`, …). */
  module: string
  /** Exact event types; omitted → the renderer covers its whole module prefix. */
  eventTypes?: readonly string[] | undefined
  renderer: R
}

export class ActivityRendererRegistry<R> {
  private readonly byEventType = new Map<string, ActivityRendererRegistration<R>>()
  private readonly byModule = new Map<string, ActivityRendererRegistration<R>>()
  private readonly registrations: ActivityRendererRegistration<R>[] = []

  /**
   * Register a renderer. Registering the same event type or module twice is a
   * wiring bug (`module.*` fallback and an exact type for the same module are
   * fine — the exact type wins at lookup).
   */
  register(registration: ActivityRendererRegistration<R>): void {
    if (!registration.id || !registration.module) {
      throw new Error('Activity renderer registrations need an id and a module')
    }
    if (this.registrations.includes(registration)) return
    const eventTypes = registration.eventTypes ?? []
    if (eventTypes.length === 0) {
      if (this.byModule.has(registration.module)) {
        throw new Error(`Activity renderer already registered for module ${registration.module}`)
      }
      this.byModule.set(registration.module, registration)
    } else {
      for (const eventType of eventTypes) {
        if (this.byEventType.has(eventType)) {
          throw new Error(`Activity renderer already registered for ${eventType}`)
        }
      }
      for (const eventType of eventTypes) this.byEventType.set(eventType, registration)
    }
    this.registrations.push(registration)
  }

  /** Exact event type, then the module fallback; `undefined` when nothing handles it. */
  forEvent(eventType: string): ActivityRendererRegistration<R> | undefined {
    return this.byEventType.get(eventType) ?? this.byModule.get(moduleOfEventType(eventType))
  }

  has(eventType: string): boolean {
    return this.forEvent(eventType) !== undefined
  }

  list(): readonly ActivityRendererRegistration<R>[] {
    return [...this.registrations]
  }

  clear(): void {
    this.byEventType.clear()
    this.byModule.clear()
    this.registrations.length = 0
  }
}