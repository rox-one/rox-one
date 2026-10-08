/**
 * W1-10 (#1507) — agent-panel privacy fixtures (TECH-SPEC §18.3).
 *
 * Shipped as data; W1-15 (#1512) supplies the real provider. Rules under
 * test (§18.3 item 1):
 * 1. a note with `authority: 'local'` that is not the focus is never
 *    auto-attached;
 * 2. DMs other than the open one are never auto-attached;
 * 3. a ref the actor cannot read is never auto-attached and is redacted to
 *    `{ ref, restricted: true }`.
 *
 * The provider receives the whole candidate (every fact the decision
 * depends on) plus the acting user, so a correct implementation never has
 * to recognise fixture ids.
 */

export interface PrivacyActor {
  principalId: string
  workspaceId: string
}

export interface PrivacyCandidate {
  ref: string
  /** Entity kind of the ref (`note`, `channel-message`, `goal`, `task`, …). */
  entityKind: string
  /** Harness classification of the case (documentation; not needed to decide). */
  kind: 'local-note' | 'dm' | 'restricted' | 'allowed'
  authority?: 'local' | 'workspace'
  /** The ref is the panel's focus. */
  isFocus?: boolean
  /** The ref is a direct-message item. */
  isDm?: boolean
  /** The DM is the one currently open. */
  isOpenDm?: boolean
  /** The actor may read the ref (ACL already evaluated by the resolver). */
  canRead: boolean
}

/**
 * What the #1512 provider receives: the candidate WITHOUT the harness `kind`
 * label, which encodes the expected answer (#1507 review 3).
 */
export type ProviderCandidate = Omit<PrivacyCandidate, 'kind'>

/** Fresh provider-facing copy of a fixture (no `kind`; a provider cannot mutate the shared fixture). */
export function providerCandidate(candidate: PrivacyCandidate): ProviderCandidate {
  const { kind: _label, ...facts } = candidate
  return { ...facts }
}

/** The acting user every fixture is evaluated for. */
export const PRIVACY_ACTOR: PrivacyActor = { principalId: 'p-privacy-actor', workspaceId: 'ws-privacy' }

export const PRIVACY_FIXTURES: PrivacyCandidate[] = [
  { ref: 'note:private-diary', entityKind: 'note', kind: 'local-note', authority: 'local', isFocus: false, canRead: true },
  { ref: 'note:focus-doc', entityKind: 'note', kind: 'allowed', authority: 'workspace', isFocus: true, canRead: true },
  { ref: 'channel-message:other-dm-1', entityKind: 'channel-message', kind: 'dm', authority: 'workspace', isDm: true, isOpenDm: false, canRead: true },
  { ref: 'channel-message:open-dm-1', entityKind: 'channel-message', kind: 'allowed', authority: 'workspace', isDm: true, isOpenDm: true, canRead: true },
  { ref: 'goal:secret-goal', entityKind: 'goal', kind: 'restricted', authority: 'workspace', canRead: false },
  { ref: 'task:visible-task', entityKind: 'task', kind: 'allowed', authority: 'workspace', canRead: true },
]

export interface PrivacyExpectation {
  ref: string
  autoAttach: boolean
  redacted: boolean
}

export const PRIVACY_EXPECTATIONS: PrivacyExpectation[] = [
  { ref: 'note:private-diary', autoAttach: false, redacted: true },
  { ref: 'note:focus-doc', autoAttach: true, redacted: false },
  { ref: 'channel-message:other-dm-1', autoAttach: false, redacted: true },
  { ref: 'channel-message:open-dm-1', autoAttach: true, redacted: false },
  { ref: 'goal:secret-goal', autoAttach: false, redacted: true },
  { ref: 'task:visible-task', autoAttach: true, redacted: false },
]

/** A reference decision derived only from candidate facts (used by self-tests). */
export function referencePrivacyDecision(c: ProviderCandidate): { attach: boolean; redacted: boolean } {
  const hidden = !c.canRead || (c.authority === 'local' && !c.isFocus) || (c.isDm === true && !c.isOpenDm)
  return { attach: !hidden, redacted: hidden }
}
