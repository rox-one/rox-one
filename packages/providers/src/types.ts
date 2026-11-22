/**
 * Provider-level configuration types for Rox Cloud sandbox providers.
 *
 * The contract itself (`SandboxProvider`, `SandboxSpec`, `SandboxStatus`)
 * lives in `packages/cloud-runner/src/sandbox.ts` and is vendor-neutral.
 * This file adds only what a *vendor adapter* needs: an identity, a base
 * URL, a tenant-supplied key and injectable clock/HTTP for tests.
 *
 * BYOK rule: a key arrives per call from the key vault. Nothing here is
 * ever read from the environment and nothing here is ever logged.
 */

import type { SandboxOs, SandboxProvider } from '../../cloud-runner/src/sandbox.ts';

/** Vendors Rox Cloud can route a sandbox to. */
export type ProviderId = 'daytona' | 'modal' | 'e2b';

/** How a vendor streams command output. */
export type ProviderStreaming = 'sse' | 'websocket' | 'none';

/**
 * What a vendor can actually do, as read by the router before a spec is
 * accepted. A spec that asks for something `false` here is rejected with
 * `capability_unavailable` instead of failing halfway through provisioning.
 */
export interface ProviderCapabilities {
  id: ProviderId;
  /** Guest systems a sandbox can boot. */
  os: SandboxOs[];
  gpu: boolean;
  /** Can a running sandbox be paused and resumed with memory intact? */
  pause: boolean;
  /** Can a filesystem snapshot be taken and restored from? */
  snapshot: boolean;
  /** Can a volume outlive the sandbox? */
  volume: boolean;
  streaming: ProviderStreaming;
  /** Hard cap on `SandboxSpec.ttlSec`; 0 means unbounded. */
  maxTtlSec: number;
  /** Region slugs the vendor offers. */
  regions: string[];
}

/** Everything an adapter needs to talk to one tenant's account. */
export interface ProviderConfig {
  id: ProviderId;
  /** Vendor platform base URL, without a trailing slash. */
  apiUrl: string;
  /** Tenant-owned bearer key. Never logged, never put in a URL. */
  apiKey: string;
  /** Per-sandbox toolbox/proxy base URL, when the vendor uses one. */
  toolboxUrl?: string;
  /** Injected HTTP transport; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
}

/** Builds a `SandboxProvider` from one tenant's configuration. */
export type ProviderFactory = (config: ProviderConfig) => SandboxProvider;
