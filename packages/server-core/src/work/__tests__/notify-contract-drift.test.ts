/**
 * W1-09 (#1506) — `notifications.*` payload contract parity.
 *
 * The canonical payload contract is
 * `packages/shared/src/domain/notify/schema.ts` (`NOTIFY_COMMAND_SCHEMAS`,
 * TECH-SPEC §4.14 / DATA-MODEL §5.13). `@rox/core` is dependency-free by
 * contract and cannot import it, so `packages/core/src/notify/command-bindings.ts`
 * re-issues the same contract structurally and mirrors the field names in
 * `NOTIFY_DOMAIN_FIELDS`.
 *
 * That hand copy is what drifted: the structural gateway rejected the
 * documented `{ notificationIds }` payload with `Unknown notifications.mark_read
 * field`, and it is the validator that wins in a notify-host process
 * (`COMMAND_MODULES` binds the notify module after `domain-schemas`, last-wins).
 * This suite pins the two together — add a field to the domain zod schema and
 * forget `NOTIFY_DOMAIN_FIELDS` and the structural schema, and this fails here
 * instead of silently rejecting the documented payload at runtime.
 */
import { describe, expect, test } from 'bun:test'
import { COMMAND_PAYLOAD_SCHEMAS } from '@rox/shared/domain'
import {
  NOTIFICATIONS_MARK_ALL_READ_SCHEMA,
  NOTIFICATIONS_MARK_READ_SCHEMA,
  NOTIFICATIONS_UPDATE_PREFS_SCHEMA,
  NOTIFY_COMMAND_TYPES,
  NOTIFY_DOMAIN_FIELDS,
  type NotifyCommandType,
} from '@rox/core/notify'

/**
 * The canonical payload per command — the spelling the reference scenario
 * executes (`reference-scenario.ts`, `notifications.*` steps) and the one the
 * domain schema is written for.
 */
const CANONICAL_PAYLOADS: Record<NotifyCommandType, Record<string, unknown>> = {
  'notifications.mark_read': { notificationIds: ['11111111-1111-4111-8111-111111111111'] },
  'notifications.mark_all_read': {},
  'notifications.update_prefs': { prefs: [{ eventType: 'task.task_adding', channel: 'email', enabled: false }] },
}

/** The structural schemas the notify module binds (`@rox/core/notify`). */
const STRUCTURAL_SCHEMAS = {
  'notifications.mark_read': NOTIFICATIONS_MARK_READ_SCHEMA,
  'notifications.mark_all_read': NOTIFICATIONS_MARK_ALL_READ_SCHEMA,
  'notifications.update_prefs': NOTIFICATIONS_UPDATE_PREFS_SCHEMA,
} as const

/**
 * Declared payload fields of a domain command schema (`cmd()` is a zod strict
 * object). `CommandSchemaMap` widens every value to `z.ZodType`, so the shape is
 * read through a runtime guard instead of an unchecked cast.
 */
function domainPayloadFields(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null || !('shape' in schema)) {
    throw new Error('domain command schema is not an object with a payload shape')
  }
  const { shape } = schema
  if (typeof shape !== 'object' || shape === null) throw new Error('domain command schema has no payload shape')
  return Object.keys(shape).sort()
}

describe('notifications.* payload contract parity', () => {
  test.each([...NOTIFY_COMMAND_TYPES])('%s mirrors the domain payload fields', type => {
    expect(domainPayloadFields(COMMAND_PAYLOAD_SCHEMAS[type])).toEqual([...NOTIFY_DOMAIN_FIELDS[type]].sort())
  })

  test.each([...NOTIFY_COMMAND_TYPES])('%s accepts the canonical payload', type => {
    const payload = CANONICAL_PAYLOADS[type]
    // The domain schema is the contract…
    expect(COMMAND_PAYLOAD_SCHEMAS[type]!.safeParse(payload).success).toBe(true)
    // …and the structural gateway must accept at least everything it accepts,
    // because in the workspace service it is the one that validates.
    expect(STRUCTURAL_SCHEMAS[type].safeParse(payload).success).toBe(true)
  })

  test.each([...NOTIFY_COMMAND_TYPES])('%s still rejects an unknown field', type => {
    expect(STRUCTURAL_SCHEMAS[type].safeParse({ ...CANONICAL_PAYLOADS[type], __unknown: true }).success).toBe(false)
  })
})
