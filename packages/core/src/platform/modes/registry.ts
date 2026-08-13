import type { Disposable } from '../types.ts';
import { evaluateWhen } from '../context-keys/evaluate-when.ts';
import type { ContextKeys } from '../context-keys/types.ts';
import type { ModeContribution, ModeRegistry } from './types.ts';

function compareModes(a: ModeContribution, b: ModeContribution): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

class ModeRegistryImpl implements ModeRegistry {
  private readonly contributions = new Map<string, ModeContribution>();
  private readonly listeners = new Set<() => void>();

  register(contribution: ModeContribution): Disposable {
    if (this.contributions.has(contribution.id)) {
      throw new Error(`Mode contribution id already registered: ${contribution.id}`);
    }
    this.contributions.set(contribution.id, contribution);
    this.notify();
    return {
      dispose: () => {
        this.unregister(contribution.id);
      },
    };
  }

  unregister(id: string): void {
    if (this.contributions.delete(id)) this.notify();
  }

  get(id: string): ModeContribution | undefined {
    return this.contributions.get(id);
  }

  list(ctx: ContextKeys = {}): ModeContribution[] {
    const matching: ModeContribution[] = [];
    for (const contribution of this.contributions.values()) {
      if (!evaluateWhen(contribution.when, ctx)) continue;
      matching.push(contribution);
    }
    return matching.sort(compareModes);
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createModeRegistry(): ModeRegistry {
  return new ModeRegistryImpl();
}

export function isModeNavigable(mode: ModeContribution, capabilities: ReadonlySet<string> = new Set()): boolean {
  if (mode.rootRoute === null) return false;
  const required = mode.requiredCapabilities ?? [];
  return required.every((cap) => capabilities.has(cap));
}

export function listPinnedModes(
  modes: readonly ModeContribution[],
  capabilities: ReadonlySet<string> = new Set(),
): { pinned: ModeContribution[]; overflow: ModeContribution[] } {
  const pinned: ModeContribution[] = [];
  const overflow: ModeContribution[] = [];
  for (const mode of modes) {
    if (mode.defaultPinned) pinned.push(mode);
    else overflow.push(mode);
  }
  void capabilities;
  return { pinned, overflow };
}
