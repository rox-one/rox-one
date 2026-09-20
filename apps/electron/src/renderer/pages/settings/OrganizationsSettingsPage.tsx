/**
 * OrganizationsSettingsPage (P3.1)
 *
 * Create orgs, invite by email/username, list members + pending invites.
 * Local-first; invite redemption prefers Rox Server URL (env CRAFT_SERVER_URL)
 * when present. Invite RPC creates a local token — there is no mailer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { toast } from 'sonner'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
} from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  OrganizationWithMembers,
  OrgInvitePublic,
  OrgMember,
  OrgRole,
} from '@craft-agent/shared/orgs'
import type { Workspace } from '../../../shared/types'
import { getTeamSpacesForOrganization } from './organization-team-spaces'
import { formatOrgMemberIdentity } from './organization-member-identity'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'organizations',
}


function roleLabel(role: OrgRole, t: (k: string) => string): string {
  if (role === 'owner') return t('settings.orgs.roleOwner')
  if (role === 'admin') return t('settings.orgs.roleAdmin')
  return t('settings.orgs.roleMember')
}

export default function OrganizationsSettingsPage() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [orgs, setOrgs] = useState<OrganizationWithMembers[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)

  const [newOrgName, setNewOrgName] = useState('')
  const [creating, setCreating] = useState(false)

  const [inviteTarget, setInviteTarget] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviting, setInviting] = useState(false)

  const [acceptToken, setAcceptToken] = useState('')
  const [accepting, setAccepting] = useState(false)

  const [usernameDraft, setUsernameDraft] = useState('')
  const [emailDraft, setEmailDraft] = useState('')
  const [savingIdentity, setSavingIdentity] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, identity, availableWorkspaces] = await Promise.all([
        window.electronAPI.listOrganizations(),
        window.electronAPI.getOrgIdentity(),
        window.electronAPI.getWorkspaces(),
      ])
      setOrgs(list)
      setWorkspaces(availableWorkspaces)
      setUsernameDraft(identity.username ?? '')
      setEmailDraft(identity.email ?? '')
      setSelectedOrgId((previous) => {
        if (previous && list.some((organization) => organization.id === previous)) {
          return previous
        }
        return list[0]?.id ?? null
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('settings.orgs.loadFailed'), { description: message })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selected = orgs.find((organization) => organization.id === selectedOrgId) ?? null
  const teamSpaces = useMemo(
    () => getTeamSpacesForOrganization(workspaces, selected?.id ?? null),
    [selected?.id, workspaces],
  )

  const handleCreate = useCallback(async () => {
    const name = newOrgName.trim()
    if (!name || creating) return

    setCreating(true)
    try {
      const gate = settingsPageActionResult({
        pageId: 'organizations',
        action: 'pref-write',
        source: 'native',
      })
      if (!isClaimableLive(gate)) return
      const organization = await window.electronAPI.createOrganization({ name })
      setNewOrgName('')
      setOrgs((current) => [...current, organization])
      setSelectedOrgId(organization.id)
      toast.success(t('settings.orgs.created', { name: organization.name }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('settings.orgs.createFailed'), { description: message })
    } finally {
      setCreating(false)
    }
  }, [creating, newOrgName, t])

  const handleInvite = useCallback(async () => {
    if (!selected || !inviteTarget.trim() || inviting) return

    setInviting(true)
    try {
      const gate = settingsPageActionResult({
        pageId: 'organizations',
        action: 'org-invite',
        source: 'native',
        granted: true,
      })
      if (!isClaimableLive(gate)) return
      const invite = await window.electronAPI.inviteToOrganization({
        orgId: selected.id,
        emailOrUsername: inviteTarget.trim(),
        role: inviteRole,
      })
      setInviteTarget('')
      const { token, ...publicInvite } = invite
      let copied = false
      try {
        await navigator.clipboard.writeText(token)
        copied = true
      } catch {
        toast.error(t('toast.copyFailed'))
      }
      setOrgs((current) =>
        current.map((organization) =>
          organization.id === selected.id
            ? {
                ...organization,
                pendingInvites: [
                  ...organization.pendingInvites.filter((candidate) => candidate.id !== invite.id),
                  publicInvite,
                ],
              }
            : organization,
        ),
      )
      toast.success(t('settings.orgs.inviteSent', { target: invite.emailOrUsername }), {
        description: copied ? t('toast.inviteCopied') : t('settings.orgs.inviteNoMailer'),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('settings.orgs.inviteFailed'), { description: message })
    } finally {
      setInviting(false)
    }
  }, [inviting, inviteRole, inviteTarget, selected, t])

  const handleAccept = useCallback(async () => {
    const token = acceptToken.trim()
    if (!token || accepting) return

    setAccepting(true)
    try {
      const gate = settingsPageActionResult({
        pageId: 'organizations',
        action: 'org-invite',
        source: 'native',
        granted: true,
      })
      if (!isClaimableLive(gate)) return
      const result = await window.electronAPI.acceptOrganizationInvite({ token })
      setAcceptToken('')
      await refresh()
      setSelectedOrgId(result.org.id)
      toast.success(t('settings.orgs.inviteAccepted', { name: result.org.name }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('settings.orgs.acceptFailed'), { description: message })
    } finally {
      setAccepting(false)
    }
  }, [acceptToken, accepting, refresh, t])

  const handleSaveIdentity = useCallback(async () => {
    if (savingIdentity) return

    setSavingIdentity(true)
    try {
      const gate = settingsPageActionResult({
        pageId: 'organizations',
        action: 'profile-write',
        source: 'native',
      })
      if (!isClaimableLive(gate)) return
      await window.electronAPI.updateOrgIdentity({
        username: usernameDraft.trim() || undefined,
        email: emailDraft.trim() || undefined,
      })
      toast.success(t('settings.orgs.identitySaved'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('settings.orgs.identitySaveFailed'), { description: message })
    } finally {
      setSavingIdentity(false)
    }
  }, [emailDraft, savingIdentity, t, usernameDraft])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.orgs.title')}
        actions={<HeaderMenu route={routes.view.settings('organizations')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 py-5 sm:px-6">
          <SettingsSection
            title={t('settings.orgs.yourOrgs')}
            description={t('settings.orgs.yourOrgsDesc')}
          >
            <SettingsCard>
              {orgs.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  {t('settings.orgs.empty')}
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {orgs.map((organization) => (
                    <button
                      key={organization.id}
                      type="button"
                      onClick={() => {
                        setSelectedOrgId(organization.id)
                      }}
                      aria-pressed={selectedOrgId === organization.id}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors ${
                        selectedOrgId === organization.id
                          ? 'bg-foreground/5'
                          : 'hover:bg-foreground/3'
                      }`}
                    >
                      <span className="min-w-0 truncate font-medium">{organization.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('settings.orgs.memberCount', {
                          count: organization.members.length,
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="border-t border-border/40 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <SettingsInput
                    label={t('settings.orgs.orgName')}
                    value={newOrgName}
                    onChange={setNewOrgName}
                    placeholder={t('settings.orgs.orgNamePlaceholder')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleCreate()
                    }}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleCreate()}
                    disabled={!newOrgName.trim() || creating}
                    className="shrink-0"
                  >
                    {creating ? t('common.creating') : t('settings.orgs.create')}
                  </Button>
                </div>
              </div>
            </SettingsCard>
          </SettingsSection>

          {selected && (
            <SettingsSection
              title={selected.name}
              description={t('settings.orgs.selectedOrgDesc', { name: selected.name })}
            >
              <div className="space-y-5">
                <section className="space-y-3">
                  <div className="space-y-0.5 px-1">
                    <h4 className="text-sm font-medium">{t('settings.orgs.teamSpaces')}</h4>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.orgs.teamSpacesDesc', { name: selected.name })}
                    </p>
                  </div>
                  <SettingsCard>
                    {teamSpaces.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-muted-foreground">
                        {t('settings.orgs.teamSpacesEmpty')}
                      </div>
                    ) : (
                      <div className="divide-y divide-border/40">
                        {teamSpaces.map((workspace) => (
                          <SettingsRow key={workspace.id} label={workspace.name} />
                        ))}
                      </div>
                    )}
                  </SettingsCard>
                </section>

                <section className="space-y-3">
                  <div className="space-y-0.5 px-1">
                    <h4 className="text-sm font-medium">{t('settings.orgs.members')}</h4>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.orgs.membersDesc', { name: selected.name })}
                    </p>
                  </div>
                  <SettingsCard>
                    <div className="divide-y divide-border/40">
                      {selected.members.map((member: OrgMember) => {
                        const identity = formatOrgMemberIdentity(
                          member,
                          {
                            userId: t('settings.orgs.userId'),
                            username: t('settings.orgs.username'),
                            email: t('settings.orgs.email'),
                          },
                          t('settings.orgs.valueEmpty'),
                        )
                        return (
                          <div
                            key={`${member.orgId}:${member.userId}`}
                            className="flex items-start justify-between gap-3 px-4 py-3"
                            data-testid="org-member-row"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="truncate text-sm font-medium">
                                {member.displayLabel || member.username || t('settings.orgs.memberUnknown')}
                              </div>
                              <dl className="space-y-0.5 text-xs text-muted-foreground">
                                <div>
                                  <dt className="inline">{t('settings.orgs.userId')}: </dt>
                                  <dd className="inline break-all font-mono">{member.userId}</dd>
                                </div>
                                <div>
                                  <dt className="inline">{t('settings.orgs.username')}: </dt>
                                  <dd className="inline break-all">{identity.username}</dd>
                                </div>
                                <div>
                                  <dt className="inline">{t('settings.orgs.email')}: </dt>
                                  <dd className="inline break-all">{identity.email}</dd>
                                </div>
                              </dl>
                            </div>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {roleLabel(member.role, t)}
                            </span>
                          </div>
                        )
                      })}
                      {selected.pendingInvites.map((invite: OrgInvitePublic) => (
                        <SettingsRow
                          key={invite.id}
                          label={invite.emailOrUsername}
                          description={t('settings.orgs.pendingInvite')}
                          action={
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                              {roleLabel(invite.role, t)} · {t('settings.orgs.pending')}
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </SettingsCard>
                </section>

                <section className="space-y-3">
                  <div className="space-y-0.5 px-1">
                    <h4 className="text-sm font-medium">{t('settings.orgs.invite')}</h4>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.orgs.inviteDesc')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.orgs.inviteNoMailer')}
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                      <li>{t('settings.orgs.roleMemberHint')}</li>
                      <li>{t('settings.orgs.roleAdminHint')}</li>
                    </ul>
                  </div>
                  <SettingsCard>
                    <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                      <SettingsInput
                        label={t('settings.orgs.inviteTarget')}
                        value={inviteTarget}
                        onChange={setInviteTarget}
                        placeholder={t('settings.orgs.inviteTargetPlaceholder')}
                      />
                      <SettingsSelect
                        label={t('settings.orgs.role')}
                        value={inviteRole}
                        onValueChange={(value) =>
                          setInviteRole(value === 'admin' ? 'admin' : 'member')
                        }
                        options={[
                          { value: 'member', label: t('settings.orgs.roleMember') },
                          { value: 'admin', label: t('settings.orgs.roleAdmin') },
                        ]}
                      />
                      <Button
                        size="sm"
                        onClick={() => void handleInvite()}
                        disabled={!inviteTarget.trim() || inviting}
                        className="shrink-0"
                      >
                        {inviting ? t('common.sending') : t('settings.orgs.sendInvite')}
                      </Button>
                    </div>
                  </SettingsCard>
                </section>
              </div>
            </SettingsSection>
          )}

          <SettingsSection
            title={t('settings.orgs.accept')}
            description={t('settings.orgs.acceptDesc')}
          >
            <SettingsCard>
              <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
                <SettingsInput
                  label={t('settings.orgs.inviteToken')}
                  value={acceptToken}
                  onChange={setAcceptToken}
                  placeholder={t('settings.orgs.inviteTokenPlaceholder')}
                  className="min-w-0 flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => void handleAccept()}
                  disabled={!acceptToken.trim() || accepting}
                  className="shrink-0"
                >
                  {accepting ? t('common.loading') : t('settings.orgs.acceptAction')}
                </Button>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            title={t('settings.orgs.identity')}
            description={t('settings.orgs.identityDesc')}
          >
            <SettingsCard>
              <div className="space-y-3 p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{t('settings.orgs.roxServerUrl')}</div>
                  <p className="text-sm text-muted-foreground">{t('settings.orgs.roxServerUrlHint')}</p>
                </div>
                <SettingsInput
                  label={t('settings.orgs.username')}
                  value={usernameDraft}
                  onChange={setUsernameDraft}
                  placeholder={t('settings.orgs.usernamePlaceholder')}
                />
                <SettingsInput
                  label={t('settings.orgs.email')}
                  value={emailDraft}
                  onChange={setEmailDraft}
                  type="email"
                  placeholder={t('settings.orgs.emailPlaceholder')}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => void handleSaveIdentity()} disabled={savingIdentity}>
                    {savingIdentity ? t('common.saving') : t('common.save')}
                  </Button>
                </div>
              </div>
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
      </div>
    </div>
  )
}
