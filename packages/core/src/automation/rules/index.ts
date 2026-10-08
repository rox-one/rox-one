/**
 * W1-12 (#1509) — The five declared rules, in the order they are evaluated.
 * The order is part of the contract: R3 (welcome) runs before R5 (drive) for
 * `identity.account_created`, and R2 before R3 for a member who joins as they
 * sign in (INDEX.md / DATA-MODEL §5.16 ordering note).
 */

import type { DomainEvent } from '../../events/types.ts'
import type { DomainRule, RuleId } from '../rule.ts'
import { R1 } from './r1.ts'
import { R2 } from './r2.ts'
import { R3 } from './r3.ts'
import { R4 } from './r4.ts'
import { R5 } from './r5.ts'

export const DOMAIN_RULES: readonly DomainRule<DomainEvent>[] = [R1, R2, R3, R4, R5]

export function ruleById(id: RuleId): DomainRule<DomainEvent> | undefined {
  return DOMAIN_RULES.find(rule => rule.id === id)
}

/** Every rule triggered by a `domain_event.type` (order preserved). */
export function rulesForEventType(type: string): DomainRule<DomainEvent>[] {
  return DOMAIN_RULES.filter(rule => rule.triggers.includes(type as DomainEvent['type']))
}

export * from './r1.ts'
export * from './r2.ts'
export * from './r3.ts'
export * from './r4.ts'
export * from './r5.ts'