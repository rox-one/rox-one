/**
 * W1-04 (#1501) — ACL gate for entity resolution and link listings.
 *
 * Every resolve and every outgoing / backlinks listing goes through
 * `acl.can` / `acl.evaluate` (TECH-SPEC §3.3, §7; DATA-MODEL §8.3
 * "resolver: a preview is always computed with the viewer's rights"):
 *
 * - resolve: refs without `view_title` never reach a resolver and come back
 *   as `restrictPreview`-shaped `no_access` previews; `minimal` refs are
 *   resolved and stripped to a title-only preview;
 * - outgoing: the source must be viewable; unviewable targets are redacted
 *   to `{ kind, id: 'restricted' }` and secret targets are omitted;
 * - backlinks: the target must be viewable; links from unviewable sources
 *   are omitted (a backlink row exposes its source);
 * - add / remove: require `edit` on the link source.
 *
 * The local host uses `createLocalAcl()` (owner of everything), so with the
 * shim in place local behaviour is unchanged; a shared / remote host injects
 * the workspace ACL AND its principal mapping through
 * `EntitiesHandlerRuntime.acl` (async `{ acl, principalFor }`), so guests,
 * principal status and placeholders resolve exactly as in the workspace
 * service's `WorkspaceAcl.principalFor`.
 */

import {
  createLocalAcl,
  listingVisibility,
  type Acl,
  type AclDecision,
  type AclPrincipal,
} from '@rox/core/acl'
import {
  kindDescriptor,
  restrictPreview,
  type Actor,
  type EntityLink,
  type EntityPreview,
  type EntityRef,
} from '@rox/core/entities'

/** Id that replaces an unviewable link target. */
export const RESTRICTED_REF_ID = 'restricted'

export interface EntityAclGate {
  acl: Acl
  /**
   * Map a resolver actor to an ACL principal in the gate's workspace. May be
   * async: the injected mapping looks up `principal.kind` / `status`.
   */
  principalFor(actor: Actor): AclPrincipal | Promise<AclPrincipal>
}

/** What a host injects per workspace: the ACL and (optionally) its principal mapping. */
export interface EntityAclRuntime {
  acl: Acl
  principalFor?(actor: Actor): AclPrincipal | Promise<AclPrincipal>
}

/** `EntitiesHandlerRuntime.acl`: per-workspace ACL runtime, sync or async. */
export type EntityAclFactory = (workspaceId: string) => EntityAclRuntime | Promise<EntityAclRuntime>

/** The process-wide local shim (single-user host: owner of everything). */
const LOCAL_ACL: Acl = createLocalAcl()

export function principalForActor(workspaceId: string, actor: Actor): AclPrincipal {
  return { id: actor.id, workspaceId, kind: actor.kind === 'agent' ? 'bot' : 'human' }
}

export function createEntityAclGate(workspaceId: string, acl: Acl = LOCAL_ACL, principalFor?: EntityAclRuntime['principalFor']): EntityAclGate {
  return { acl, principalFor: principalFor ?? (actor => principalForActor(workspaceId, actor)) }
}

/** Build the gate for a workspace from the (optional, possibly async) runtime factory. */
export async function resolveEntityAclGate(workspaceId: string, factory?: EntityAclFactory): Promise<EntityAclGate> {
  if (!factory) return createEntityAclGate(workspaceId)
  const runtime = await factory(workspaceId)
  return createEntityAclGate(workspaceId, runtime.acl, runtime.principalFor?.bind(runtime))
}

/** Wire-shaped `no_access` preview built through `restrictPreview` (no entity data). */
export function noAccessPreview(ref: EntityRef): EntityPreview {
  const descriptor = kindDescriptor(ref.kind)
  const restricted = restrictPreview(ref, ref.kind, descriptor?.icon ?? 'link', descriptor?.labelKey ?? `entities.kind.${ref.kind}`)
  return {
    ref,
    status: restricted.status,
    title: restricted.title,
    kindLabel: restricted.kindLabel,
    icon: restricted.icon,
    authority: descriptor?.authorities[0] ?? 'local',
    etag: '',
  }
}

