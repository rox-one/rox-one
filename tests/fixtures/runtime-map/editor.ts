/** Old persisted editor documents; serializers are the existing production owners. */
import { serializeSessionMapPin, sessionMapPinStorageKey } from '../../../packages/core/src/mindmap'
import { serializeSessionDraftGraph, sessionDraftNodesStorageKey, type SessionDraftGraph } from '../../../apps/electron/src/renderer/components/session-workbench/draft-nodes'
import { draftGraphToSpec } from '../../../apps/electron/src/renderer/components/session-workbench/workflow-document'
import { createWorkflowDocument, saveVersion, serializeWorkflowDocument, workflowDocumentStorageKey } from '../../../packages/shared/src/workflows'
import type { Message } from '../../../packages/core/src/types'

export const editorMessages: Message[] = [
  { id: 'editor-user', role: 'user', content: 'Сохранённая сцена редактора', timestamp: 1 },
  { id: 'editor-assistant', role: 'assistant', content: 'Сохранённый ответ редактора', timestamp: 2, turnId: 'editor-turn' },
]
export function seedEditorFixture(sessionId: string) {
  const keys = { pin: sessionMapPinStorageKey(sessionId), draft: sessionDraftNodesStorageKey(sessionId), workflow: workflowDocumentStorageKey(sessionId) }
  if (!localStorage.getItem(keys.pin)) localStorage.setItem(keys.pin, serializeSessionMapPin({ v: 1, sessionId, camera: 'map', viewport: { x: 20, y: 20, zoom: .6 }, nodes: { 'scn_editor-user': { x: 20, y: 20, width: 340, height: 210 } } }))
  if (!localStorage.getItem(keys.draft)) {
    const graph: SessionDraftGraph = { v: 1, sessionId, nodes: [
      { id: 'decision', kind: 'condition', title: 'Retained decision', position: { x: 320, y: 160 }, anchorSceneId: 'scn_editor-user', createdAt: 1 },
      { id: 'note-true', kind: 'note', title: 'Retained true branch', position: { x: 560, y: 160 }, anchorSceneId: null, createdAt: 1 },
      { id: 'note-false', kind: 'note', title: 'Retained false branch', position: { x: 560, y: 360 }, anchorSceneId: null, createdAt: 1 },
    ], edges: [
      { id: 'retained-true', source: 'decision', target: 'note-true', sourceHandle: 'decision:true', createdAt: 1 },
      { id: 'retained-false', source: 'decision', target: 'note-false', sourceHandle: 'decision:false', createdAt: 1 },
    ] }
    localStorage.setItem(keys.draft, serializeSessionDraftGraph(sessionId, graph))
    const document = saveVersion({ ...createWorkflowDocument(sessionId, 1), draft: draftGraphToSpec(graph, 2) }, 3)
    localStorage.setItem(keys.workflow, serializeWorkflowDocument(document))
  }
  return keys
}
