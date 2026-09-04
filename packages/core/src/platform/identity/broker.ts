type HeadersInit = Record<string, string> | [string, string][] | Headers;
import type { CredentialRef, CredentialRefId } from './credential-types.ts';
import { ConnectionFabricError, type DeliveryMechanism, type SecretProvider } from './provider-contract.ts';
import type { AccessGrant, JsonAccessGrantStore } from './grants.ts';

const MAX_TTL_MS = 15 * 60 * 1000;
const DELIVERY_PREFERENCE: readonly DeliveryMechanism[] = [
  'trusted-http-header',
  'proxy',
  'mcp-tool-host',
  'git-credential-helper',
  'docker-credential-helper',
  'aws-credential-process',
  'ssh-agent',
  'stdin',
  'fd',
  'temporary-file',
  'browser-partition',
  'env-legacy',
];

export type ConsumerKind = 'agent' | 'workflow' | 'tool' | 'mcp' | 'plugin' | 'remote-client' | 'human';

export interface ConsumerIdentity {
  readonly kind: ConsumerKind;
  readonly id: string;
  readonly workspaceId: string;
}

export interface AcquireLeaseInput {
  readonly credentialRef: CredentialRefId;
  readonly consumer: ConsumerIdentity;
  readonly purpose: string;
  readonly action: string;
  readonly resources: readonly string[];
  readonly audience?: string;
  readonly ttl: number;
  readonly requestedMechanism?: DeliveryMechanism;
  readonly allowEnvLegacy?: boolean;
}

export interface DeliveryDescriptor {
  readonly mechanism: DeliveryMechanism;
  readonly audience?: string;
}

export interface CredentialLease {
  readonly id: string;
  readonly credentialRefId: CredentialRefId;
  readonly consumer: ConsumerIdentity;
  readonly purpose: string;
  readonly action: string;
  readonly resources: readonly string[];
  readonly audience?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly delivery: DeliveryDescriptor;
  readonly status: 'active' | 'revoked' | 'expired' | 'used' | 'denied';
}

export interface InProcessCredentialBrokerOptions {
  readonly grants: JsonAccessGrantStore;
  readonly providers: Readonly<Record<string, SecretProvider>>;
  readonly resolveRef: (id: CredentialRefId) => Promise<CredentialRef | undefined>;
  readonly now?: () => number;
}

export type TrustedHttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ExecuteTrustedHttpInput {
  readonly leaseId: string;
  readonly url: string;
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly fetch: TrustedHttpFetch;
}

export class InProcessCredentialBroker {
  private readonly grants: JsonAccessGrantStore;
  private readonly providers: Readonly<Record<string, SecretProvider>>;
  private readonly resolveRef: (id: CredentialRefId) => Promise<CredentialRef | undefined>;
  private readonly now: () => number;
  private readonly leases = new Map<string, CredentialLease>();
  private sequence = 0;

  constructor(options: InProcessCredentialBrokerOptions) {
    this.grants = options.grants;
    this.providers = options.providers;
    this.resolveRef = options.resolveRef;
    this.now = options.now ?? Date.now;
  }

  async acquireLease(input: AcquireLeaseInput): Promise<CredentialLease> {
    if (!Number.isFinite(input.ttl) || input.ttl <= 0 || input.ttl > MAX_TTL_MS) {
      throw new ConnectionFabricError('LEASE_DENIED', 'ttl');
    }
    const ref = await this.resolveRef(input.credentialRef);
    if (!ref) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', input.credentialRef);

    const grant = this.matchGrant(input, ref.id);
    if (!grant) throw new ConnectionFabricError('GRANT_MISSING');
    this.assertGrantCovers(grant, input);

    const provider = this.providers[ref.providerId];
    if (!provider) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', ref.providerId);

    const mechanism = this.selectDelivery(provider.definition.deliveryMechanisms, input);
    await provider.resolveForLease({ credentialRef: ref, purpose: input.purpose });

    const issuedAt = this.now();
    const lease: CredentialLease = {
      id: `lease_${++this.sequence}`,
      credentialRefId: ref.id,
      consumer: { ...input.consumer },
      purpose: input.purpose,
      action: input.action,
      resources: [...input.resources],
      issuedAt,
      expiresAt: issuedAt + input.ttl,
      delivery: {
        mechanism,
        ...(input.audience ? { audience: input.audience } : {}),
      },
      status: 'active',
      ...(input.audience ? { audience: input.audience } : {}),
    };
    this.leases.set(lease.id, lease);
    return {
      ...lease,
      consumer: { ...lease.consumer },
      resources: [...lease.resources],
      delivery: { ...lease.delivery },
    };
  }

