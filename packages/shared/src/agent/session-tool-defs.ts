/**
 * Shared Session + Source Proxy Tool Definition Builder
 *
 * Single code path that composes the tool definition list every RPC backend
 * (Pi, OMP) advertises for craft-executed tools:
 *
 *   1. Session-tools registry defs (getSessionToolProxyDefs — spawn_session,
 *      call_llm, browser_tool, mcp__session__* tools).
 *   2. Optional MCP source-proxy defs from the McpClientPool
 *      (mcp__{slug}__{tool}), for backends that register everything in one
 *      frame (OMP set_host_tools). Pi registers pool defs in a separate
 *      register_tools message — it passes `includePoolProxyDefs: false`.
 *
 * Applies the two parity gates the backends used to duplicate inline:
 *   - browser_tool hidden when the user disabled the built-in browser tool
 *   - call_llm description patched with the session's mini model hint
 *
 * The result is deduplicated by name, first occurrence wins (session tools
 * take precedence over pool proxies on collision).
 */

import { getSessionToolProxyDefs } from './backend/pi/session-tool-defs.ts';
import { getBrowserToolEnabled } from '../config/storage.ts';
import type { McpClientPool } from '../mcp/mcp-pool.ts';
import { applyMcpLens } from '@craft-agent/session-tools-core';

/** Minimal structural shape every backend registration frame accepts. */
export interface SessionToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SessionToolDefBuildOptions {
  /** Pool to draw MCP source-proxy defs from. */
  mcpPool?: McpClientPool;
  /**
   * Include pool proxy defs in the returned list (OMP single-frame
   * registration). Default false — Pi keeps its separate register_tools
   * frame for pool tools and must pass false here.
   */
  includePoolProxyDefs?: boolean;
  /**
   * Session mini/fast model — patches the call_llm description with a
   * model hint (mirrors prior inline behavior of PiAgent/OmpAgent).
   */
  miniModel?: string;
  /**
   * Also advertise unprefixed `bash` (same schema as mcp__session__bash).
   * OMP's built-in bash is shadowed by craft-side host-tool execution.
   * Pi must leave this false — it already registers SDK bash.
   */
  includeHostBashAlias?: boolean;
  /**
   * MCP lens: omit non-essential source-proxy tools from the advertised set.
   * Default false so OMP keeps every host tool `essential` (v1 bridge).
   */
  mcpLens?: boolean;
  /**
   * Advertise meeting-agent host tools (issue #363). Default false so Pi/OMP
   * session frames stay unchanged. Meeting dispatch is the only caller that
   * opts in — this file remains the single tool catalog owner.
   */
  includeMeetingAgentTools?: boolean;
}

const MEETING_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    meetingId: { type: 'string' },
    snapshotRevision: { type: 'number' },
    finalizedWatermark: { type: 'number' },
  },
  additionalProperties: false,
};

const MEETING_ARTIFACT_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    meetingId: { type: 'string' },
    snapshotRevision: { type: 'number' },
    finalizedWatermark: { type: 'number' },
    format: { type: 'string' },
    relativePath: { type: 'string' },
    expectedRevision: { type: 'string' },
    repo: { type: 'string' },
    branch: { type: 'string' },
  },
  additionalProperties: false,
};

/** Host tools for builtin meeting roles. Names match catalog skillIds. */
export const MEETING_AGENT_TOOL_DEFS: readonly SessionToolDef[] = [
  { name: 'meeting.brief', description: 'Prepare a meeting brief from the current snapshot.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.coverage', description: 'Check assignment coverage for the current meeting.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.assist', description: 'Answer an explicit in-meeting question with citations.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.screen-explain', description: 'Explain the selected screen frame when screen capture is granted.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.transcript', description: 'Transcribe finalized meeting audio into timestamped segments.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.notes', description: 'Extract notes, decisions, and commitments with evidence spans.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.knowledge-diff', description: 'Propose a knowledge diff against the current base revision.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.execute', description: 'Execute an already-approved meeting operation payload.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author', description: 'Draft a versioned meeting artifact without publishing it.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.code', description: 'Open a coding handoff that may create a draft PR in an approved repo/branch.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.csv', description: 'Write a parseable CSV artifact and verify it on readback.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.docx', description: 'Write an openable DOCX artifact and verify it on readback.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.markdown', description: 'Write a markdown artifact and verify it on readback.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.pdf', description: 'Write an openable PDF artifact and verify it on readback.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.pptx', description: 'Write an openable PPTX artifact and verify it on readback.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.research', description: 'Write a research note from allowed sources without gaining new rights.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.author.xlsx', description: 'Write an openable XLSX artifact and verify it on readback.', inputSchema: MEETING_ARTIFACT_TOOL_INPUT_SCHEMA },
  { name: 'meeting.followup', description: 'Prepare follow-up reminders from meeting promises.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.risks', description: 'Surface measurable risks and blockers from the meeting snapshot.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
  { name: 'meeting.crm', description: 'Suggest CRM updates without inventing contact identity.', inputSchema: MEETING_TOOL_INPUT_SCHEMA },
];

export const MEETING_AGENT_TOOL_NAMES = new Set(MEETING_AGENT_TOOL_DEFS.map((d) => d.name));

export function hostToolsForMeetingSkills(skillIds: readonly string[]): SessionToolDef[] {
  const allowed = new Set(skillIds);
  return MEETING_AGENT_TOOL_DEFS.filter((d) => allowed.has(d.name)).map((d) => ({ ...d }));
}

export function isKnownSessionToolName(name: string): boolean {
  return buildSessionToolDefs({ includeMeetingAgentTools: true }).some((d) => d.name === name);
}

export function buildSessionToolDefs(options: SessionToolDefBuildOptions = {}): SessionToolDef[] {
  let defs: SessionToolDef[] = getSessionToolProxyDefs();

  // Same gate as the backends: hide browser_tool when the user disabled the
  // built-in browser tool.
  if (!getBrowserToolEnabled()) {
    defs = defs.filter((d) => d.name !== 'mcp__session__browser_tool');
  }

  // Same patch as the backends: hint the mini model for call_llm.
  if (options.miniModel) {
    const callLlmDef = defs.find((d) => d.name === 'mcp__session__call_llm');
    if (callLlmDef) {
      callLlmDef.description += `\n\nDefault fast model for this session: ${options.miniModel}. Omit the model parameter to use it automatically.`;
    }
  }

  // Dedupe by name (first wins — session tools beat pool proxies).
  const seen = new Set<string>();
  const unique: SessionToolDef[] = [];
  for (const def of defs) {
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    unique.push(def);
  }

  if (options.includePoolProxyDefs && options.mcpPool) {
    for (const poolDef of options.mcpPool.getProxyToolDefs()) {
      if (seen.has(poolDef.name)) continue;
      seen.add(poolDef.name);
      unique.push(poolDef as SessionToolDef);
    }
  }

  if (options.includeHostBashAlias) {
    const prefixed = unique.find((d) => d.name === 'mcp__session__bash');
    if (prefixed && !seen.has('bash')) {
      unique.push({ ...prefixed, name: 'bash' });
    }
  }

  if (options.includeMeetingAgentTools) {
    for (const meetingDef of MEETING_AGENT_TOOL_DEFS) {
      if (seen.has(meetingDef.name)) continue;
      seen.add(meetingDef.name);
      unique.push({ ...meetingDef });
    }
  }

  if (options.mcpLens) {
    return applyMcpLens(unique, true).visible
  }

  return unique;
}
