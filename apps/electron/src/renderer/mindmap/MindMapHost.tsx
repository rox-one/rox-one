/**
 * TEMP: MindMapHost body corrupted during MCP @file probe.
 * Full restore payload: .factory/MindMapHost.tsx.z9.b64 (zlib+b64, motion-safe:animate-pulse).
 * Run /tmp/restore-mindmap-host.py with /tmp/gh-token, or CallMcpTool create_or_update_file
 * with content from /tmp/rox-mcp-args/create-mm.json (sha 311c8dd0…).
 */
import type { MindMapEntityRef, MindMapGraph, MindMapNodeId } from '@craft-agent/core/mindmap'

export interface MindMapHostProps {
  entity: MindMapEntityRef
  graph: MindMapGraph | null
  loading?: boolean
  error?: string | null
  mode?: 'map' | 'outline'
  camera?: 'map' | 'flow'
  selectedId?: MindMapNodeId | null
  onSelect?: (id: MindMapNodeId | null) => void
  onNavigate?: (source: { kind: string; id: string }) => void
  workspaceId?: string
  workspaceRoot?: string
  sourceExcerpt?: string
  onAcceptDraft?: (graph: MindMapGraph) => void
  onGraphOverride?: (graph: MindMapGraph) => void
  className?: string
}

/** Stub until full file is restored from .factory/MindMapHost.tsx.z9.b64 */
export function MindMapHost(_props: MindMapHostProps) {
  return (
    <div className="flex-1 grid place-items-center p-6 text-sm text-muted-foreground" data-testid="mindmap-host-restore-stub">
      MindMapHost restore pending — see .factory/MindMapHost.tsx.z9.b64
    </div>
  )
}