  async revokeLease(leaseId: string, _reason: string): Promise<void> {
    const current = this.leases.get(leaseId);
    if (!current) throw new ConnectionFabricError('LEASE_REVOKED', leaseId);
    this.leases.set(leaseId, { ...current, status: 'revoked' });
  }

  async revokeLeasesForRef(credentialRefId: CredentialRefId, _reason: string): Promise<readonly string[]> {
    const revoked: string[] = [];
    for (const [id, lease] of this.leases) {
      if (lease.credentialRefId !== credentialRefId || lease.status !== 'active') continue;
      this.leases.set(id, { ...lease, status: 'revoked' });
      revoked.push(id);
    }
    return revoked;
  }

  async revalidateConsumer(
    consumer: ConsumerIdentity,
  ): Promise<{ status: 'ok' | 'denied' | 'repair_required' }> {
    const granted = this.grants.listForConsumer(consumer).filter((grant) => grant.status === 'active');
    for (const grant of granted) {
      const ref = await this.resolveRef(grant.credentialRefId);
      if (!ref) return { status: 'repair_required' };
      const provider = this.providers[ref.providerId];
      if (!provider) return { status: 'repair_required' };
      try {
        await provider.inspect(ref);
      } catch {
        return { status: 'repair_required' };
      }
    }
    const active = [...this.leases.values()].some(
      (lease) =>
        lease.consumer.id === consumer.id &&
        lease.consumer.workspaceId === consumer.workspaceId &&
        lease.status === 'active' &&
        lease.expiresAt > this.now(),
    );
    return { status: active ? 'ok' : 'denied' };
  }

  async executeTrustedHttp(input: ExecuteTrustedHttpInput): Promise<Response> {
    const lease = this.leases.get(input.leaseId);
    if (!lease || lease.status !== 'active' || lease.expiresAt <= this.now()) {
      throw new ConnectionFabricError('LEASE_REVOKED', input.leaseId);
    }
    if (lease.delivery.mechanism !== 'trusted-http-header') {
      throw new ConnectionFabricError('DELIVERY_UNSUPPORTED', lease.delivery.mechanism);
    }

    const ref = await this.resolveRef(lease.credentialRefId);
    if (!ref) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', lease.credentialRefId);
    const provider = this.providers[ref.providerId];
    if (!provider?.deliverTrustedHeader) {
      throw new ConnectionFabricError('DELIVERY_UNSUPPORTED', ref.providerId);
    }

    const delivery = await provider.deliverTrustedHeader({
      credentialRef: ref,
      purpose: lease.purpose,
    });
    const headers = new Headers(input.headers);
    headers.set(delivery.header, delivery.value);

    let response: Response;
    try {
      response = await input.fetch(input.url, {
        method: input.method ?? 'GET',
        headers,
      });
    } finally {
      this.leases.set(lease.id, { ...lease, status: 'used' });
    }
    return response;
  }

  async getLease(leaseId: string): Promise<CredentialLease | undefined> {
    const lease = this.leases.get(leaseId);
    return lease
      ? {
          ...lease,
          consumer: { ...lease.consumer },
          resources: [...lease.resources],
          delivery: { ...lease.delivery },
        }
      : undefined;
  }

  private matchGrant(input: AcquireLeaseInput, credentialRefId: CredentialRefId): AccessGrant | undefined {
    return this.grants.listActive({
      consumerId: input.consumer.id,
      credentialRefId,
    })[0];
  }

  private assertGrantCovers(grant: AccessGrant, input: AcquireLeaseInput): void {
    if (grant.workspaceId !== input.consumer.workspaceId) {
      throw new ConnectionFabricError('LEASE_DENIED', 'workspace');
    }
    if (!grant.actions.includes(input.action)) {
      throw new ConnectionFabricError('LEASE_DENIED', 'action');
    }
    const allowed = new Set(grant.resources);
    if (!input.resources.every((resource) => allowed.has(resource))) {
      throw new ConnectionFabricError('LEASE_DENIED', 'resource');
    }
  }

  private selectDelivery(
    supported: readonly DeliveryMechanism[],
    input: AcquireLeaseInput,
  ): DeliveryMechanism {
    const requested = input.requestedMechanism;
    const allowed = DELIVERY_PREFERENCE.filter((mechanism) => {
      if (!supported.includes(mechanism)) return false;
      if (mechanism === 'env-legacy' && !input.allowEnvLegacy) return false;
      return true;
    });
    if (requested) {
      if (!allowed.includes(requested)) {
        throw new ConnectionFabricError('DELIVERY_UNSUPPORTED', requested);
      }
      return requested;
    }
    const selected = allowed[0];
    if (!selected) throw new ConnectionFabricError('DELIVERY_UNSUPPORTED');
    return selected;
  }
}
