import { useMemo, useState } from 'react'
import {
  agentReadinessViews,
  emptyMeetingAgentStore,
  emptyRecipeLedger,
  ensureBuiltinMeetingAgents,
  invokeMeetingSlash,
  parseMeetingSlash,
  proposeClientAnalysis,
  resetRecipe,
  type MeetingProfileId,
} from '@craft-agent/shared/meeting-agents'
import type { AgentReadinessProps } from './AgentReadiness'

/** Local renderer projection of recipe/readiness. Not a canonical store. */
export function useLocalMeetingReadiness(meetingId: string): AgentReadinessProps {
  const agents = useMemo(() => {
    const { store } = ensureBuiltinMeetingAgents('local', '1.0.0', emptyMeetingAgentStore())
    return agentReadinessViews('local', store)
  }, [])
  const [recipeId, setRecipeId] = useState<MeetingProfileId>('standup')
  const [ledger, setLedger] = useState(emptyRecipeLedger)
  const [skillError, setSkillError] = useState<AgentReadinessProps['skillError']>(null)

  return {
    agents,
    selectedRecipeId: recipeId,
    skillError,
    onSelectRecipe: (id) => {
      setRecipeId(id)
      setSkillError(null)
    },
    onReset: () => {
      setLedger((current) => resetRecipe(current, recipeId))
      setSkillError(null)
    },
    onRunSkill: (text) => {
      const parsed = parseMeetingSlash(text)
      const wantsCrm = recipeId === 'client' || parsed?.token === 'client' || parsed?.token === 'meeting.crm'
      if (wantsCrm) {
        const crm = proposeClientAnalysis({ hasCrmCapability: false, notes: [] })
        if (!crm.ok) {
          setSkillError('no-crm')
          return
        }
      }
      const result = invokeMeetingSlash(text, {
        meetingId,
        workspaceId: 'local',
        sourceSnapshot: { revision: 1, finalizedWatermark: 1 },
        recipeId,
        ledger,
      })
      if (!result.ok && result.code !== 'not-slash') {
        setSkillError(
          result.code === 'skill-not-permitted' || result.code === 'recipe-disabled'
            ? result.code
            : 'unknown-skill',
        )
        return
      }
      setSkillError(null)
    },
  }
}
