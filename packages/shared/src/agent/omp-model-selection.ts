import {
  isRoxPublicModelId,
  resolveOmpSetModelTarget,
  splitRoxPublicModel,
  type OmpModelCandidate,
} from '../config/rox-public-models.ts';

export interface OmpModelTarget {
  provider: string;
  modelId: string;
}

/** Resolve only to a model that the live RPC catalog actually exposes. */
export function resolveVerifiedOmpModelTarget(
  requested: string,
  available: OmpModelCandidate[],
): OmpModelTarget | null {
  const wanted = requested.trim();
  if (!wanted) return null;

  if (isRoxPublicModelId(wanted)) {
    const publicTarget = splitRoxPublicModel(wanted);
    const candidate = available.find((model) => model.provider === publicTarget.provider
      && [publicTarget.modelId, wanted].includes(String(model.modelId ?? model.id ?? '')));
    return candidate
      ? { provider: publicTarget.provider, modelId: String(candidate.modelId ?? candidate.id) }
      : null;
  }

  // An explicit provider/model is an exact catalog identity. Legacy suffix
  // matching must not turn an unknown qualified ID into another model.
  const slash = wanted.indexOf('/');
  if (slash > 0) {
    const provider = wanted.slice(0, slash);
    const modelId = wanted.slice(slash + 1);
    const candidate = available.find((model) => model.provider === provider
      && [modelId, wanted].includes(String(model.modelId ?? model.id ?? '')));
    return candidate && modelId
      ? { provider, modelId: String(candidate.modelId ?? candidate.id) }
      : null;
  }

  // Only unqualified legacy names retain the existing fuzzy matching.
  const target = resolveOmpSetModelTarget(wanted, available);
  return target && target.provider && target.modelId && available.some((model) =>
    model.provider === target.provider && (model.modelId ?? model.id) === target.modelId)
    ? target
    : null;
}

/** RPC get_state in managed OMP returns a model object; older versions use a string. */
export function ompStateHasModel(state: unknown, target: OmpModelTarget): boolean {
  if (!state || typeof state !== 'object') return false;
  const model = (state as { model?: unknown }).model;
  if (typeof model === 'string') return model === `${target.provider}/${target.modelId}`;
  if (!model || typeof model !== 'object') return false;
  const actual = model as OmpModelCandidate;
  return actual.provider === target.provider && (actual.modelId ?? actual.id) === target.modelId;
}
