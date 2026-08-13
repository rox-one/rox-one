import { describe, expect, it } from 'bun:test';
import {
  getRoxSubagentModel,
  isRoxLegacyInternalModelId,
  isRoxPublicModelId,
  resolveOmpSetModelTarget,
  resolveSpawnSessionModel,
  ROX_DEFAULT_PARENT_MODEL,
  ROX_DEFAULT_SUBAGENT_MODEL,
  ROX_PUBLIC_MODEL_CATALOG,
  ROX_PUBLIC_MODEL_DESCRIPTION_KEYS,
  ROX_PUBLIC_MODEL_IDS,
  splitRoxPublicModel,
  toRoxPublicModelDefinitions,
  type RoxPublicModelId,
} from './rox-public-models.ts';

describe('ROX public model plane', () => {
  it('exposes exactly the five canonical public IDs', () => {
    expect([...ROX_PUBLIC_MODEL_IDS]).toEqual([
      'rox/explore',
      'rox/standard',
      'rox/max',
      'rox/vision',
      'rox/fast',
    ]);
    expect(ROX_PUBLIC_MODEL_CATALOG.map((entry) => entry.id)).toEqual([...ROX_PUBLIC_MODEL_IDS]);
  });

  it('sends every public parent to the cheap public subagent endpoint', () => {
    for (const id of ROX_PUBLIC_MODEL_IDS) {
      expect(getRoxSubagentModel(id)).toBe('rox/fast');
    }
  });

  it('maps every public parent to a public child', () => {
    for (const id of ROX_PUBLIC_MODEL_IDS) {
      const child: RoxPublicModelId = getRoxSubagentModel(id);
      expect(isRoxPublicModelId(child)).toBe(true);
    }
  });

  it('exposes picker metadata with i18n keys for every public id', () => {
    const defs = toRoxPublicModelDefinitions();
    expect(defs.map((entry) => entry.id)).toEqual([...ROX_PUBLIC_MODEL_IDS]);
    for (const def of defs) {
      expect(def.provider).toBe('pi');
      expect(def.descriptionKey).toBe(ROX_PUBLIC_MODEL_DESCRIPTION_KEYS[def.id as RoxPublicModelId]);
    }
  });
});

describe('resolveSpawnSessionModel', () => {
  it('honors an explicit requested model', () => {
    expect(
      resolveSpawnSessionModel({
        requested: 'rox/max',
        parentModel: 'rox/standard',
        connectionSlug: 'rox-kimi',
        roxConnectionSlug: 'rox-kimi',
      })
    ).toBe('rox/max');
  });

  it('drops a ROX parent one tier for omitted spawn model', () => {
    expect(
      resolveSpawnSessionModel({
        parentModel: 'rox/standard',
        connectionSlug: 'rox-kimi',
        roxConnectionSlug: 'rox-kimi',
      })
    ).toBe('rox/fast');
    expect(
      resolveSpawnSessionModel({
        parentModel: ROX_DEFAULT_PARENT_MODEL,
        connectionSlug: 'rox-kimi',
        roxConnectionSlug: 'rox-kimi',
      })
    ).toBe(ROX_DEFAULT_SUBAGENT_MODEL);
  });

  it('uses rox/fast when the ROX connection parent is a raw internal id', () => {
    expect(
      resolveSpawnSessionModel({
        parentModel: 'kimi-K3',
        connectionSlug: 'rox-kimi',
        roxConnectionSlug: 'rox-kimi',
      })
    ).toBe('rox/fast');
    expect(isRoxLegacyInternalModelId('kimi-K3')).toBe(true);
  });

  it('inherits the parent model on non-ROX connections', () => {
    expect(
      resolveSpawnSessionModel({
        parentModel: 'claude-opus-4-8',
        connectionSlug: 'anthropic-api',
        roxConnectionSlug: 'rox-kimi',
      })
    ).toBe('claude-opus-4-8');
  });
});

describe('resolveOmpSetModelTarget', () => {
  it('matches provider/id for a public ROX catalog entry', () => {
    expect(
      resolveOmpSetModelTarget('rox/standard', [
        { provider: 'rox', id: 'standard' },
      ])
    ).toEqual({ provider: 'rox', modelId: 'standard' });
  });

  it('still matches a legacy internal OMP id', () => {
    expect(
      resolveOmpSetModelTarget('kimi-K3', [
        { provider: 'rox', id: 'kimi-k3' },
      ])
    ).toEqual({ provider: 'rox', modelId: 'kimi-k3' });
  });

  it('sends the public split when OMP only lists a legacy id', () => {
    expect(
      resolveOmpSetModelTarget('rox/max', [
        { provider: 'rox', id: 'kimi-k3' },
      ])
    ).toEqual(splitRoxPublicModel('rox/max'));
  });

  it('returns null for unknown non-public ids', () => {
    expect(
      resolveOmpSetModelTarget('claude-opus-4-8', [
        { provider: 'rox', id: 'kimi-k3' },
      ])
    ).toBeNull();
  });
});
