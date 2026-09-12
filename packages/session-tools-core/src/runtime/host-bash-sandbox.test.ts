import { afterEach, describe, expect, it } from 'bun:test';
import { isHostBashSandboxEnabled, planHostBashSandbox } from './host-bash-sandbox.ts';

const ORIGINAL = process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
  else process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX = ORIGINAL;
});

describe('isHostBashSandboxEnabled', () => {
  it('defaults to off', () => {
    delete process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
    expect(isHostBashSandboxEnabled()).toBe(false);
  });

  it('honors explicit enable', () => {
    process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX = '1';
    expect(isHostBashSandboxEnabled()).toBe(true);
  });

  it('honors explicit disable', () => {
    process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX = '0';
    expect(isHostBashSandboxEnabled()).toBe(false);
  });
});

describe('planHostBashSandbox', () => {
  it('returns a plan with command wrapping or unavailable backends', () => {
    const plan = planHostBashSandbox('/bin/bash', ['-lc', 'echo ok'], '/tmp/host-bash-jail');
    expect(plan.status === 'enforced' || plan.status === 'unavailable').toBe(true);
    expect(plan.command.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.args)).toBe(true);
    if (plan.status === 'enforced') {
      expect(plan.filesystem.status).toBe('enforced');
      expect(plan.network.status).toBe('enforced');
    } else {
      expect(plan.filesystem.status === 'unavailable' || plan.network.status === 'unavailable').toBe(true);
    }
  });
});
