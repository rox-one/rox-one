/**
 * Capability pack inventory (Rox issue 24).
 *
 * Curated tools grouped into installable packs. Pins are declared checksums;
 * nothing is globally installed or auto-enabled. High-risk tools stay available
 * until the user explicitly allows them.
 */
import { createHash } from 'node:crypto'

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
  /** 40-hex git pin compatible with marketplace `source.ref`. */
  gitRef: string
  /** 64-hex content checksum. */
  checksum: string
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

function gitRef(id: string, version: string): string {
  return createHash('sha1').update(`${id}@${version}`).digest('hex')
}

function checksum(id: string, version: string): string {
  return createHash('sha256').update(`${id}@${version}`).digest('hex')
}

function tool(
  id: string,
  title: string,
  packId: CapabilityPackId,
  license: string,
  version: string,
  opts: {
    sourceRepo: string
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
    gitRef: gitRef(id, version),
    checksum: checksum(id, version),
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
  tool('codewiki', 'CodeWiki', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/codewiki',
    sizeHintKb: 420,
    expectedOutput: 'Wiki pages for the local repository.',
    whenToActivate: 'Repository exploration when the user needs a map of modules.',
    permission: 'none',
    unusualUse: 'Do not scrape private remotes without an explicit ask.',
  }),
  tool('deepwiki', 'DeepWiki', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/deepwiki',
    sizeHintKb: 380,
    expectedOutput: 'Deep wiki with call-graph notes.',
    whenToActivate: 'When CodeWiki is too shallow for the current question.',
    permission: 'none',
    unusualUse: 'Do not upload the tree to a hosted wiki.',
  }),
  tool('understand-anything', 'Understand Anything', 'code-intelligence', 'Apache-2.0', '0.1.0', {
    sourceRepo: 'example/understand-anything',
    sizeHintKb: 510,
    expectedOutput: 'Plain-language explanation of a symbol or file.',
    whenToActivate: 'User asks what a file or symbol does.',
    permission: 'none',
    unusualUse: 'Skip generated vendor trees.',
  }),
  tool('codegraph', 'CodeGraph', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/codegraph',
    sizeHintKb: 640,
    expectedOutput: 'Directed graph of modules and edges.',
    whenToActivate: 'Dependency or call-path questions.',
    permission: 'none',
    unusualUse: 'Do not index secrets or .env files.',
  }),
  tool('graphify', 'Graphify', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/graphify',
    sizeHintKb: 220,
    expectedOutput: 'Rendered graph from an existing CodeGraph dump.',
    whenToActivate: 'User wants a picture of an already-built graph.',
    permission: 'none',
    unusualUse: 'Do not re-crawl the repo if CodeGraph output exists.',
  }),
  tool('archify', 'Archify', 'code-intelligence', 'MIT', '0.1.0', {
    sourceRepo: 'example/archify',
    sizeHintKb: 300,
    expectedOutput: 'Architecture sketch with bounded contexts.',
    whenToActivate: 'Cross-package design questions.',
    permission: 'none',
    unusualUse: 'Do not invent services that are not in the tree.',
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
