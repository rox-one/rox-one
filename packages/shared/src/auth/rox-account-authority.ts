/** Host-owned account authority. Native grants and cloud identity are independent. */
import { randomUUID } from 'node:crypto'
import { registerSecretValues } from '../secrets/redact.ts'
import type { RoxCloudOwner } from '../credentials/manager.ts'
import { RoxConnectFlow } from './rox-connect-flow.ts'
import { getRoxAuthBaseUrl, isRoxCloudRequired } from './rox-cloud.ts'
import { startPocketDeviceFlow, waitForPocketApproval, refreshPocketSession, logoutPocketSession, fetchPocketAccount, fetchPocketCredential, type PocketProof, type PocketApproval, type RoxAccountSnapshot, type RoxInferenceCredential } from './rox-pocket-client.ts'

export const LOCAL_ROX_CALLER: Readonly<RoxCloudOwner> = Object.freeze({ issuer: 'rox:local-electron', subject: 'installation' })
export interface RoxExecutionContext { readonly caller: Readonly<RoxCloudOwner>; readonly cloudAccountId: string; readonly authGeneration: string }
export interface PocketAccountRecord {
  accountId: string; authGeneration: string; accessToken: string; refreshToken: string; expiresAt: number
  refreshId?: string; snapshot?: RoxAccountSnapshot; credential?: RoxInferenceCredential
}
export interface PocketBinding { caller: RoxCloudOwner; accountId: string; authGeneration?: string }
export type PocketLogoutRecord = Pick<PocketAccountRecord, 'accountId' | 'accessToken' | 'refreshToken' | 'refreshId'>
export interface PocketAccountStore {
  readLogout(caller: RoxCloudOwner): Promise<PocketLogoutRecord | null>
  writeLogout(caller: RoxCloudOwner, record: PocketLogoutRecord): Promise<void>
  clearLogout(caller: RoxCloudOwner): Promise<void>
  readBinding?(resource: string): Promise<PocketBinding | null>
  writeBinding?(resource: string, binding: PocketBinding): Promise<void>
  read(caller: RoxCloudOwner): Promise<PocketAccountRecord | null>
  write(caller: RoxCloudOwner, record: PocketAccountRecord): Promise<void>
  clear(caller: RoxCloudOwner): Promise<void>
}
export interface PocketClient {
  start: typeof startPocketDeviceFlow; wait: typeof waitForPocketApproval; refresh: typeof refreshPocketSession
  logout: typeof logoutPocketSession; account: typeof fetchPocketAccount; credential: typeof fetchPocketCredential
}
const defaultClient: PocketClient = { start: startPocketDeviceFlow, wait: waitForPocketApproval, refresh: refreshPocketSession, logout: logoutPocketSession, account: fetchPocketAccount, credential: fetchPocketCredential }
const callerKey = (caller: RoxCloudOwner) => JSON.stringify([caller.issuer, caller.subject])

