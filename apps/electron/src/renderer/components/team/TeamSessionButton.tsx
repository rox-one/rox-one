/**
 * «Команда» — session header control (team.*.v1).
 * Assign, share with a role, hand off with a summary, request approval and
 * comment with @mentions. Only real org members are offered; actions are
 * stored locally and queued until an organization server exists.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  addComment,
  activeMentionQuery,
  assign,
  grantAccess,
  handoff,
  mentionHandle,
  requestApproval,
  selectForTarget,
  suggestMentions,
  type TeamAccessRole,
  type TeamTarget,
} from '@rox/shared/team'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { TEAM_FLAG, dispatchTeam, teamActionContext, useTeamFlag, useTeamState } from './team-store'
import { useTeamRoster } from './use-team-roster'
import { memberInitials, memberName, syncStatusText } from './team-labels'

const ROLES: TeamAccessRole[] = ['view', 'comment', 'run']

export interface TeamSessionButtonProps {
  sessionId: string
  sessionTitle?: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

function Chip({ active, disabled, onClick, children, label }: { active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-foreground text-background' : 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.12]',
      )}
    >
      {children}
    </button>
  )
}

export function TeamRevisionChip({
  revision,
  active,
  onClick,
  children,
}: {
  revision?: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return <Chip disabled={!revision} active={active} onClick={onClick}>{children}</Chip>
}

function Action({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="bg-foreground px-2.5 py-1 text-xs text-background hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

export function TeamSessionButton({ sessionId, sessionTitle }: TeamSessionButtonProps) {
  const { t } = useTranslation()
  const assignOn = useTeamFlag(TEAM_FLAG.assign)
  const sharingOn = useTeamFlag(TEAM_FLAG.sharing)
  const handoffOn = useTeamFlag(TEAM_FLAG.handoff)
  const commentsOn = useTeamFlag(TEAM_FLAG.comments)
  const mentionsOn = useTeamFlag(TEAM_FLAG.mentions)
  const approvalsOn = useTeamFlag(TEAM_FLAG.approvals)
  const anyOn = assignOn || sharingOn || handoffOn || commentsOn || approvalsOn

  const [open, setOpen] = React.useState(false)
  if (!anyOn) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PanelHeaderCenterButton
          aria-label={t('teamCollab.button')}
          tooltip={t('teamCollab.button')}
          icon={<Users className="h-4 w-4" />}
          data-testid="team-session-button"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] border-0 p-0 shadow-lg">
        {open ? (
          <TeamSessionPanel
            sessionId={sessionId}
            sessionTitle={sessionTitle}
            flags={{ assignOn, sharingOn, handoffOn, commentsOn, mentionsOn, approvalsOn }}
            onNavigateSettings={() => {
              setOpen(false)
              navigate(routes.view.settings('organizations'))
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

interface PanelFlags {
  assignOn: boolean
  sharingOn: boolean
  handoffOn: boolean
  commentsOn: boolean
  mentionsOn: boolean
  approvalsOn: boolean
}

export function TeamSessionPanel({
  sessionId,
  sessionTitle,
  flags,
  onNavigateSettings,
}: {
  sessionId: string
  sessionTitle?: string
  flags: PanelFlags
  onNavigateSettings: () => void
}) {
  const { t } = useTranslation()
  const roster = useTeamRoster()
  const state = useTeamState()
  const target: TeamTarget = React.useMemo(
    () => ({ kind: 'session', id: sessionId, ...(sessionTitle ? { title: sessionTitle } : {}) }),
    [sessionId, sessionTitle],
  )
  const forTarget = selectForTarget(state, 'session', sessionId)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'none' | 'handoff' | 'approval'>('none')
  const [draft, setDraft] = React.useState('')
  const [comment, setComment] = React.useState('')
  const [caret, setCaret] = React.useState(0)
  const selfId = roster.selfUserId

  const run = React.useCallback(
    (fn: Parameters<typeof dispatchTeam>[0]) => {
      if (!selfId) {
        toast.error(t('teamCollab.actionFailed'))
        return false
      }
      try {
        const persisted = dispatchTeam(fn)
        if (persisted) toast.info(t('teamCollab.sync.savedLocally'))
        else toast.error(t('teamCollab.actionFailed'))
        return persisted
      } catch (err) {
        toast.error(t('teamCollab.actionFailed'), { description: err instanceof Error ? err.message : String(err) })
        return false
      }
    },
    [selfId, t],
  )

  const ctx = () => teamActionContext(selfId ?? '')
  const selectedMember = roster.teammates.find((m) => m.userId === selected) ?? null
  const grantFor = (uid: string) => forTarget.access.find((g) => g.userId === uid)?.role
  const mentionQuery = flags.mentionsOn ? activeMentionQuery(comment, caret) : null
  const suggestions = mentionQuery !== null ? suggestMentions(mentionQuery, roster.teammates, 5) : []

  const insertMention = (handle: string) => {
    const before = comment.slice(0, caret).replace(/@[\p{L}\p{N}._-]*$/u, `@${handle} `)
    const next = before + comment.slice(caret)
    setComment(next)
    setCaret(before.length)
  }

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto bg-background p-4 text-sm" data-testid="team-session-panel">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-base font-semibold">{t('teamCollab.title')}</div>
        {roster.org ? <div className="truncate text-xs text-muted-foreground">{roster.org.name}</div> : null}
      </div>
      {(flags.commentsOn || flags.handoffOn || flags.approvalsOn) && !target.revision ? (
        <div role="status" className="bg-foreground/[0.04] px-2.5 py-2 text-xs text-muted-foreground">
          {t('teamCollab.revisionUnavailable')}
        </div>
      ) : null}

      {roster.loading ? (
        <div className="text-muted-foreground">{t('teamCollab.loading')}</div>
      ) : !roster.org ? (
        <div className="flex flex-col gap-2 bg-foreground/[0.04] p-3">
          <div>{t('teamCollab.empty.noOrg')}</div>
          <div><Action onClick={onNavigateSettings}>{t('teamCollab.empty.openOrgs')}</Action></div>
        </div>
      ) : (
        <>
          <Section title={t('teamCollab.members')}>
            {roster.teammates.length === 0 ? (
              <div className="flex flex-col gap-2 bg-foreground/[0.04] p-3">
                <div>{roster.pendingInvites > 0 ? t('teamCollab.empty.onlyYouPending', { count: roster.pendingInvites }) : t('teamCollab.empty.onlyYou')}</div>
                <div><Action onClick={onNavigateSettings}>{t('teamCollab.empty.invite')}</Action></div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5" role="listbox" aria-label={t('teamCollab.members')}>
                {roster.teammates.map((m) => (
                  <Chip key={m.userId} active={selected === m.userId} onClick={() => setSelected(selected === m.userId ? null : m.userId)}>
                    <span className="mr-1 font-semibold">{memberInitials(m.displayName)}</span>
                    {m.displayName}
                    {forTarget.assignment?.assigneeUserId === m.userId ? ` · ${t('teamCollab.assigned')}` : ''}
                  </Chip>
                ))}
              </div>
            )}
          </Section>

          {selectedMember ? (
            <div className="flex flex-col gap-3 bg-foreground/[0.04] p-3">
              {flags.assignOn ? (
                <div className="flex items-center justify-between gap-2">
                  <span>{t('teamCollab.assignTo', { name: selectedMember.displayName })}</span>
                  <Action
                    disabled={forTarget.assignment?.assigneeUserId === selectedMember.userId}
                    onClick={() => run((s) => assign(s, ctx(), { target, assigneeUserId: selectedMember.userId, roster: roster.members }))}
                  >
                    {t('teamCollab.assign')}
                  </Action>
                </div>
              ) : null}
              {flags.sharingOn ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t('teamCollab.access')}</span>
                  <div className="flex gap-1.5">
                    {ROLES.map((role) => (
                      <Chip
                        key={role}
                        disabled={roster.sync.state !== 'connected'}
                        active={roster.sync.state === 'connected' && grantFor(selectedMember.userId) === role}
                        onClick={() => run((s) => grantAccess(s, ctx(), { target, userId: selectedMember.userId, role, roster: roster.members }))}
                      >
                        {t(`teamCollab.role.${role}`)}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex gap-1.5">
                {flags.handoffOn ? (
                  <TeamRevisionChip revision={target.revision} active={mode === 'handoff'} onClick={() => { setMode(mode === 'handoff' ? 'none' : 'handoff'); setDraft(mode === 'handoff' ? '' : t('teamCollab.handoffDraft', { title: sessionTitle || t('teamCollab.target.session') })) }}>
                    {t('teamCollab.handoff')}
                  </TeamRevisionChip>
                ) : null}
                {flags.approvalsOn ? (
                  <TeamRevisionChip revision={target.revision} active={mode === 'approval'} onClick={() => { setMode(mode === 'approval' ? 'none' : 'approval'); setDraft('') }}>
                    {t('teamCollab.requestApproval')}
                  </TeamRevisionChip>
                ) : null}
              </div>
              {mode !== 'none' ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    aria-label={mode === 'handoff' ? t('teamCollab.handoffSummary') : t('teamCollab.approvalNote')}
                    placeholder={mode === 'handoff' ? t('teamCollab.handoffSummary') : t('teamCollab.approvalNote')}
                    className="w-full resize-none bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div>
                    <Action
                      disabled={mode === 'handoff' && !draft.trim()}
                      onClick={() => {
                        const persisted = mode === 'handoff'
                          ? run((s) => handoff(s, ctx(), { target, toUserId: selectedMember.userId, summary: draft, roster: roster.members }))
                          : run((s) => requestApproval(s, ctx(), { target, reviewerUserId: selectedMember.userId, note: draft, roster: roster.members }))
                        if (!persisted) return
                        setMode('none')
                        setDraft('')
                      }}
                    >
                      {mode === 'handoff' ? t('teamCollab.handoffSend') : t('teamCollab.approvalSend')}
                    </Action>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {flags.commentsOn ? (
            <Section title={t('teamCollab.comments', { count: forTarget.comments.length })}>
              {forTarget.comments.length === 0 ? <div className="text-xs text-muted-foreground">{t('teamCollab.noComments')}</div> : null}
              {forTarget.comments.slice(-8).map((c) => (
                <div key={c.id} className="bg-foreground/[0.04] px-2.5 py-2">
                  <div className="text-xs text-muted-foreground">
                    {memberName(roster.members, c.authorUserId, selfId, t)} · {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{c.body}</div>
                </div>
              ))}
              <div className="relative">
                <textarea
                  value={comment}
                  onChange={(e) => { setComment(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
                  onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                  rows={2}
                  aria-label={t('teamCollab.commentPlaceholder')}
                  placeholder={flags.mentionsOn ? t('teamCollab.commentPlaceholderMentions') : t('teamCollab.commentPlaceholder')}
                  className="w-full resize-none bg-foreground/[0.04] p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {suggestions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-full z-10 flex flex-col bg-background shadow-md" role="listbox" aria-label={t('teamCollab.mentionSuggestions')}>
                    {suggestions.map((m) => (
                      <button key={m.userId} type="button" role="option" aria-selected={false} onClick={() => insertMention(mentionHandle(m))} className="px-2 py-1 text-left text-sm hover:bg-foreground/[0.08]">
                        @{mentionHandle(m)} <span className="text-muted-foreground">{m.displayName}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <Action
                  disabled={!target.revision || !comment.trim()}
                  onClick={() => {
                    if (run((s) => addComment(s, ctx(), { target, body: comment, roster: flags.mentionsOn ? roster.members : [] }))) setComment('')
                  }}
                >
                  {t('teamCollab.commentSend')}
                </Action>
              </div>
            </Section>
          ) : null}
        </>
      )}

      <div className="bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] px-2.5 py-2 text-xs" role="status" data-testid="team-sync-status">
        {syncStatusText(roster.sync, state.outbox.length, t)}
      </div>
    </div>
  )
}
