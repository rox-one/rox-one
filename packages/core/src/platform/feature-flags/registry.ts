/**
 * FeatureFlagRegistry implementation (ADR-0001 decision 16; 2026-08-13 addendum).
 *
 * Two-phase resolution (order-independent):
 * 1. base = override ?? defaultValue; unknown deps and cycles disable;
 * 2. incompatibility:
 *    - one-way (A lists B, B does not list A): A yields;
 *    - mutual: lexicographically smaller id wins, larger yields.
 */

import type { Disposable } from '../types.ts';
import type {
  FeatureFlagDefinition,
  FeatureFlagOverrides,
  FeatureFlagRegistry,
  FeatureFlagResolution,
  FeatureFlagResolutionSource,
} from './types.ts';

const NO_OVERRIDES: FeatureFlagOverrides = {};

class FeatureFlagRegistryImpl implements FeatureFlagRegistry {
  private readonly definitions = new Map<string, FeatureFlagDefinition>();
  private readonly listeners = new Set<() => void>();

  register(definition: FeatureFlagDefinition): Disposable {
    if (this.definitions.has(definition.id)) {
      console.error(`[FeatureFlagRegistry] duplicate flag id: ${definition.id}`);
      throw new Error(`Feature flag id already registered: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
    this.notify();
    return {
      dispose: () => {
        if (this.definitions.delete(definition.id)) this.notify();
      },
    };
  }

  get(id: string): FeatureFlagDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): FeatureFlagDefinition[] {
    return [...this.definitions.values()];
  }

  isEnabled(id: string, overrides: FeatureFlagOverrides = NO_OVERRIDES): boolean {
    return this.resolve(id, overrides).enabled;
  }

  resolve(id: string, overrides: FeatureFlagOverrides = NO_OVERRIDES): FeatureFlagResolution {
    const all = this.resolveAllInner(overrides);
    const resolved = all.get(id);
    if (!resolved) {
      throw new Error(`Unknown feature flag: ${id}`);
    }
    return resolved;
  }

  resolveAll(overrides: FeatureFlagOverrides = NO_OVERRIDES): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [id, resolution] of this.resolveAllInner(overrides)) {
      result[id] = resolution.enabled;
    }
    return result;
  }

  validate(): string[] {
    const problems: string[] = [];
    for (const def of this.definitions.values()) {
      for (const dep of def.dependencies) {
        if (!this.definitions.has(dep)) {
          problems.push(`${def.id}: unknown dependency "${dep}"`);
        }
      }
      for (const other of def.incompatibleWith ?? []) {
        if (!this.definitions.has(other)) {
          problems.push(`${def.id}: unknown incompatibleWith "${other}"`);
        }
      }
    }
    for (const id of this.findCycleMembers()) {
      problems.push(`dependency cycle involves "${id}"`);
    }
    return problems;
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private resolveAllInner(overrides: FeatureFlagOverrides): Map<string, FeatureFlagResolution> {
    const base = new Map<string, FeatureFlagResolution>();
    const visiting = new Set<string>();

    const resolveBase = (id: string): FeatureFlagResolution => {
      const cached = base.get(id);
      if (cached) return cached;
      const def = this.definitions.get(id);
      if (!def) {
        throw new Error(`Unknown feature flag: ${id}`);
      }
      if (visiting.has(id)) {
        const cycle: FeatureFlagResolution = { id, enabled: false, source: 'disabled-by-cycle' };
        base.set(id, cycle);
        return cycle;
      }
      const override = overrides[id];
      const requested = override ?? def.defaultValue;
      let source: FeatureFlagResolutionSource = override === undefined ? 'default' : 'override';
      if (!requested) {
        const off: FeatureFlagResolution = { id, enabled: false, source };
        base.set(id, off);
        return off;
      }
      visiting.add(id);
      for (const dep of def.dependencies) {
        if (!this.definitions.has(dep)) {
          visiting.delete(id);
          const disabled: FeatureFlagResolution = { id, enabled: false, source: 'disabled-by-dependency' };
          base.set(id, disabled);
          return disabled;
        }
        if (!resolveBase(dep).enabled) {
          visiting.delete(id);
          const disabled: FeatureFlagResolution = { id, enabled: false, source: 'disabled-by-dependency' };
          base.set(id, disabled);
          return disabled;
        }
      }
      visiting.delete(id);
      const on: FeatureFlagResolution = { id, enabled: true, source };
      base.set(id, on);
      return on;
    };

    for (const id of this.definitions.keys()) resolveBase(id);

    // Phase 2: incompatibilities over the base-enabled set.
    const yielded = new Set<string>();
    for (const def of this.definitions.values()) {
      if (!base.get(def.id)?.enabled) continue;
      for (const other of def.incompatibleWith ?? []) {
        const otherDef = this.definitions.get(other);
        if (!otherDef) continue;
        if (!base.get(other)?.enabled) continue;
        const mutual = otherDef.incompatibleWith?.includes(def.id) ?? false;
        if (mutual) {
          const loser = def.id < other ? other : def.id;
          yielded.add(loser);
        } else {
          yielded.add(def.id);
        }
      }
    }

    const result = new Map<string, FeatureFlagResolution>();
    for (const [id, resolution] of base) {
      if (yielded.has(id) && resolution.enabled) {
        result.set(id, { id, enabled: false, source: 'disabled-by-incompatibility' });
      } else {
        result.set(id, resolution);
      }
    }
    return result;
  }

  private findCycleMembers(): string[] {
    const members = new Set<string>();
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        members.add(id);
        return;
      }
      visiting.add(id);
      const def = this.definitions.get(id);
      for (const dep of def?.dependencies ?? []) {
        if (!this.definitions.has(dep)) continue;
        if (visiting.has(dep)) {
          members.add(id);
          members.add(dep);
        } else {
          visit(dep);
          if (members.has(dep)) members.add(id);
        }
      }
      visiting.delete(id);
      done.add(id);
    };
    for (const id of this.definitions.keys()) visit(id);
    return [...members];
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createFeatureFlagRegistry(
  definitions: readonly FeatureFlagDefinition[] = [],
): FeatureFlagRegistry {
  const registry = new FeatureFlagRegistryImpl();
  for (const definition of definitions) registry.register(definition);
  return registry;
}
