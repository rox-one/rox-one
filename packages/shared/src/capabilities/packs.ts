/**
 * Capability pack inventory (Rox issue 24).
 *
 * Curated tools grouped into installable packs. A `gitRef` is the verified
 * upstream commit when one is authoritative, otherwise null; pins are never
 * synthesized from tool metadata. Nothing is globally installed or
 * auto-enabled. High-risk tools stay available until the user explicitly allows
 * them.
 */

export const CAPABILITY_PACK_IDS = [
  'code-intelligence',
  'browser',
  'documents',
  'reminders',
  'security-sbom',
  'research',
] as const

export type CapabilityPackId = (typeof CAPABILITY_PACK_IDS)[number]

export type CapabilityPermission = 'none' | 'ask' | 'allow-all'

export type CapabilityTool = {
  id: string
  title: string
  packId: CapabilityPackId
  license: string
  version: string
  /**
   * 40-hex upstream commit compatible with marketplace `source.ref`, or null
   * when the tool is pinned by a package version instead of a verified commit.
   */
  gitRef: string | null
  /** 64-hex verified content checksum, or null when no digest was published. */
  checksum: string | null
  sourceRepo: string
  highRisk: boolean
  default: 'available'
  sizeHintKb: number
  expectedOutput: string
  whenToActivate: string
  permission: CapabilityPermission
  unusualUse: string
}

export type CapabilityPack = {
  id: CapabilityPackId
  toolIds: readonly string[]
}

function tool(
  id: string,
  title: string,
  packId: CapabilityPackId,
  license: string,
  version: string,
  opts: {
    sourceRepo: string
    /** Verified upstream 40-hex commit; omit unless the audit fixed one. */
    gitRef?: string
    /** Verified 64-hex artifact checksum; omit unless upstream publishes one. */
    checksum?: string
    highRisk?: boolean
    sizeHintKb: number
    expectedOutput: string
    whenToActivate: string
    permission: CapabilityPermission
    unusualUse: string
  },
): CapabilityTool {
  return {
    id,
    title,
    packId,
    license,
    version,
    gitRef: opts.gitRef ?? null,
    checksum: opts.checksum ?? null,
    sourceRepo: opts.sourceRepo,
    highRisk: opts.highRisk ?? false,
    default: 'available',
    sizeHintKb: opts.sizeHintKb,
    expectedOutput: opts.expectedOutput,
    whenToActivate: opts.whenToActivate,
    permission: opts.permission,
    unusualUse: opts.unusualUse,
  }
}

