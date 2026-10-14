import type { LlmConnection } from '../../config/llm-connections.ts';
import { isLocalConnection } from '../../config/llm-connections.ts';
import { ROX_DEFAULT_CONNECTION_SLUG, ROX_GATEWAY_BASE_URL, isRoxPublicModelId } from '../../config/rox-public-models.ts';

function isRoxGatewayUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return true;
  return baseUrl.replace(/\/$/, '') === ROX_GATEWAY_BASE_URL;
}

/** Local Ollama / OpenAI-compat / custom-gateway connections the user actually selected. */
export function isBringYourOwnSessionConnection(connection: LlmConnection): boolean {
  if (isLocalConnection(connection)) return true;
  if (connection.providerType === 'pi_compat' || connection.providerType === 'anthropic_compat') return true;
  if (connection.providerType === 'omp' && !isRoxGatewayUrl(connection.baseUrl)) return true;
  return false;
}

export function selectOmpSessionConnection(input: {
  connections: LlmConnection[];
  sessionSlug?: string;
  workspaceSlug?: string;
  defaultSlug?: string | null;
}): LlmConnection {
  for (const slug of [input.sessionSlug, input.workspaceSlug, input.defaultSlug, ROX_DEFAULT_CONNECTION_SLUG]) {
    const selected = input.connections.find(c => c.slug === slug);
    if (!selected) continue;
    if (isBringYourOwnSessionConnection(selected) || selected.providerType === 'omp') return selected;
  }
  const available = input.connections.find(c => c.providerType === 'omp')
    ?? input.connections.find(isBringYourOwnSessionConnection);
  if (available) return available;
  throw new Error('ROX sessions require a configured OMP or local model connection. Configure a runtime before starting an agent.');
}

/** Preserve requested models on an OMP or bring-your-own connection; migrate incompatible legacy models explicitly. */
export function selectOmpSessionModel(connection: LlmConnection, requested: string | undefined, wasOmp: boolean): string {
  if (requested && (wasOmp || isRoxPublicModelId(requested) || isBringYourOwnSessionConnection(connection))) {
    return requested;
  }
  return connection.defaultModel || (isBringYourOwnSessionConnection(connection) ? requested : undefined) || 'rox/standard';
}
