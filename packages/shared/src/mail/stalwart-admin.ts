/**
 * Stalwart v0.16 management API (JMAP objects under `urn:stalwart:jmap`,
 * POST /jmap/) — only what Rox provisioning needs. REST management was
 * removed in v0.16; Account objects are `x:Account/*`, app passwords are
 * `x:AppPassword/set` on the account itself (server-generated secret,
 * returned once).
 *
 * Idempotency without the Enterprise-only `externalId`: the account name is
 * deterministic, and `description = "rox:<uuid>"` marks the owner. An
 * existing account with another description is never adopted.
 */
import { JMAP_CORE, JmapClient, JmapError, describeSetError, type FetchLike } from './jmap-client'
import { randomBytes } from 'node:crypto'

export const STALWART_JMAP = 'urn:stalwart:jmap'

export interface AdminCredentials { username: string; secret: string }

export interface StalwartAccount { id: string; name: string; domainId: string; description: string | null }

export function ownerMarker(userUuid: string): string {
  return `rox:${userUuid}`
}

export function generateMailboxPassword(): string {
  // 32 random bytes → base64url, plus fixed classes so any password policy passes.
  return `Rx-${randomBytes(32).toString('base64url')}-9a`
}

export class StalwartAdmin {
  private readonly client: JmapClient
  constructor(readonly baseUrl: string, creds: AdminCredentials, opts: { fetch?: FetchLike } = {}) {
    this.client = new JmapClient({ baseUrl, username: creds.username, secret: creds.secret }, opts)
  }

  private async call(name: string, args: Record<string, unknown>): Promise<any> {
    const accountId = await this.client.accountId(STALWART_JMAP)
    const [[, res]] = await this.client.call([[name, { accountId, ...args }, '0']], [JMAP_CORE, STALWART_JMAP])
    return res
  }

  async domainId(domain: string): Promise<string | null> {
    const res = await this.call('x:Domain/get', { properties: ['name', 'isEnabled'] })
    const hit = (res.list ?? []).find((d: { name: string }) => d.name.toLowerCase() === domain.toLowerCase())
    return hit?.id ?? null
  }

  async findAccount(name: string, domainId: string): Promise<StalwartAccount | null> {
    const q = await this.call('x:Account/query', { filter: { name, domainId } })
    const ids: string[] = q.ids ?? []
    if (!ids.length) return null
    const g = await this.call('x:Account/get', { ids, properties: ['name', 'domainId', 'description'] })
    const exact = (g.list ?? []).filter((a: StalwartAccount) => a.name === name && a.domainId === domainId)
    if (exact.length > 1) throw new JmapError(`Multiple Stalwart accounts named ${name}`, 'protocol')
    return exact[0] ?? null
  }

  async listAccounts(domainId: string): Promise<StalwartAccount[]> {
    const q = await this.call('x:Account/query', { filter: { domainId } })
    if (!(q.ids ?? []).length) return []
    const g = await this.call('x:Account/get', { ids: q.ids, properties: ['name', 'domainId', 'description'] })
    return (g.list ?? []) as StalwartAccount[]
  }

  async createAccount(input: { name: string; domainId: string; description: string; password: string; displayName?: string; locale?: string; quotaBytes?: number }): Promise<string> {
    const create: Record<string, unknown> = {
      '@type': 'User',
      name: input.name,
      domainId: input.domainId,
      description: input.description,
      roles: { '@type': 'User' },
      permissions: { '@type': 'Inherit' },
      credentials: { '0': { '@type': 'Password', secret: input.password } },
      encryptionAtRest: { '@type': 'Disabled' },
    }
    if (input.locale) create.locale = input.locale
    if (input.quotaBytes) create.quotas = { maxDiskQuota: input.quotaBytes }
    const res = await this.call('x:Account/set', { create: { a: create } })
    const id = res.created?.a?.id as string | undefined
    // Never echo the request (it holds a credential) — only the server's error type/description.
    if (!id) throw new JmapError(`Stalwart refused to create ${input.name}: ${describeSetError(res.notCreated?.a)}`, 'method')
    return id
  }

  async resetPassword(accountId: string, password: string): Promise<void> {
    const res = await this.call('x:Account/set', { update: { [accountId]: { credentials: { '0': { '@type': 'Password', secret: password } } } } })
    if (!res.updated || !(accountId in res.updated)) throw new JmapError(`Could not reset mailbox password: ${describeSetError(res.notUpdated?.[accountId])}`, 'method')
  }

  async destroyAccount(accountId: string): Promise<void> {
    const res = await this.call('x:Account/set', { destroy: [accountId] })
    if (!(res.destroyed ?? []).includes(accountId)) throw new JmapError(`Could not delete account: ${describeSetError(res.notDestroyed?.[accountId])}`, 'method')
  }
}

/** As the mailbox user: mint a device-scoped app password (secret returned once). */
export async function createAppPassword(baseUrl: string, address: string, password: string, description: string, opts: { fetch?: FetchLike } = {}): Promise<{ secret: string; accountId: string; credentialId: string }> {
  const user = new JmapClient({ baseUrl, username: address, secret: password }, opts)
  const accountId = await user.accountId(STALWART_JMAP)
  const [[, res]] = await user.call([['x:AppPassword/set', { accountId, create: { p: { description, permissions: { '@type': 'Inherit' } } } }, '0']], [JMAP_CORE, STALWART_JMAP])
  const created = res.created?.p
  if (!created?.secret) throw new JmapError(`Could not create an app password: ${describeSetError(res.notCreated?.p)}`, 'method')
  return { secret: created.secret as string, accountId: await user.accountId(), credentialId: String(created.id) }
}