/** `minimal` role: title and status only (DATA-MODEL §8.1). */
export function titleOnlyPreview(preview: EntityPreview): EntityPreview {
  if (preview.status === 'no_access' || preview.status === 'unavailable' || preview.status === 'tombstone') return preview
  return {
    ref: preview.ref,
    status: 'minimal',
    title: preview.title,
    kindLabel: preview.kindLabel,
    icon: preview.icon,
    authority: preview.authority,
    etag: preview.etag,
  }
}

/**
 * Resolve a batch under ACL: only refs the actor may at least see the title
 * of are passed to `resolveAllowed`; output order matches `refs`.
 */
export async function resolveWithAcl(
  gate: EntityAclGate,
  refs: readonly EntityRef[],
  actor: Actor,
  resolveAllowed: (refs: EntityRef[]) => Promise<EntityPreview[]>,
): Promise<EntityPreview[]> {
  const principal = await gate.principalFor(actor)
  const decisions = await gate.acl.evaluateMany(principal, 'view', refs)
  const allowedIdx: number[] = []
  for (let i = 0; i < refs.length; i++) if (decisions[i]!.preview !== 'none') allowedIdx.push(i)
  const resolved = allowedIdx.length ? await resolveAllowed(allowedIdx.map(i => refs[i]!)) : []
  const out: EntityPreview[] = refs.map(ref => noAccessPreview(ref))
  allowedIdx.forEach((index, j) => {
    const preview = resolved[j] ?? noAccessPreview(refs[index]!)
    out[index] = decisions[index]!.preview === 'minimal' ? titleOnlyPreview(preview) : preview
  })
  return out
}

function redactTarget(link: EntityLink): EntityLink {
  return { ...link, to: { kind: link.to.kind, id: RESTRICTED_REF_ID } }
}

async function sourceViewable(gate: EntityAclGate, actor: Actor, ref: EntityRef): Promise<boolean> {
  const decision: AclDecision = await gate.acl.evaluate(await gate.principalFor(actor), 'view', ref)
  return decision.allowed
}

/** Outgoing links of `source`: both ends viewable, or the target redacted; secret targets omitted. */
export async function filterOutgoingLinks(gate: EntityAclGate, actor: Actor, source: EntityRef, links: readonly EntityLink[]): Promise<EntityLink[]> {
  if (!(await sourceViewable(gate, actor, source))) return []
  const decisions = await gate.acl.evaluateMany(await gate.principalFor(actor), 'view', links.map(link => link.to))
  const out: EntityLink[] = []
  links.forEach((link, i) => {
    const visibility = listingVisibility(decisions[i]!)
    if (visibility === 'show' || visibility === 'title-only') out.push(link)
    else if (visibility === 'restricted') out.push(redactTarget(link))
  })
  return out
}

/** Backlinks of `target`: the target must be viewable; unviewable sources are omitted. */
export async function filterBacklinks(gate: EntityAclGate, actor: Actor, target: EntityRef, links: readonly EntityLink[]): Promise<EntityLink[]> {
  if (!(await sourceViewable(gate, actor, target))) return []
  const decisions = await gate.acl.evaluateMany(await gate.principalFor(actor), 'view', links.map(link => link.from))
  const out: EntityLink[] = []
  links.forEach((link, i) => {
    const visibility = listingVisibility(decisions[i]!)
    if (visibility === 'show' || visibility === 'title-only') out.push(link)
  })
  return out
}

/** Link writes require `edit` on the source. */
export async function canWriteLink(gate: EntityAclGate, actor: Actor, from: EntityRef): Promise<boolean> {
  return gate.acl.can(await gate.principalFor(actor), 'edit', from)
}
