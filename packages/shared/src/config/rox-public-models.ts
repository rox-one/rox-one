/**
 * Canonical public ROX model plane.
 *
 * Clients (Craft, OMP, API consumers) advertise and request only these IDs.
 * Provider selection and bounded fallback live in the API gateway — not here
 * and not in OMP's local fallback engine.
 */

import type { ModelDefinition } from './models.ts';

export const ROX_PUBLIC_MODEL_IDS = [
  'rox/explore',
  'rox/standard',
  'rox/max',
  'rox/vision',
  'rox/fast',
] as const;

export type RoxPublicModelId = (typeof ROX_PUBLIC_MODEL_IDS)[number];

export const ROX_DEFAULT_PARENT_MODEL: RoxPublicModelId = 'rox/standard';
export const ROX_DEFAULT_SUBAGENT_MODEL: RoxPublicModelId = 'rox/fast';
export const ROX_DEFAULT_CONNECTION_NAME = 'Rox CLI';
export const ROX_GATEWAY_BASE_URL = 'https://api.rox.one/v1';
export const ROX_LEGACY_INTERNAL_MODEL_IDS = ['kimi-K3', 'kimi-k3'] as const;

/**
 * Subagents default to the cheap public endpoint. Gateway fallback of the
 * *same* request (especially `rox/max` context) is not duplicated here.
 * Explicit `model` on spawn_session always wins.
 */
const SUBAGENT_TIER: Record<RoxPublicModelId, RoxPublicModelId> = {
  'rox/explore': 'rox/fast',
  'rox/standard': 'rox/fast',
  'rox/max': 'rox/fast',
  'rox/vision': 'rox/fast',
  'rox/fast': 'rox/fast',
};

export const ROX_PUBLIC_MODEL_DESCRIPTION_KEYS = {
  'rox/explore': 'model.roxExploreDesc',
  'rox/fast': 'model.roxFastDesc',
  'rox/max': 'model.roxMaxDesc',
  'rox/standard': 'model.roxStandardDesc',
  'rox/vision': 'model.roxVisionDesc',
} as const satisfies Record<RoxPublicModelId, string>;

export function isRoxPublicModelId(id: string): id is RoxPublicModelId {
  return (ROX_PUBLIC_MODEL_IDS as readonly string[]).includes(id);
}

export function isRoxLegacyInternalModelId(id: string): boolean {
  return (ROX_LEGACY_INTERNAL_MODEL_IDS as readonly string[]).includes(id);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ROX public model: ${String(value)}`);
}

export function getRoxSubagentModel(parent: RoxPublicModelId): RoxPublicModelId {
  const next = SUBAGENT_TIER[parent];
  if (next) return next;
  return assertNever(parent as never);
}

export interface ResolveSpawnSessionModelInput {
  requested?: string | null;
  parentModel?: string | null;
  connectionSlug?: string | null;
  roxConnectionSlug?: string | null;
}

/**
 * Model for a spawned child session.
 *
 * - Explicit `requested` is always honored.
 * - Parent on a public ROX endpoint → lower-tier public endpoint.
 * - ROX connection with a raw/internal parent id → `rox/fast`.
 * - Any other connection → inherit parent (historical spawn_session behavior).
 */
export function resolveSpawnSessionModel(input: ResolveSpawnSessionModelInput): string | undefined {
  const requested = input.requested?.trim();
  if (requested) return requested;

  const parent = input.parentModel?.trim();
  if (parent && isRoxPublicModelId(parent)) {
    return getRoxSubagentModel(parent);
  }

  const roxSlug = input.roxConnectionSlug?.trim();
  const connectionSlug = input.connectionSlug?.trim();
  if (roxSlug && connectionSlug && connectionSlug === roxSlug) {
    return ROX_DEFAULT_SUBAGENT_MODEL;
  }

  return parent || undefined;
}

export const ROX_PUBLIC_MODEL_CATALOG: ReadonlyArray<{
  id: RoxPublicModelId;
  name: string;
  shortName: string;
  description: string;
  contextWindow: number;
  supportsThinking: boolean;
  supportsImages: boolean;
}> = [
  {
    id: 'rox/explore',
    name: 'ROX Explore',
    shortName: 'Explore',
    description: 'Cheap exploration endpoint',
    contextWindow: 262_144,
    supportsThinking: true,
    supportsImages: false,
  },
  {
    id: 'rox/standard',
    name: 'ROX Standard',
    shortName: 'Standard',
    description: 'Default coding endpoint',
    contextWindow: 262_144,
    supportsThinking: true,
    supportsImages: false,
  },
  {
    id: 'rox/max',
    name: 'ROX Max',
    shortName: 'Max',
    description: '1M-context endpoint; no silent context downgrade',
    contextWindow: 1_048_576,
    supportsThinking: true,
    supportsImages: false,
  },
  {
    id: 'rox/vision',
    name: 'ROX Vision',
    shortName: 'Vision',
    description: 'Multimodal endpoint',
    contextWindow: 1_048_576,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'rox/fast',
    name: 'ROX Fast',
    shortName: 'Fast',
    description: 'Lower-tier endpoint for subagents and cheap turns',
    contextWindow: 1_048_576,
    supportsThinking: true,
    supportsImages: false,
  },
];

export function toRoxPublicModelDefinitions(): ModelDefinition[] {
  return ROX_PUBLIC_MODEL_CATALOG.map((entry) => ({
    id: entry.id,
    name: entry.name,
    shortName: entry.shortName,
    description: entry.description,
    descriptionKey: ROX_PUBLIC_MODEL_DESCRIPTION_KEYS[entry.id],
    provider: 'pi',
    contextWindow: entry.contextWindow,
    supportsThinking: entry.supportsThinking,
    supportsImages: entry.supportsImages,
  }));
}

export function splitRoxPublicModel(id: RoxPublicModelId): { provider: 'rox'; modelId: string } {
  const slash = id.indexOf('/');
  return { provider: 'rox', modelId: id.slice(slash + 1) };
}

export interface OmpModelCandidate {
  id?: string;
  modelId?: string;
  provider?: string;
  name?: string;
}

function normalizeOmpModelId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Map a Craft model id onto OMP `set_model {provider, modelId}`.
 *
 * Public `rox/*` ids are sent as `{provider:'rox', modelId:'standard'}` even
 * when the live OMP catalog still lists a legacy internal id — the gateway
 * owns routing. Non-public ids still require a catalog match.
 */
export function resolveOmpSetModelTarget(
  wanted: string,
  available: OmpModelCandidate[],
): { provider: string; modelId: string } | null {
  const wantedNorm = normalizeOmpModelId(wanted);

  const candidate = available.find((m) => {
    const id = String(m.modelId ?? m.id ?? '');
    return normalizeOmpModelId(id) === wantedNorm
      || normalizeOmpModelId(`${m.provider ?? ''}/${id}`) === wantedNorm;
  }) ?? available.find((m) => {
    const id = normalizeOmpModelId(String(m.modelId ?? m.id ?? ''));
    return id.length > 0 && (id.endsWith(wantedNorm) || wantedNorm.endsWith(id));
  });

  if (candidate) {
    return {
      provider: String(candidate.provider ?? ''),
      modelId: String(candidate.modelId ?? candidate.id ?? ''),
    };
  }

  if (isRoxPublicModelId(wanted)) {
    return splitRoxPublicModel(wanted);
  }

  return null;
}
