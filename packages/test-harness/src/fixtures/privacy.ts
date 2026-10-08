/**
 * W1-10 (#1507) — agent-panel privacy fixtures (TECH-SPEC §18.3).
 *
 * Shipped as data plus pending tests; W1-15 fills in the real provider.
 * Rules under test:
 * 1. a private (`authority: 'local'`) note that is not the focus is never
 *    auto-attached;
 * 2. another user's DM is never auto-attached;
 * 3. restricted refs are redacted to `{ kind, restricted: true }`.
 */

export interface PrivacyCandidate {
  ref: string
  kind: 'local-note' | 'dm' | 'restricted' | 'allowed'
  authority?: 'local' | 'workspace'
  isFocus?: boolean
  isOpenDm?: boolean
}

export const PRIVACY_FIXTURES: PrivacyCandidate[] = [
  { ref: 'note:private-diary', kind: 'local-note', authority: 'local', isFocus: false },
  { ref: 'note:focus-doc', kind: 'allowed', authority: 'workspace', isFocus: true },
  { ref: 'channel-message:other-dm-1', kind: 'dm', isOpenDm: false },
  { ref: 'channel-message:open-dm-1', kind: 'allowed', isOpenDm: true },
  { ref: 'goal:secret-goal', kind: 'restricted' },
  { ref: 'task:visible-task', kind: 'allowed', authority: 'workspace' },
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
