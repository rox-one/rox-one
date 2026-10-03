import type { LlmConnection } from '../../config/llm-connections.ts';
import { ROX_DEFAULT_CONNECTION_SLUG, isRoxPublicModelId } from '../../config/rox-public-models.ts';

export function selectOmpSessionConnection(input: {
  connections: LlmConnection[];
  sessionSlug?: string;
  workspaceSlug?: string;
  defaultSlug?: string | null;
}): LlmConnection {
  for (const slug of [input.sessionSlug, input.workspaceSlug, input.defaultSlug, ROX_DEFAULT_CONNECTION_SLUG]) {
    const selected = input.connections.find(c => c.slug === slug && c.providerType === 'omp');
    if (selected) return selected;
  }
  const available = input.connections.find(c => c.providerType === 'omp');
  if (available) return available;
  throw new Error('ROX sessions require a configured OMP connection. Configure ROX runtime before starting an agent.');
}

/** Preserve requested models on an OMP connection; migrate incompatible legacy models explicitly. */
export function selectOmpSessionModel(connection: LlmConnection, requested: string | undefined, wasOmp: boolean): string {
  if (requested && (wasOmp || isRoxPublicModelId(requested))) return requested;
  return connection.defaultModel || 'rox/standard';
}