export class RoxAccountAuthority {
  private records = new Map<string, PocketAccountRecord | null>()
  private loads = new Map<string, Promise<PocketAccountRecord | null>>()
  private flows = new Map<string, RoxConnectFlow>()
  private generations = new Map<string, string>()
  private operations = new Map<string, Promise<unknown>>()
  private bindingOperations = new Map<string, Promise<void>>()
  private listeners = new Set<(caller: RoxCloudOwner) => void>()
  constructor(private store: PocketAccountStore, private client: PocketClient = defaultClient) {}
  onInvalidated(listener: (caller: RoxCloudOwner) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private invalidate(caller: RoxCloudOwner) {
    this.generations.set(callerKey(caller), randomUUID())
    for (const listener of this.listeners) listener(caller)
  }
  private async record(caller: RoxCloudOwner): Promise<PocketAccountRecord | null> {
    const key = callerKey(caller)
    if (this.records.has(key)) return this.records.get(key)!
    if (!this.loads.has(key)) this.loads.set(key, (async () => {
      // Revocation intent is the durable fence, even if a crash left the
      // separately sealed active record behind. Never load it for execution.
      if (await this.store.readLogout(caller)) {
        this.invalidate(caller)
        return null
      }
      return this.store.read(caller)
    })().then(record => {
      if (record) registerSecretValues([record.accessToken, record.refreshToken, record.credential?.apiKey ?? ''])
      this.records.set(key, record)
      if (!this.generations.has(key)) this.generations.set(key, record?.authGeneration ?? randomUUID())
      return record
    }).finally(() => this.loads.delete(key)))
    return this.loads.get(key)!
  }
  private serial<T>(caller: RoxCloudOwner, operation: () => Promise<T>): Promise<T> {
    const key = callerKey(caller)
    const next = (this.operations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.operations.set(key, next)
    return next
  }
  private flow(caller: RoxCloudOwner): RoxConnectFlow {
    const key = callerKey(caller)
    let flow = this.flows.get(key)
    if (!flow) {
      let proof: PocketProof | undefined
      flow = new RoxConnectFlow({
        start: async signal => { const result = await this.client.start(signal); proof = result.proof; return result.started },
        wait: (code, options) => { if (!proof) throw new Error('ROX_AUTH_INVALID_RESPONSE'); return this.client.wait(code, proof, options) },
        save: async result => this.serial(caller, async () => {
          const approved = result as PocketApproval
          if (!approved.refreshToken) throw new Error('ROX_AUTH_INVALID_RESPONSE')
          registerSecretValues([approved.accessToken, approved.refreshToken])
          const generation = this.generations.get(key)!
          const record: PocketAccountRecord = { accountId: approved.user.id, authGeneration: generation, accessToken: approved.accessToken, refreshToken: approved.refreshToken, expiresAt: Date.now() + approved.expiresIn * 1000 }
          // Save authentication before remote provisioning. A provisioning outage
          // is recoverable on restart and must not lose an already redeemed grant.
          await this.store.write(caller, record)
          if (this.generations.get(key) !== generation) { await this.store.clear(caller); return }
          this.records.set(key, record)
          await this.update(caller, record, true)
        }),
        clear: async () => this.serial(caller, async () => { this.records.set(key, null); await this.store.clear(caller) }),
        failed: () => {},
      })
      this.flows.set(key, flow)
    }
    return flow
  }
  async start(caller: RoxCloudOwner) {
    await this.record(caller)
    // Restarting Connect switches accounts: fence and revoke the old device.
    await this.logout(caller)
    return this.flow(caller).start()
  }
  async logout(caller: RoxCloudOwner): Promise<void> {
    const old = await this.record(caller)
    this.invalidate(caller)
    this.records.set(callerKey(caller), null)
    // Retain a sealed revocation receipt until the broker acknowledges it.
    // A network outage must not make a cleared device impossible to revoke.
    if (old) await this.store.writeLogout(caller, old)
    await this.flow(caller).clear()
    await this.drainLogout(caller)
  }
  private async drainLogout(caller: RoxCloudOwner): Promise<void> {
    const pending = await this.store.readLogout(caller)
    if (pending) {
      this.records.set(callerKey(caller), null)
      // Clear the obsolete active record before releasing the durable fence.
      // If either local storage or the broker is unavailable, retain receipt.
      await this.store.clear(caller)
      // The broker's logout-only ancestry accepts this exact device's prior
      // access proof after refresh rotation; it grants no account/read access.
      // Revocation must not depend on the 60-second refresh replay cache.
      await this.client.logout(pending.accessToken)
      await this.store.clearLogout(caller)
    }
  }
  private current(caller: RoxCloudOwner, record: PocketAccountRecord) {
    if (this.generations.get(callerKey(caller)) !== record.authGeneration) throw new Error('ROX_ACCOUNT_CHANGED')
  }
  private async update(caller: RoxCloudOwner, record: PocketAccountRecord, bootstrap: boolean) {
    this.current(caller, record)
    if (record.expiresAt <= Date.now() + 30_000) {
      record.refreshId ??= randomUUID()
      await this.store.write(caller, record) // persisted proof survives dropped refresh response / process restart
      this.current(caller, record)
      const approved = await this.client.refresh(record.refreshToken, record.refreshId)
      this.current(caller, record)
      if (approved.user.id !== record.accountId) throw new Error('ROX_AUTH_INVALID_RESPONSE')
      registerSecretValues([approved.accessToken, approved.refreshToken])
      record = { ...record, accessToken: approved.accessToken, refreshToken: approved.refreshToken, expiresAt: Date.now() + approved.expiresIn * 1000, refreshId: undefined }
      await this.store.write(caller, record)
      this.current(caller, record)
      this.records.set(callerKey(caller), record)
    }
    const snapshot = await this.client.account(record.accessToken, bootstrap)
    this.current(caller, record)
    if (snapshot.user.id !== record.accountId) throw new Error('ROX_AUTH_INVALID_RESPONSE')
    let credential: RoxInferenceCredential | undefined
    if (snapshot.state === 'ready' && snapshot.key?.status === 'active') credential = await this.client.credential(record.accessToken, snapshot)
    if (credential) registerSecretValues([credential.apiKey])
    this.current(caller, record)
    if (record.credential && (!credential || record.credential.keyId !== credential.keyId || record.credential.generation !== credential.generation)) {
      this.invalidate(caller)
      record = { ...record, authGeneration: this.generations.get(callerKey(caller))! }
    }
    const next = { ...record, snapshot, credential }
    await this.store.write(caller, next)
    this.current(caller, record)
    this.records.set(callerKey(caller), next)
    return next
  }
  async state(caller: RoxCloudOwner) {
    return this.serial(caller, async () => {
      let record = await this.record(caller)
      let error: string | null = null
      try {
        await this.drainLogout(caller)
        record = await this.record(caller)
        if (record) record = await this.update(caller, record, !record.snapshot || record.snapshot.state !== 'ready')
      }
      catch (reason) { error = reason instanceof Error ? reason.message : 'ROX_AUTH_REQUEST_FAILED' }
      return { required: isRoxCloudRequired(), connected: !error && record?.snapshot?.state === 'ready' && !!record.credential, authBaseUrl: getRoxAuthBaseUrl(),
        user: record?.snapshot ? { id: record.accountId, email: record.snapshot.user.email, name: record.snapshot.user.name ?? '' } : null,
        account: error ? null : record?.snapshot ?? null, ...this.flow(caller).state, ...(error ? { connectError: error } : {}) }
    })
  }
  async bind(resource: string, context: RoxExecutionContext): Promise<void> {
    this.assertCurrent(context)
    if (!this.store.writeBinding) throw new Error('ROX_SECURE_BINDING_UNAVAILABLE')
    const next = (this.bindingOperations.get(resource) ?? Promise.resolve()).catch(() => {}).then(async () => {
      this.assertCurrent(context)
      const exclusiveSession = resource.startsWith('session:') || resource.startsWith('queued-message:')
      const previous = exclusiveSession ? await this.store.readBinding?.(resource) : undefined
      if (previous && callerKey(previous.caller) !== callerKey(context.caller)) throw new Error('ROX_SESSION_OWNER_CONFLICT')
      if (previous && resource.startsWith('queued-message:') && (previous.accountId !== context.cloudAccountId || previous.authGeneration !== context.authGeneration)) throw new Error('ROX_ACCOUNT_CHANGED')
      this.assertCurrent(context)
      await this.store.writeBinding!(resource, { caller: { ...context.caller }, accountId: context.cloudAccountId, authGeneration: context.authGeneration })
      this.assertCurrent(context)
    })
    this.bindingOperations.set(resource, next)
    try { await next } finally { if (this.bindingOperations.get(resource) === next) this.bindingOperations.delete(resource) }
  }
  async bound(resource: string, exactGeneration = false): Promise<RoxExecutionContext | undefined> {
    const binding = await this.store.readBinding?.(resource)
    if (!binding) return undefined
    const context = await this.capture(binding.caller)
    if (context.cloudAccountId !== binding.accountId || (exactGeneration && context.authGeneration !== binding.authGeneration)) throw new Error('ROX_ACCOUNT_CHANGED')
    return context
  }
  async capture(caller: RoxCloudOwner): Promise<RoxExecutionContext> {
    const state = await this.state(caller)
    if (!state.connected || !state.account) throw new Error('ROX_ACCOUNT_NOT_READY')
    const record = await this.record(caller)
    if (!record) throw new Error('ROX_ACCOUNT_NOT_READY')
    this.current(caller, record)
    return Object.freeze({ caller: Object.freeze({ ...caller }), cloudAccountId: record.accountId, authGeneration: record.authGeneration })
  }
  assertCurrent(context: RoxExecutionContext): void {
    const record = this.records.get(callerKey(context.caller))
    if (!record || record.accountId !== context.cloudAccountId || record.authGeneration !== context.authGeneration) throw new Error('ROX_ACCOUNT_CHANGED')
    this.current(context.caller, record)
  }
  async inference(context: RoxExecutionContext, paid = true): Promise<RoxInferenceCredential> {
    this.assertCurrent(context)
    const state = await this.state(context.caller)
    this.assertCurrent(context)
    if (!state.connected) throw new Error(state.connectError || 'ROX_ACCOUNT_NOT_READY')
    const record = this.records.get(callerKey(context.caller))!
    if (record?.snapshot?.state !== 'ready' || !record.credential || record.snapshot.key?.status !== 'active') throw new Error('ROX_ACCOUNT_NOT_READY')
    if (paid && !/[1-9]/.test(record.snapshot.balance.availableRox)) throw new Error('ROX_INSUFFICIENT_BALANCE')
    return record.credential
  }
}
let authority: RoxAccountAuthority | undefined
export function setRoxAccountAuthority(value: RoxAccountAuthority): void { authority = value }
export function peekRoxAccountAuthority(): RoxAccountAuthority | undefined { return authority }
export function getRoxAccountAuthority(): RoxAccountAuthority { if (!authority) throw new Error('ROX_OS_SECURE_STORAGE_UNAVAILABLE'); return authority }
