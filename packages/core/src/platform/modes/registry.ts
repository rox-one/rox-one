/**
 * ModeRegistry implementation (ADR-0001).
 *
 * Pure TS store keyed by contribution id. Duplicate id: throw + log (S-03
 * §3.5 discipline — the first registration wins, the colliding one errors).
 */

import type { Disposable } from '../types.ts';
import { evaluateWhen } from '../context-keys/evaluate-when.ts';
import type { ContextKeys } from '../context-keys/types.ts';
import type { ModeContribution, ModeRegistry } from './types.ts';

class ModeRegistryImpl implements ModeRegistry {
  private readonly contributions = new Map<string, ModeContribution>();
  private readonly listeners = new Set<() => void>();

  register(contribution: ModeContribution): Disposable {
    if (this.contributions.has(contribution.id)) {
      console.error(`[ModeRegistry] duplicate contribution id: ${contribution.id}`);
      throw new Error(`Mode contribution id already registered: ${contribution.id}`);
    }
    this.contributions.set(contribution.id, contribution);
    this.notify();
    return {
      dispose: () => {
        if (this.contributions.delete(contribution.id)) this.notify();
      },
    };
  }

  unregister(id: string): void {
    if (this.contributions.delete(id)) this.notify();
  }

  get(id: string): ModeContribution | undefined {
    return this.contributions.get(id);
  }

  list(ctx: ContextKeys): ModeContribution[] {
    const matching: ModeContribution[] = [];
    for (const contribution of this.contributions.values()) {
      if (!evaluateWhen(contribution.when, ctx)) continue;
      matching.push(contribution);
    }
    return matching.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createModeRegistry(
  contributions: readonly ModeContribution[] = [],
): ModeRegistry {
  const registry = new ModeRegistryImpl();
  for (const contribution of contributions) registry.register(contribution);
  return registry;
}
