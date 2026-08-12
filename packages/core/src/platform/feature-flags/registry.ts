/**
 * FeatureFlagRegistry implementation (ADR-0001 decision 16).
 *
 * Resolution semantics:
 * - base value = override ?? defaultValue;
 * - a flag is enabled only when its base value is true AND every dependency
 *   resolves enabled (recursively) AND no flag listed in `incompatibleWith`
 *   resolves enabled;
 * - the flag that DECLARES the incompatibility yields to the other one;
 * - dependency cycles disable every flag in the cycle (reported by
 *   `validate()`), never crash resolution.
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
    return this.resolveInner(id, overrides, new Set());
  }

  resolveAll(overrides: FeatureFlagOverrides = NO_OVERRIDES): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const id of this.definitions.keys()) {
      result[id] = this.resolve(id, overrides).enabled;
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

  private resolveInner(
    id: string,
    overrides: FeatureFlagOverrides,
    visiting: Set<string>,
  ): FeatureFlagResolution {
    const def = this.definitions.get(id);
    if (!def) {
      throw new Error(`Unknown feature flag: ${id}`);
    }
    if (visiting.has(id)) {
      return { id, enabled: false, source: 'disabled-by-cycle' };
    }
    const override = overrides[id];
    const base = override ?? def.defaultValue;
    let source: FeatureFlagResolutionSource = override === undefined ? 'default' : 'override';
    if (!base) return { id, enabled: false, source };

    visiting.add(id);
    for (const dep of def.dependencies) {
      if (!this.definitions.has(dep)) continue; // reported by validate()
      if (!this.resolveInner(dep, overrides, visiting).enabled) {
        visiting.delete(id);
        return { id, enabled: false, source: 'disabled-by-dependency' };
      }
    }
    for (const other of def.incompatibleWith ?? []) {
      if (!this.definitions.has(other)) continue;
      if (this.resolveInner(other, overrides, visiting).enabled) {
        visiting.delete(id);
        return { id, enabled: false, source: 'disabled-by-incompatibility' };
      }
    }
    visiting.delete(id);
    return { id, enabled: true, source };
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
