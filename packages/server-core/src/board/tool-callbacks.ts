/**
 * Board widget tool callbacks (wave 3, row b2.3).
 *
 * Backend implementation of the agent-facing `show_widget` tool. SessionManager
 * wires one instance per session, bound to the invoking session's workspace, into
 * the session-scoped tool callback registry.
 *
 * Storage flows are the SAME primitives the board RPC handlers use:
 * `WidgetStore.put` for the bytes and `widgetTicketRegistryFor(...).rotate` for
 * the render-ticket generation, so the tool is never a second writer and a
 * re-put through either path invalidates tickets symmetrically.
 */

import type {
  BoardWidgetPutInput,
  BoardWidgetToolCallbacks,
  BoardWidgetToolRecord,
} from '@rox/session-tools-core'
import { WidgetStore } from './widget-store.ts'
import { widgetTicketRegistryFor } from './widget-tickets.ts'

export interface BoardWidgetToolCallbacksDeps {
  workspaceId: string
  workspaceRootPath: string
  /** Identity that authored the revision (session owner or operator). Never client-supplied. */
  createdBy: string
  /** Session that authored the revision, when the writer is a session. */
  sessionId?: string
  log?: (message: string) => void
  /** Called after every accepted put so the host can broadcast `board:changed`. */
  onWidgetMutated?: (record: BoardWidgetToolRecord) => void | Promise<void>
}

export function buildBoardWidgetToolCallbacks(deps: BoardWidgetToolCallbacksDeps): BoardWidgetToolCallbacks {
  const store = new WidgetStore(deps.workspaceRootPath, deps.workspaceId)
  return {
    async putWidget(input: BoardWidgetPutInput): Promise<BoardWidgetToolRecord> {
      const record = store.put({
        name: input.name,
        title: input.title,
        kind: input.kind,
        widgetCode: input.widgetCode,
        sessionId: input.sessionId ?? deps.sessionId,
        createdBy: deps.createdBy,
      })
      widgetTicketRegistryFor(deps.workspaceRootPath).rotate(record.widgetId)
      deps.log?.(`board widget: staged ${record.name} revision ${record.revision} in workspace ${deps.workspaceId}`)
      const toolRecord: BoardWidgetToolRecord = {
        widgetId: record.widgetId,
        name: record.name,
        kind: record.kind,
        revision: record.revision,
        sha256: record.sha256,
        createdAt: record.createdAt,
      }
      await deps.onWidgetMutated?.(toolRecord)
      return toolRecord
    },
  }
}