import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PROJECT_AUTHORITY_NAME_MAX_LENGTH, PROJECT_AUTHORITY_LOGIN_MAX_LENGTH, PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH,
  projectAuthorityErrorMessageKey, type ProjectAuthorityState } from '../../../shared/project-authority'

/** Connections service entry; main owns sign-in and encrypted JWT persistence. */
export function ProjectAuthorityConnectionPanel() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [serviceUrl, setServiceUrl] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<ProjectAuthorityState>('unconfigured')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; status: number } | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setPassword(''); setError(null); setBusy(false)
    setServiceUrl(''); setWorkspaceId(''); setWorkspaceName(''); setLogin('')
    if (!workspace) { setState('unconfigured'); return }
    void Promise.all([window.electronAPI.getProjectAuthorityConfiguration(workspace.id), window.electronAPI.getProjectAuthorityState()])
      .then(([configuration, currentState]) => {
        if (generation.current !== current) return
        setState(currentState)
        if (configuration) {
          setServiceUrl(configuration.url.replace(/^ws/, 'http'))
          setWorkspaceId(configuration.workspaceId)
          setWorkspaceName(configuration.workspaceName ?? '')
        }
      }).catch(() => { if (generation.current === current) setState('unavailable') })
    const unsubscribe = window.electronAPI.onProjectAuthorityChanged(() => {
      void window.electronAPI.getProjectAuthorityState().then(next => {
        if (generation.current === current) setState(next)
      }).catch(() => { if (generation.current === current) setState('unavailable') })
    })
    return () => { ++generation.current; unsubscribe() }
  }, [workspace?.id])

  const connect = async () => {
    if (!workspace || busy) return
    const current = generation.current
    setBusy(true); setError(null)
    try {
      const result = await window.electronAPI.connectProjectAuthority(workspace.id,
        { serviceUrl: serviceUrl.trim(), workspaceId: workspaceId.trim(), workspaceName: workspaceName.trim(), login: login.trim(), password })
      if (generation.current !== current) return
      if (!result.ok) { setError(result.error); setState(result.error.status >= 500 ? 'unavailable' : 'denied') }
      else setState(await window.electronAPI.getProjectAuthorityState())
    } catch { if (generation.current === current) setError({ code: 'PROVIDER_UNAVAILABLE', status: 503 }) }
    finally { if (generation.current === current) { setPassword(''); setBusy(false) } }
  }
  const disconnect = async () => {
    if (!workspace || busy) return
    const current = generation.current
    setBusy(true); setError(null)
    try {
      const result = await window.electronAPI.disconnectProjectAuthority(workspace.id)
      if (generation.current !== current) return
      if (!result.ok) { setError(result.error); setState('unavailable') }
      else setState('unconfigured')
    } catch { if (generation.current === current) setError({ code: 'PROVIDER_UNAVAILABLE', status: 503 }) }
    finally { if (generation.current === current) { setPassword(''); setBusy(false) } }
  }
  return <section className="mb-6 rounded-xl border border-foreground/10 p-4 text-foreground"
    data-testid="project-authority-connection" data-authority-state={state}>
    <h2 className="text-sm font-semibold">{t('projectAuthority.heading')}</h2>
    <p className="mt-1 text-xs text-muted-foreground">{t('projectAuthority.description')}</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void connect() }}>
      <label className="grid gap-1 text-xs" htmlFor="project-authority-url">{t('projectAuthority.serviceUrl')}
        <Input id="project-authority-url" data-testid="project-authority-url" value={serviceUrl} onChange={event => setServiceUrl(event.target.value)} disabled={busy} required />
        <span className="text-xs text-muted-foreground">{t('projectAuthority.serviceUrlHelp')}</span>
      </label>
      <label className="grid gap-1 text-xs" htmlFor="project-authority-workspace">{t('projectAuthority.workspaceId')}
        <Input id="project-authority-workspace" data-testid="project-authority-workspace" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} disabled={busy} required />
        <span className="text-xs text-muted-foreground">{t('projectAuthority.workspaceIdHelp')}</span>
      </label>
      <label className="grid gap-1 text-xs" htmlFor="project-authority-workspace-name">{t('projectAuthority.workspaceName')}
        <Input id="project-authority-workspace-name" data-testid="project-authority-workspace-name" value={workspaceName} maxLength={PROJECT_AUTHORITY_NAME_MAX_LENGTH} onChange={event => setWorkspaceName(event.target.value)} disabled={busy} required />
        <span className="text-xs text-muted-foreground">{t('projectAuthority.workspaceNameHelp')}</span>
      </label>
      <label className="grid gap-1 text-xs" htmlFor="project-authority-login">{t('projectAuthority.login')}
        <Input id="project-authority-login" data-testid="project-authority-login" value={login} maxLength={PROJECT_AUTHORITY_LOGIN_MAX_LENGTH} onChange={event => setLogin(event.target.value)} autoComplete="username" disabled={busy} required />
      </label>
      <label className="grid gap-1 text-xs" htmlFor="project-authority-password">{t('projectAuthority.password')}
        <Input id="project-authority-password" data-testid="project-authority-password" type="password" value={password} maxLength={PROJECT_AUTHORITY_PASSWORD_MAX_LENGTH} onChange={event => setPassword(event.target.value)} autoComplete="off" disabled={busy} required />
      </label>
      <div className="flex items-end gap-2">
        <Button type="submit" data-testid="project-authority-connect" disabled={busy || !workspace}>{t(busy ? 'projectAuthority.busy' : 'projectAuthority.connect')}</Button>
        <Button type="button" data-testid="project-authority-disconnect" variant="outline" onClick={() => { void disconnect() }} disabled={busy || !workspace}>{t('projectAuthority.disconnect')}</Button>
      </div>
    </form>
    <p className="mt-3 text-xs" role="status" data-testid="project-authority-status">{t(state === 'ready' ? 'projectAuthority.ready' : 'sharedProjects.' + state)}</p>
    {error && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="project-authority-error" data-error-code={error.code}>
      {t(projectAuthorityErrorMessageKey(error.code))}
      <span className="mt-1 block text-xs">{t('projectAuthority.errorDetails', { code: error.code, status: error.status })}</span>
    </p>}
  </section>
}
