export {
  ROX_VISIBLE_TERMS,
  COMPATIBILITY_RUNTIME_TERMS,
  TERMINOLOGY_KEY_ALLOWLIST,
  isAllowlistedLocaleKey,
  isCompatibilityRuntimeTerm,
  localeValueViolations,
  type RoxVisibleTerm,
  type CompatibilityRuntimeTerm,
  type CompatibilityContextKind,
  type TerminologyAllowlistEntry,
} from './terms.ts'

export {
  DEFAULT_AGENT_SERIAL,
  generateDefaultAgentIdentity,
  resolveAgentIdentity,
  persistAgentIdentity,
  formatAgentIdentityForPrompt,
  formatSessionAgentLabel,
  gitCoAuthorTrailer,
  type AgentIdentity,
  type AgentIdentitySource,
  type AgentIdentityRecord,
} from './agent-identity.ts'