export const CAPABILITY_TOOLS: readonly CapabilityTool[] = [
  tool('openwiki', 'OpenWiki', 'code-intelligence', 'MIT', '0.7.1', {
    sourceRepo: 'langchain-ai/openwiki',
    gitRef: '0db6dcf0ca16e81c93ff1125312be0ad6f70df6a',
    sizeHintKb: 420,
    expectedOutput: 'Repository wiki pages (OKF markdown) with evidence links.',
    whenToActivate: 'Repository exploration when the user needs a map of modules.',
    permission: 'none',
    unusualUse: 'Do not scrape private remotes without an explicit ask.',
  }),
  tool('understand-anything', 'Understand Anything', 'code-intelligence', 'MIT', '1d7418b8', {
    sourceRepo: 'Egonex-AI/Understand-Anything',
    gitRef: '1d7418b8abfa543744ae029e63a482aee03f9022',
    sizeHintKb: 510,
    expectedOutput: 'Interactive knowledge graph and learning tour for a symbol or file.',
    whenToActivate: 'User asks what a file or symbol does.',
    permission: 'none',
    unusualUse: 'Skip generated vendor trees.',
  }),
  tool('codegraph', 'CodeGraphContext', 'code-intelligence', 'MIT', '0.6.13', {
    sourceRepo: 'CodeGraphContext/CodeGraphContext',
    sizeHintKb: 640,
    expectedOutput: 'Directed graph of modules, call chains and dependencies.',
    whenToActivate: 'Dependency or call-path questions.',
    permission: 'none',
    unusualUse: 'Do not index secrets or .env files.',
  }),
  tool('archify', 'Archify', 'code-intelligence', 'MIT', '3.0.1', {
    sourceRepo: 'tt-a1i/archify',
    sizeHintKb: 300,
    expectedOutput: 'Interactive HTML/SVG diagram (PNG export) from a typed IR.',
    whenToActivate: 'Cross-package design questions.',
    permission: 'none',
    unusualUse: 'Do not invent services that are not in the tree.',
  }),
  tool('graphify', 'Graphify', 'code-intelligence', 'Apache-2.0', '0.9.82', {
    sourceRepo: 'Graphify-Labs/graphify',
    gitRef: '5b74d7d74911cf435c8f1636b6f96ea202cc6246',
    sizeHintKb: 220,
    expectedOutput: 'Rendered knowledge graph from local AST parsing.',
    whenToActivate: 'User wants a picture of an already-built graph.',
    permission: 'none',
    unusualUse: 'Do not re-crawl the repo if CodeGraph output exists.',
  }),
  tool('groma', 'Groma.md', 'code-intelligence', 'MIT', '0.6.6', {
    sourceRepo: 'MrLesk/groma.md',
    gitRef: '9c5b6adc8e1d192198809d0566f596fe4da92d69',
    sizeHintKb: 340,
    expectedOutput: 'Diffable OKF markdown C4 architecture map stored in Git.',
    whenToActivate: 'Architecture documentation that must stay diffable in Git.',
    permission: 'none',
    unusualUse: 'Do not let generated maps overwrite curated architecture.',
  }),
  tool('visual-explainer', 'visual-explainer', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/visual-explainer',
    sizeHintKb: 180,
    expectedOutput: 'Diagram or mermaid of the requested flow.',
    whenToActivate: 'User asks how a flow works visually.',
    permission: 'none',
    unusualUse: 'Do not screenshot unrelated UI.',
  }),
  tool('agent-scripts', 'agent-scripts', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/agent-scripts',
    sizeHintKb: 90,
    expectedOutput: 'Pinned helper scripts under the workspace.',
    whenToActivate: 'Repeatable repo tasks that already have a script.',
    permission: 'ask',
    unusualUse: 'Never curl|sh an unsigned script.',
  }),
  tool('cua', 'CUA', 'browser', 'Apache-2.0', '0.1.0', {
    sourceRepo: 'example/cua',
    highRisk: true,
    sizeHintKb: 800,
    expectedOutput: 'Browser action log for the requested page.',
    whenToActivate: 'Interactive browser work the user asked for.',
    permission: 'ask',
    unusualUse: 'Do not auto-enable. Never capture credentials.',
  }),
  tool('sweetcookie', 'SweetCookie', 'browser', 'MIT', '0.1.0', {
    sourceRepo: 'example/sweetcookie',
    highRisk: true,
    sizeHintKb: 120,
    expectedOutput: 'Cookie jar scoped to the named profile.',
    whenToActivate: 'Logged-in browser sessions the user requested.',
    permission: 'ask',
    unusualUse: 'Do not export cookies. Do not auto-enable.',
  }),
  tool('sweetlink', 'sweetlink', 'browser', 'MIT', '0.1.0', {
    sourceRepo: 'example/sweetlink',
    highRisk: true,
    sizeHintKb: 80,
    expectedOutput: 'Resolved live URL after browser navigation.',
    whenToActivate: 'User needs a live link from an authenticated page.',
    permission: 'ask',
    unusualUse: 'Do not follow arbitrary redirects off-site.',
  }),
  tool('summarize', 'summarize', 'documents', 'MIT', '0.1.0', {
    sourceRepo: 'example/summarize',
    sizeHintKb: 60,
    expectedOutput: 'Short summary with source spans.',
    whenToActivate: 'Long local document the user asked to compress.',
    permission: 'none',
    unusualUse: 'Do not summarize files outside the workspace without ask.',
  }),
  tool('document-tooling', 'document tooling', 'documents', 'MIT', '0.1.0', {
    sourceRepo: 'example/document-tooling',
    sizeHintKb: 150,
    expectedOutput: 'Extracted text or tables from a local document.',
    whenToActivate: 'PDF/DOCX/MD extraction inside the workspace.',
    permission: 'none',
    unusualUse: 'Do not OCR scanned IDs or secrets.',
  }),
  tool('remindctl', 'remindctl', 'reminders', 'MIT', '0.1.0', {
    sourceRepo: 'example/remindctl',
    sizeHintKb: 40,
    expectedOutput: 'Reminder id and next fire time.',
    whenToActivate: 'User asked to be reminded later.',
    permission: 'ask',
    unusualUse: 'Do not schedule network callbacks.',
  }),
  tool('syft', 'Syft', 'security-sbom', 'Apache-2.0', '1.0.0', {
    sourceRepo: 'anchore/syft',
    sizeHintKb: 900,
    expectedOutput: 'SBOM (SPDX or CycloneDX) for the local tree.',
    whenToActivate: 'License or dependency inventory questions.',
    permission: 'none',
    unusualUse: 'Do not upload the SBOM unless the user asked.',
  }),
  tool('fs-safe', 'fs-safe', 'security-sbom', 'MIT', '0.1.0', {
    sourceRepo: 'example/fs-safe',
    sizeHintKb: 50,
    expectedOutput: 'Allow/deny report for a filesystem path.',
    whenToActivate: 'Before writing outside the workspace.',
    permission: 'ask',
    unusualUse: 'Do not weaken path guards to make a task easier.',
  }),
  tool('firecrawl', 'Firecrawl', 'research', 'MIT', '0.1.0', {
    sourceRepo: 'example/firecrawl',
    highRisk: true,
    sizeHintKb: 200,
    expectedOutput: 'Fetched page markdown for the given URL.',
    whenToActivate: 'Research on a user-supplied public URL.',
    permission: 'ask',
    unusualUse: 'Do not crawl authenticated or internal hosts. Do not auto-enable.',
  }),
  tool('tokentally', 'tokentally', 'research', 'MIT', '0.1.0', {
    sourceRepo: 'example/tokentally',
    sizeHintKb: 30,
    expectedOutput: 'Token estimate vs actual usage.',
    whenToActivate: 'Cost or context-window questions.',
    permission: 'none',
    unusualUse: 'Do not send prompts to a third-party tokenizer.',
  }),
]

export const CAPABILITY_PACKS: readonly CapabilityPack[] = CAPABILITY_PACK_IDS.map((id) => ({
  id,
  toolIds: CAPABILITY_TOOLS.filter((item) => item.packId === id).map((item) => item.id),
}))

const BY_ID = new Map(CAPABILITY_TOOLS.map((item) => [item.id, item]))

export function getCapabilityTool(id: string): CapabilityTool | undefined {
  return BY_ID.get(id)
}

export function toolsInPack(packId: CapabilityPackId): CapabilityTool[] {
  return CAPABILITY_TOOLS.filter((item) => item.packId === packId)
}

export function isHighRiskCapability(id: string): boolean {
  return BY_ID.get(id)?.highRisk === true
}
