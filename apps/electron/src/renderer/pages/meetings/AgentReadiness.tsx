import { useTranslation } from 'react-i18next'
import {
  MEETING_PROFILE_IDS,
  type MeetingProfileId,
} from '@craft-agent/shared/meeting-agents'

const RECIPE_LABEL: Record<MeetingProfileId, string> = {
  standup: 'meetings.recipeStandup',
  discovery: 'meetings.recipeDiscovery',
  'design-review': 'meetings.recipeDesignReview',
  client: 'meetings.recipeClient',
  'project-review': 'meetings.recipeProjectReview',
}

export type AgentReadinessView = {
  id: string
  installed: boolean
  enabled: boolean
  authorized: boolean
  healthy: boolean
  running: boolean
  blocker: 'not-installed' | 'disabled' | 'unauthorized' | 'unhealthy' | 'not-running' | null
}

export type AgentReadinessProps = {
  agents: readonly AgentReadinessView[]
  selectedRecipeId?: MeetingProfileId
  skillDraft?: string
  skillError?: 'unknown-skill' | 'skill-not-permitted' | 'recipe-disabled' | 'no-crm' | null
  onSelectRecipe?: (id: MeetingProfileId) => void
  onRunSkill?: (text: string) => void
  onReset?: () => void
}

export function AgentReadiness({
  agents,
  selectedRecipeId = 'standup',
  skillDraft = '',
  skillError,
  onSelectRecipe,
  onRunSkill,
  onReset,
}: AgentReadinessProps) {
  const { t } = useTranslation()
  const selected = agents[0]

  return (
    <section className="space-y-2 rounded-lg border border-border p-3" data-testid="meeting-agent-readiness">
      <h3 className="text-sm font-medium">{t('meetings.agentReadiness')}</h3>
      {selected ? (
        <dl className="grid grid-cols-2 gap-1 text-xs">
          <dt>{t('meetings.agentInstalled')}</dt>
          <dd data-testid="meeting-agent-installed">{String(selected.installed)}</dd>
          <dt>{t('meetings.agentEnabled')}</dt>
          <dd data-testid="meeting-agent-enabled">{String(selected.enabled)}</dd>
          <dt>{t('meetings.agentAuthorized')}</dt>
          <dd data-testid="meeting-agent-authorized">{String(selected.authorized)}</dd>
          <dt>{t('meetings.agentHealthy')}</dt>
          <dd data-testid="meeting-agent-healthy">{String(selected.healthy)}</dd>
          <dt>{t('meetings.agentRunning')}</dt>
          <dd data-testid="meeting-agent-running">{String(selected.running)}</dd>
        </dl>
      ) : null}
      <ul className="space-y-1 text-xs">
        {agents.map((agent) => (
          <li key={agent.id} data-testid="meeting-agent-row" data-agent-id={agent.id}>
            {agent.id}
          </li>
        ))}
      </ul>
      {selected?.blocker === 'not-installed' ? (
        <p className="text-xs" data-testid="meeting-agent-blocker">{t('meetings.agentBlockerNotInstalled')}</p>
      ) : selected?.blocker === 'disabled' ? (
        <p className="text-xs" data-testid="meeting-agent-blocker">{t('meetings.agentBlockerDisabled')}</p>
      ) : selected?.blocker === 'unauthorized' ? (
        <p className="text-xs" data-testid="meeting-agent-blocker">{t('meetings.agentBlockerUnauthorized')}</p>
      ) : selected?.blocker === 'unhealthy' ? (
        <p className="text-xs" data-testid="meeting-agent-blocker">{t('meetings.agentBlockerUnhealthy')}</p>
      ) : null}
      <label className="block text-xs">
        <span className="sr-only">{t('meetings.recipeStandup')}</span>
        <select
          data-testid="meeting-recipe-profile"
          className="w-full rounded-md border border-border bg-background px-2 py-1"
          value={selectedRecipeId}
          onChange={(event) => onSelectRecipe?.(event.target.value as MeetingProfileId)}
        >
          {MEETING_PROFILE_IDS.map((id) => (
            <option key={id} value={id}>{t(RECIPE_LABEL[id])}</option>
          ))}
        </select>
      </label>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const field = form.elements.namedItem('skill') as HTMLInputElement | null
          onRunSkill?.(field?.value ?? skillDraft)
        }}
      >
        <input
          name="skill"
          data-testid="meeting-skill-slash"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          defaultValue={skillDraft}
          aria-label={t('meetings.skillUnknown')}
        />
        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
          {t('meetings.start')}
        </button>
        <button
          type="button"
          data-testid="meeting-recipe-reset"
          className="rounded-md border border-border px-2 py-1 text-xs"
          onClick={onReset}
        >
          {t('meetings.resetRecipe')}
        </button>
      </form>
      {skillError === 'unknown-skill' ? (
        <p className="text-xs" data-testid="meeting-skill-unknown">{t('meetings.skillUnknown')}</p>
      ) : null}
      {skillError === 'no-crm' ? (
        <p className="text-xs" data-testid="meeting-crm-unavailable">{t('meetings.crm.blocked')}</p>
      ) : null}
    </section>
  )
}

export default AgentReadiness
