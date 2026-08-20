import { extractSessionVariables, type SessionScene } from '@craft-agent/core/mindmap'
import type { PlaybookHole } from './fan-out-jobs'

export function holesFromScene(scene: SessionScene): PlaybookHole[] {
  const vars = extractSessionVariables([
    { id: scene.triggerMessageId, content: `${scene.triggerPreview}\n${scene.outcomePreview}` },
  ])
  return vars.map((v) => ({
    id: v.name,
    title: v.name,
    prompt: v.value ? `${v.name}=${v.value}` : `{{${v.name}}}`,
  }))
}
