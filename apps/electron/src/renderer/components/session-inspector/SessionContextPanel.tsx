import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { applyMcpLens } from '@craft-agent/session-tools-core'
import {
  assembleContextShares,
  sessionMessagesToTranscript,
  type ContextShareKind,
} from '@craft-agent/shared/agent'
import { featureWorkbenchHarnessAgentIntelV1Atom } from '@/atoms/unified-shell'
import { useOptionalAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'

const SHARE_I18N: Record<ContextShareKind, string> = {
  system: 'inspector.context.system',
  skills: 'inspector.context.skills',
  mcp: 'inspector.context.mcp',
  transcript: 'inspector.context.transcript',
  attachments: 'inspector.context.attachments',
}

export function SessionContextPanel({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation()
  const enabled = useAtomValue(featureWorkbenchHarnessAgentIntelV1Atom)
  const session = useSession(sessionId ?? '')
  const skills = useOptionalAppShellContext()?.skills ?? []

  const shares = useMemo(() => {
    if (!session) return assembleContextShares({
      systemPrompt: '',
      skillBodies: [],
      mcpToolSchemas: [],
      transcript: [],
      attachments: [],
    })
    const skillBodies = skills.map((skill) => skill.content || skill.slug)
    const mcpToolSchemas = (session.messages ?? [])
      .map((message) => message.toolName)
      .filter((name): name is string => Boolean(name?.startsWith('mcp__') && !name.startsWith('mcp__session__')))
    const attachments = (session.messages ?? []).flatMap((message) =>
      (message.attachments ?? []).map((attachment) => ({
        size: attachment.size,
        text: attachment.name,
      })),
    )
    return assembleContextShares({
      systemPrompt: '',
      skillBodies,
      mcpToolSchemas,
      transcript: sessionMessagesToTranscript(session.messages ?? []),
      attachments,
    })
  }, [session, skills])

  const lens = useMemo(() => {
    const names = (session?.messages ?? [])
      .map((message) => message.toolName)
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ name }))
    return applyMcpLens(names, true)
  }, [session])

  if (!enabled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="text-[13px] font-medium text-foreground/80">
          {t('inspector.empty.context.title')}
        </span>
        <span className="text-[12px] leading-relaxed text-muted-foreground/60">
          {t('inspector.empty.context.body')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3" data-testid="session-context-dashboard">
      <p className="text-[11px] text-muted-foreground/70">{t('inspector.context.readOnly')}</p>
      <ul className="flex flex-col gap-2">
        {shares.map((share) => (
          <li key={share.kind} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[12px]">
              <span>{t(SHARE_I18N[share.kind])}</span>
              <span className="tabular-nums text-muted-foreground">{share.percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/5">
              <div
                className={cn('h-full rounded-full bg-accent/70')}
                style={{ width: `${Math.min(100, share.percent)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground" data-testid="session-mcp-lens">
        {t('inspector.context.hiddenTools', { count: lens.hidden.length })}
      </p>
    </div>
  )
}
