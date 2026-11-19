/**
 * Capability map read by the Rox Cloud router before it accepts a spec.
 *
 * Values below are taken from the verified vendor documentation
 * (2026-11-19). Anything not verified is left out rather than guessed;
 * the router must not promise a feature an adapter cannot deliver.
 *
 * Reading notes:
 * - `maxTtlSec: 0` means "no documented cap" (E2B), not "zero seconds".
 * - `pause` means memory survives; Modal keeps only the filesystem, so its
 *   pause is `false` even though a snapshot restores files.
 * - E2B regions are documented as the default pair, not as the full list.
 */

import type { ProviderCapabilities, ProviderId } from './types.ts';

const DAY_SEC = 24 * 60 * 60;

export const PROVIDER_IDS = ['daytona', 'modal', 'e2b'] as const;

export const PROVIDER_CAPABILITIES: Readonly<Record<ProviderId, ProviderCapabilities>> = {
  daytona: {
    id: 'daytona',
    os: ['linux', 'windows', 'macos'],
    gpu: true,
    pause: true,
    snapshot: true,
    volume: true,
    streaming: 'websocket',
    maxTtlSec: 30 * DAY_SEC,
    regions: ['in', 'eu-central', 'eu-west', 'us-east', 'us-west'],
  },
  modal: {
    id: 'modal',
    os: ['linux'],
    gpu: true,
    // Modal persists only the filesystem between runs, not process memory.
    pause: false,
    // The Rox bridge has no snapshot route; filesystem snapshots are a vendor
    // feature the bridge does not expose yet.
    snapshot: false,
    volume: true,
    streaming: 'none',
    maxTtlSec: DAY_SEC,
    regions: ['us', 'eu', 'ap'],
  },
  e2b: {
    id: 'e2b',
    os: ['linux'],
    gpu: false,
    // The adapter stops by pausing and has no resume method, so pause is not
    // offered as a capability a caller can ask for.
    pause: false,
    // `spec.snapshot` is the E2B template name; runtime snapshots are not
    // exposed by the adapter.
    snapshot: true,
    // Volumes exist in beta at E2B, but the adapter has no volume methods.
    volume: false,
    streaming: 'sse',
    // No documented hard cap.
    maxTtlSec: 0,
    regions: ['us', 'eu'],
  },
};

/** Capabilities of one vendor; throws for an id the router does not know. */
export function getProviderCapabilities(id: ProviderId): ProviderCapabilities {
  const found = PROVIDER_CAPABILITIES[id];
  if (!found) throw new Error(`unknown provider: ${id}`);
  return found;
}

/**
 * Whether a requested TTL fits the vendor's documented cap.
 * A cap of 0 means unbounded, so any TTL fits.
 */
export function acceptTtl(capabilities: ProviderCapabilities, ttlSec?: number): boolean {
  if (ttlSec === undefined) return true;
  if (capabilities.maxTtlSec === 0) return true;
  return ttlSec <= capabilities.maxTtlSec;
}
