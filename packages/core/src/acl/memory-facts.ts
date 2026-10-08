/**
 * W1-04 (#1501) — In-memory `AclFactSource`.
 *
 * Reference implementation of the fact contract for tests, fixtures and the
 * W1-10 harness. Mutations bump the workspace policy epoch, exactly like the
 * server writers must (`workspace.policy_epoch`).
 */

import type { EntityRef } from '../entities/refs.ts'
import type {
  AclEntryFact,
  AclFactSource,
  AclMembership,
  AclPolicyFact,
  AclPrincipalGroups,
  AclResourceNode,
} from './evaluate.ts'

const refKey = (ref: EntityRef): string => `${ref.kind}:${ref.id}`

export class MemoryAclFacts implements AclFactSource {
  private readonly epochs = new Map<string, number>()
  private readonly memberships = new Map<string, AclMembership>()
  private readonly resources = new Map<string, AclResourceNode>()
  private readonly entryMap = new Map<string, AclEntryFact[]>()
  private readonly policies = new Map<string, AclPolicyFact>()
  private readonly groupMap = new Map<string, AclPrincipalGroups>()
  /** Number of `resource()` reads (tests assert cache hits). */
  resourceReads = 0

  private bump(workspaceId: string): void {
    this.epochs.set(workspaceId, (this.epochs.get(workspaceId) ?? 1) + 1)
  }

  policyEpoch(workspaceId: string): string {
    return String(this.epochs.get(workspaceId) ?? 1)
  }

  /** Bump without changing facts (e.g. an external writer committed). */
  bumpEpoch(workspaceId: string): void {
    this.bump(workspaceId)
  }

  membership(workspaceId: string, principalId: string): AclMembership | null {
    return this.memberships.get(`${workspaceId}\0${principalId}`) ?? null
  }

  resource(workspaceId: string, ref: EntityRef): AclResourceNode | null {
    this.resourceReads += 1
    return this.resources.get(`${workspaceId}\0${refKey(ref)}`) ?? null
  }

  entries(workspaceId: string, ref: EntityRef): readonly AclEntryFact[] {
    return this.entryMap.get(`${workspaceId}\0${refKey(ref)}`) ?? []
  }

  policy(workspaceId: string, ref: EntityRef): AclPolicyFact | null {
    return this.policies.get(`${workspaceId}\0${refKey(ref)}`) ?? null
  }

  groups(workspaceId: string, principalId: string): AclPrincipalGroups {
    return this.groupMap.get(`${workspaceId}\0${principalId}`) ?? { departmentIds: [], channelIds: [] }
  }

  setMember(workspaceId: string, principalId: string, membership: AclMembership | null): this {
    const key = `${workspaceId}\0${principalId}`
    if (membership) this.memberships.set(key, membership)
    else this.memberships.delete(key)
    this.bump(workspaceId)
    return this
  }

  /** Register a resource node (stored under its own `workspaceId`). */
  setResource(node: AclResourceNode, storeUnderWorkspaceId = node.workspaceId): this {
    this.resources.set(`${storeUnderWorkspaceId}\0${refKey(node.ref)}`, node)
    this.bump(storeUnderWorkspaceId)
    return this
  }

  grant(workspaceId: string, ref: EntityRef, entry: AclEntryFact): this {
    const key = `${workspaceId}\0${refKey(ref)}`
    const list = (this.entryMap.get(key) ?? []).filter(e => !(e.subjectType === entry.subjectType && e.subjectId === entry.subjectId))
    list.push(entry)
    this.entryMap.set(key, list)
    this.bump(workspaceId)
    return this
  }

  revoke(workspaceId: string, ref: EntityRef, subjectType: AclEntryFact['subjectType'], subjectId: string): this {
    const key = `${workspaceId}\0${refKey(ref)}`
    this.entryMap.set(key, (this.entryMap.get(key) ?? []).filter(e => !(e.subjectType === subjectType && e.subjectId === subjectId)))
    this.bump(workspaceId)
    return this
  }

  setPolicy(workspaceId: string, ref: EntityRef, policy: AclPolicyFact | null): this {
    const key = `${workspaceId}\0${refKey(ref)}`
    if (policy) this.policies.set(key, policy)
    else this.policies.delete(key)
    this.bump(workspaceId)
    return this
  }

  setGroups(workspaceId: string, principalId: string, groups: AclPrincipalGroups): this {
    this.groupMap.set(`${workspaceId}\0${principalId}`, groups)
    this.bump(workspaceId)
    return this
  }
}
