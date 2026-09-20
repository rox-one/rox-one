import { useMemo, useState } from 'react'
import {
  clientCrmProposal,
  ensureBuiltinMeetingAgents,
  invokeSkill,
  recipeById,
  readinessBlocker,
  SYSTEM_RECIPES,
  type MeetingProfileId,
  type RecipeOverride,
} from '@craft-agent/shared/meeting-agents'
import type { AgentReadinessProps, AgentReadinessView } from './AgentReadiness'

const INSTALLED_SKILLS = SYSTEM_RECIPES.map((recipe) => recipe.skillId)

function parseMeetingSlash(text: string): { token: string; rest: string } | null {
  const match = text.trim().match(/^\/([A-Za-z0-9._-]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { token: match[1], rest: match[2] ?? '' }
}

function viewsFromStore(): AgentReadinessView[] {
  const store = ensureBuiltinMeetingAgents('local')
  return Object.values(store.records).map((record) => {
    const flags = {
      installed: record.installed,
      enabled: record.enabled,
      authorized: record.authorized,
      healthy: record.healthy === 'healthy',
      running: record.running,
    }
    return {
      id: record.id,
      ...flags,
      blocker: readinessBlocker(flags),
    }
  })
}

/** Local renderer projection of recipe/readiness. Not a canonical store. */
export function useLocalMeetingReadiness(meetingId: string): AgentReadinessProps {
  void meetingId
  const agents = useMemo(() => viewsFromStore(), [])
  const [recipeId, setRecipeId] = useState<MeetingProfileId>('standup')
  const [overrides, setOverrides] = useState<Partial<Record<MeetingProfileId, RecipeOverride>>>({})
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
      setOverrides((current) => {
        const next = { ...current }
        delete next[recipeId]
        return next
      })
      setSkillError(null)
    },
    onRunSkill: (text) => {
      const parsed = parseMeetingSlash(text)
      const wantsCrm = recipeId === 'client' || parsed?.token === 'client' || parsed?.token === 'meeting.crm'
      const hasCrmCapability = false
      if (wantsCrm) {
        const crm = clientCrmProposal(hasCrmCapability)
        if (crm.kind === 'blocked') {
          setSkillError('no-crm')
          return
        }
      }
      if (!parsed) {
        setSkillError(null)
        return
      }
      if (overrides[recipeId]?.disabled || (recipeById(parsed.token) && overrides[parsed.token as MeetingProfileId]?.disabled)) {
        setSkillError('recipe-disabled')
        return
      }
      const recipeFromToken = recipeById(parsed.token)
      const skillId = recipeFromToken?.skillId ?? parsed.token
      const selected = recipeById(recipeId)
      if (selected && skillId !== selected.skillId && !recipeFromToken) {
        setSkillError('skill-not-permitted')
        return
      }
      const result = invokeSkill(skillId, INSTALLED_SKILLS)
      if (!result.ok) {
        setSkillError('unknown-skill')
        return
      }
      setSkillError(null)
    },
  }
}
