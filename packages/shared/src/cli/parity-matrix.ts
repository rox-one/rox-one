/**
 * Rox CLI / Pi capability parity matrix (Issue 22).
 *
 * G1–G4 shipped on main; this fixture is the mechanical gate so the
 * remaining catalog work cannot silently drop a closed capability.
 */

export type RoxCliParityStatus = 'done' | 'wont-do'

export interface RoxCliParityRow {
  id: 'G1' | 'G2' | 'G3' | 'G4'
  title: string
  status: RoxCliParityStatus
  /** Compatibility runtime id — not user-facing copy. */
  compatibilityId: string
  evidence: string
}

export const ROX_CLI_PARITY_MATRIX: readonly RoxCliParityRow[] = [
  {
    id: 'G1',
    title: 'MCP source proxies',
    status: 'done',
    compatibilityId: 'set_host_tools',
    evidence: 'buildSessionToolDefs({ includePoolProxyDefs: true })',
  },
  {
    id: 'G2',
    title: 'Thinking stream',
    status: 'done',
    compatibilityId: 'thinking_delta',
    evidence: 'AgentEvent thinking_delta / thinking_complete',
  },
  {
    id: 'G3',
    title: 'Branching',
    status: 'done',
    compatibilityId: 'branch',
    evidence: 'OmpAgent.supportsBranching',
  },
  {
    id: 'G4',
    title: 'Skills discovery',
    status: 'done',
    compatibilityId: 'skills:importOmp',
    evidence: 'discoverOmpSkills / skills:importOmp',
  },
]
