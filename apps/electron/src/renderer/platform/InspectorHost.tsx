/**
 * InspectorHost (W1 unified shell, spec S-03 §3.1/§3.3) — right-side
 * collapsible inspector: a 48px section rail (always visible) plus one
 * 320px inspector panel.
 *
 * Behavior contract (S-03 §3.3, implemented by `inspector-model.ts`):
 * clicking an inactive section icon opens the panel with that section;
 * clicking the icon of the section already shown hides the panel.
 * Visibility and active section persist via KEYS.inspectorVisible /
 * KEYS.inspectorSection (`atoms/unified-shell.ts`).
 *
 * W1 scope: the `info` section is live (focused-surface properties derived
 * from panel-stack + NavigationContext); `agent`/`outline`/`backlinks` render
 * i18n empty states — their content lands with the Knowledge workspace (W2).
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled.
 */
import { useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Bot, Info, Link2, ListTree, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  focusedPanelIdAtom,
  focusedPanelRouteAtom,
  getPanelTypeFromRoute,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  inspectorSectionAtom,
  inspectorVisibleAtom,
  type InspectorSectionId,
} from '@/atoms/unified-shell'
import { selectedConnectionAtom } from '@/atoms/connections'
import {
  formatConnectionAudit,
  latestConnectionAudit,
  sanitizeConnectionAuditRows,
  sanitizeConnectionBindingRows,
} from '@/pages/connections-list'
import {
  MOVE_BACKENDS,
  errorMessage,
  formatConfirmLeases,
  formatReconnectLeases,
  sanitizeActiveLeases,
  sanitizeReconnectLeases,
  type ActiveLeaseView,
  type MoveBackend,
} from '@/pages/connections-ui'
import { isConnectionsNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { RADIUS_INNER } from '@/components/app-shell/panel-constants'
import { isStaleInspect, projectConnectionInspect, projectConnectionInspector } from './connection-inspector-model'
import {
  INSPECTOR_LIVE_SECTIONS,
  INSPECTOR_SECTION_IDS,
  normalizeInspectorSection,
  resolveInspectorToggle,
} from './inspector-model'
import { panelTypeToSurfaceKind } from './surface-tab-model'

const INSPECTOR_PANEL_WIDTH = 320
const INSPECTOR_RAIL_WIDTH = 48

const SECTION_ICONS: Record<InspectorSectionId, LucideIcon> = {
  info: Info,
  agent: Bot,
  outline: ListTree,
  backlinks: Link2,
}

// -----------------------------------------------------------------------------
// Info section (live in W1) — properties of the focused panel's surface.
// -----------------------------------------------------------------------------

function projectInspectorConsumers(raw: unknown) {
  return sanitizeConnectionBindingRows(raw).map((row) => ({
    consumerId: row.consumerId,
    status: row.purpose,
    purpose: row.purpose,
    actions: row.actions.join(', ') || '—',
    resources: row.resources.join(', ') || '—',
  }))
}

function visibleInspectValue(value: string) {
  return value && value !== '—' ? value : ''
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <span className={cn('break-all text-[12px] text-foreground/90', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
    </div>
  )
}

function ConnectionInfoSection() {
  const { t } = useTranslation()
  const selected = useAtomValue(selectedConnectionAtom)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [confirmMove, setConfirmMove] = useState(false)
  const [confirmReconnect, setConfirmReconnect] = useState(false)
  const [moveTarget, setMoveTarget] = useState<MoveBackend>(MOVE_BACKENDS[0])
  const [consumers, setConsumers] = useState<Array<{ consumerId: string; status: string; purpose: string; actions: string; resources: string }>>([])
  const [testLogin, setTestLogin] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [inspect, setInspect] = useState<ReturnType<typeof projectConnectionInspect> | null>(null)
  const [leases, setLeases] = useState('')
  const [activeLeases, setActiveLeases] = useState<ActiveLeaseView[]>([])
  const [auditSummary, setAuditSummary] = useState('')
  const [revalidated, setRevalidated] = useState('')
  useEffect(() => {
    if (!selected) {
      setConsumers([])
      setTestLogin('')
      setActionError(null)
      setInspect(null)
      setConfirmReconnect(false)
      setLeases('')
      setActiveLeases([])
      setAuditSummary('')
      setRevalidated('')
      return
    }
    setRevalidated('')
    const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
    if (typeof listConnectionBindings !== 'function') {
      setConsumers([])
      return
    }
    let stale = false
    listConnectionBindings({ workspaceId: selected.workspaceId, connectionId: selected.id })
      .then((raw) => {
        if (stale) return
        setConsumers(projectInspectorConsumers(raw))
      })
      .catch((err) => {
        if (!stale) setActionError(errorMessage(err))
      })
    return () => {
      stale = true
    }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    const inspectConnection = window.electronAPI?.workgraph?.inspectConnection
    if (typeof inspectConnection !== 'function') {
      setInspect(null)
      return
    }
    let stale = false
    inspectConnection({ workspaceId: selected.workspaceId, connectionId: selected.id })
      .then((raw) => {
        if (!stale) setInspect(projectConnectionInspect(raw))
      })
      .catch((err) => {
        if (!stale) {
          setInspect(null)
          setActionError(errorMessage(err))
        }
      })
    return () => {
      stale = true
    }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    const listConnectionAudit = window.electronAPI?.workgraph?.listConnectionAudit
    if (typeof listConnectionAudit !== 'function') {
      setAuditSummary('')
      return
    }
    let stale = false
    listConnectionAudit({ workspaceId: selected.workspaceId, connectionId: selected.id })
      .then((raw) => {
        if (stale) return
        const latest = latestConnectionAudit(sanitizeConnectionAuditRows(raw))
        setAuditSummary(latest ? formatConnectionAudit(latest) : '')
      })
      .catch((err) => {
        if (!stale) {
          setAuditSummary('')
          setActionError(errorMessage(err))
        }
      })
    return () => {
      stale = true
    }
  }, [selected])
  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Info className="h-6 w-6 text-muted-foreground/40" />
        <span className="text-[13px] font-medium text-foreground/80">
          {t('inspector.empty.connections.title')}
        </span>
        <span className="text-[12px] leading-relaxed text-muted-foreground/60">
          {t('inspector.empty.connections.body')}
        </span>
      </div>
    )
  }
  const fields = projectConnectionInspector(selected)
  const workspaceId = selected.workspaceId
  const previewActiveLeases = async () => {
    const listConnectionLeases = window.electronAPI?.workgraph?.listConnectionLeases
    if (!workspaceId || typeof listConnectionLeases !== 'function') {
      setActiveLeases([])
      return
    }
    try {
      setActionError(null)
      setActiveLeases(sanitizeActiveLeases(await listConnectionLeases({
        workspaceId,
        connectionId: selected.id,
      })))
    } catch (err) {
      setActionError(errorMessage(err))
      setActiveLeases([])
    }
  }

  const previewReconnect = async () => {
    setConfirmReconnect(true)
    await previewActiveLeases()
  }
  const applyRevokedLeases = (leases: unknown) => {
    const next = formatReconnectLeases(sanitizeReconnectLeases(leases))
    setLeases(next === '—' ? '' : next)
  }
  const applyInspect = (inspect: unknown) => {
    setInspect(projectConnectionInspect(inspect))
  }
  const applyRevalidated = (consumers: unknown) => {
    const next = formatReconnectLeases(sanitizeReconnectLeases(consumers))
    setRevalidated(next === '—' ? '' : next)
  }
  const applyConsumers = async () => {
    const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
    if (!workspaceId || typeof listConnectionBindings !== 'function') {
      setConsumers([])
      return
    }
    try {
      setConsumers(projectInspectorConsumers(await listConnectionBindings({
        workspaceId,
        connectionId: selected.id,
      })))
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/5 overflow-y-auto">
      <InfoRow label={t('inspector.field.provider')} value={fields.provider} />
      <div data-testid="connections-inspector-tenant">
        <InfoRow label={t('inspector.field.tenant')} value={fields.tenant} mono />
      </div>
      <InfoRow label={t('inspector.field.storageMode')} value={fields.storageMode} mono />
      <InfoRow label={t('inspector.field.credentialRef')} value={fields.credentialRef} mono />
      <InfoRow label={t('inspector.field.scopes')} value={fields.scopes} mono />
      {inspect ? (
        <>
          {visibleInspectValue(inspect.health) ? (
            <div data-testid="connections-inspector-health">
              <InfoRow label={t('inspector.field.health')} value={inspect.health} />
            </div>
          ) : null}
          {visibleInspectValue(inspect.expiry) ? (
            <InfoRow label={t('inspector.field.expiry')} value={inspect.expiry} mono />
          ) : null}
          {visibleInspectValue(inspect.provenance) ? (
            <InfoRow label={t('inspector.field.provenance')} value={inspect.provenance} mono />
          ) : null}
          {visibleInspectValue(inspect.fingerprint) ? (
            <InfoRow label={t('inspector.field.fingerprint')} value={inspect.fingerprint} mono />
          ) : null}
          {visibleInspectValue(inspect.credentialKind) ? (
            <InfoRow label={t('inspector.field.credentialKind')} value={inspect.credentialKind} mono />
          ) : null}
          {visibleInspectValue(inspect.versionId) ? (
            <InfoRow label={t('inspector.field.versionId')} value={inspect.versionId} mono />
          ) : null}
        </>
      ) : null}
      {testLogin ? <InfoRow label={t('inspector.field.testLogin')} value={testLogin} mono /> : null}
      {consumers.length > 0 ? (
        <>
          <InfoRow
            label={t('inspector.field.consumers')}
            value={consumers.map((row) => `${row.consumerId}: ${row.status}`).join(', ')}
          />
          <div data-testid="connections-inspector-purpose">
            <InfoRow
              label={t('inspector.field.purpose')}
              value={consumers.map((row) => `${row.consumerId}: ${row.purpose}`).join(', ')}
              mono
            />
          </div>
          <div data-testid="connections-inspector-actions">
            <InfoRow
              label={t('inspector.field.actions')}
              value={consumers.map((row) => `${row.consumerId}: ${row.actions}`).join(', ')}
              mono
            />
          </div>
          <div data-testid="connections-inspector-resources">
            <InfoRow
              label={t('inspector.field.resources')}
              value={consumers.map((row) => `${row.consumerId}: ${row.resources}`).join(', ')}
              mono
            />
          </div>
        </>
      ) : null}
      {revalidated ? (
        <div data-testid="connections-inspector-revalidated">
          <InfoRow label={t('inspector.field.revalidated')} value={revalidated} mono />
        </div>
      ) : null}
      {auditSummary ? (
        <div data-testid="connections-inspector-audit">
          <InfoRow label={t('inspector.field.audit')} value={auditSummary} mono />
        </div>
      ) : null}
      {leases ? (
        <div data-testid="connections-inspector-leases">
          <InfoRow label={t('inspector.field.leases')} value={leases} mono />
          <p className="px-3 pb-1 text-[11px] text-muted-foreground">{t('connections.reconnectDone')}</p>
        </div>
      ) : null}
      {actionError ? (
        <p className="px-3 py-2 text-[12px]" data-testid="connections-inspector-error">{actionError}</p>
      ) : null}
      {inspect && isStaleInspect(inspect) ? (
        <div className="flex flex-col gap-1 px-3 py-2" data-testid="connections-inspector-reconnect">
          <p className="text-[12px] text-muted-foreground">{t('connections.reconnectHint')}</p>
          {confirmReconnect ? (
            <>
              <div className="font-mono text-[11px]" data-testid="connections-reconnect-confirm-target">
                {formatConfirmLeases(selected, activeLeases)}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('connections.reconnectLeases')}</p>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-[12px]"
                  onClick={async () => {
                    const reconnectConnection = window.electronAPI?.workgraph?.reconnectConnection
                    if (!workspaceId || typeof reconnectConnection !== 'function') return
                    try {
                      setActionError(null)
                      const result = await reconnectConnection({ workspaceId, connectionId: selected.id })
                      void applyConsumers()
                      applyRevalidated(result.consumers)
                      applyInspect(result.inspect)
                      applyRevokedLeases(result.leases)
                      setConfirmReconnect(false)
                    } catch (err) {
                      setActionError(errorMessage(err))
                    }
                  }}
                >
                  {t('connections.reconnectConfirm')}
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-[12px]"
                  onClick={() => setConfirmReconnect(false)}
                >
                  {t('connections.reconnectCancel')}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={() => void previewReconnect()}
            >
              {t('connections.reconnect')}
            </button>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1 px-3 py-2">
        <button
          type="button"
          className="rounded border px-2 py-1 text-[12px]"
          onClick={async () => {
            const testConnection = window.electronAPI?.workgraph?.testConnection
            if (!workspaceId || typeof testConnection !== 'function') return
            try {
              setActionError(null)
              const result = await testConnection({ workspaceId, connectionId: selected.id })
              setTestLogin(result.login)
            } catch (err) {
              setActionError(errorMessage(err))
            }
          }}
        >
          {t('connections.test')}
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-[12px]"
          onClick={async () => {
            const repairConnection = window.electronAPI?.workgraph?.repairConnection
            if (!workspaceId || typeof repairConnection !== 'function') return
            try {
              setActionError(null)
              const result = await repairConnection({ workspaceId, connectionId: selected.id })
              void applyConsumers()
              applyRevalidated(result.consumers)
              applyInspect(result.inspect)
            } catch (err) {
              setActionError(errorMessage(err))
            }
          }}
        >
          {t('connections.repair')}
        </button>
        {confirmRotate ? (
          <>
            <div className="font-mono text-[11px]" data-testid="connections-inspector-rotate-confirm-target">
              {formatConfirmLeases(selected, activeLeases)}
            </div>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={async () => {
                const rotateConnection = window.electronAPI?.workgraph?.rotateConnection
                if (!workspaceId || typeof rotateConnection !== 'function') return
                try {
                  setActionError(null)
                  const result = await rotateConnection({ workspaceId, connectionId: selected.id })
                  void applyConsumers()
                  applyRevalidated(result.consumers)
                  applyInspect(result.inspect)
                  applyRevokedLeases(result.leases)
                  setConfirmRotate(false)
                } catch (err) {
                  setActionError(errorMessage(err))
                }
              }}
            >
              {t('connections.rotateConfirm')}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={() => setConfirmRotate(false)}
            >
              {t('connections.rotateCancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded border px-2 py-1 text-[12px]"
            onClick={() => {
              setConfirmRotate(true)
              void previewActiveLeases()
            }}
          >
            {t('connections.rotate')}
          </button>
        )}
        {confirmMove ? (
          <>
            <div className="font-mono text-[11px]" data-testid="connections-inspector-move-confirm-target">
              {formatConfirmLeases(selected, activeLeases)}
            </div>
            <select
              className="rounded border bg-transparent px-2 py-1 font-mono text-[12px]"
              value={moveTarget}
              onChange={(event) => setMoveTarget(event.target.value === 'local-alt' ? 'local-alt' : MOVE_BACKENDS[0])}
            >
              {MOVE_BACKENDS.map((backend) => (
                <option key={backend} value={backend}>{backend}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={async () => {
                const moveConnection = window.electronAPI?.workgraph?.moveConnection
                if (!workspaceId || typeof moveConnection !== 'function') return
                try {
                  setActionError(null)
                  const result = await moveConnection({
                    workspaceId,
                    connectionId: selected.id,
                    targetBackend: moveTarget,
                  })
                  void applyConsumers()
                  applyRevalidated(result.consumers)
                  applyInspect(result.inspect)
                  applyRevokedLeases(result.leases)
                  setConfirmMove(false)
                } catch (err) {
                  setActionError(errorMessage(err))
                }
              }}
            >
              {t('connections.moveConfirm')}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={() => setConfirmMove(false)}
            >
              {t('connections.moveCancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded border px-2 py-1 text-[12px]"
            onClick={() => {
              setConfirmMove(true)
              void previewActiveLeases()
            }}
          >
            {t('connections.move')}
          </button>
        )}
      </div>
    </div>
  )
}

function InfoSection() {
  const { t } = useTranslation()
  const route = useAtomValue(focusedPanelRouteAtom)
  const panelId = useAtomValue(focusedPanelIdAtom)
  const navState = useNavigationState()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  if (isConnectionsNavigation(navState)) {
    return <ConnectionInfoSection />
  }

  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const panelType = route ? getPanelTypeFromRoute(route) : null
  const surfaceKind = panelType ? panelTypeToSurfaceKind(panelType) : null
  const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/5 overflow-y-auto">
      <InfoRow
        label={t('inspector.field.title')}
        value={sessionMeta ? getSessionTitle(sessionMeta) : t('surfaceTabs.untitled')}
      />
      <InfoRow
        label={t('inspector.field.kind')}
        value={surfaceKind ?? panelType ?? '—'}
        mono
      />
      <InfoRow label={t('inspector.field.navigator')} value={navState.navigator} mono />
      <InfoRow label={t('inspector.field.session')} value={sessionId ?? '—'} mono />
      <InfoRow label={t('inspector.field.panel')} value={panelId ?? '—'} mono />
      <InfoRow label={t('inspector.field.route')} value={route ?? '—'} mono />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Empty sections (agent/outline/backlinks) — content arrives with W2 (S-03 §3.3).
// -----------------------------------------------------------------------------

function EmptySection({ section }: { section: InspectorSectionId }) {
  const { t } = useTranslation()
  const Icon = SECTION_ICONS[section]
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <span className="text-[13px] font-medium text-foreground/80">
        {t(`inspector.empty.${section}.title`)}
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground/60">
        {t(`inspector.empty.${section}.body`)}
      </span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Host: 320px panel (when visible) + 48px section rail (always visible).
// -----------------------------------------------------------------------------

export function InspectorHost() {
  const { t } = useTranslation()
  const [visible, setVisible] = useAtom(inspectorVisibleAtom)
  const [sectionRaw, setSection] = useAtom(inspectorSectionAtom)
  // Persisted values can be arbitrary (older builds); validated on read.
  const section = normalizeInspectorSection(sectionRaw)

  const handleSectionClick = (clicked: InspectorSectionId) => {
    const next = resolveInspectorToggle({ visible, section }, clicked)
    setVisible(next.visible)
    setSection(next.section)
  }

  return (
    <div className="flex h-full shrink-0 items-stretch">
      {visible && (
        <div
          className="flex h-full flex-col overflow-hidden bg-background shadow-middle"
          style={{ width: INSPECTOR_PANEL_WIDTH, borderRadius: RADIUS_INNER }}
        >
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-foreground/5 pl-3 pr-2">
            <span className="truncate text-[13px] font-medium">{t(`inspector.${section}`)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('inspector.hide')}
                  onClick={() => setVisible(false)}
                  className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t('inspector.hide')}</TooltipContent>
            </Tooltip>
          </div>
          {INSPECTOR_LIVE_SECTIONS.includes(section) ? (
            <InfoSection />
          ) : (
            <EmptySection section={section} />
          )}
        </div>
      )}
      <div
        className="flex h-full shrink-0 flex-col items-center gap-0.5 py-2"
        style={{ width: INSPECTOR_RAIL_WIDTH }}
      >
        {INSPECTOR_SECTION_IDS.map((sectionId) => {
          const Icon = SECTION_ICONS[sectionId]
          const active = visible && section === sectionId
          return (
            <Tooltip key={sectionId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t(`inspector.${sectionId}`)}
                  aria-pressed={active}
                  onClick={() => handleSectionClick(sectionId)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t(`inspector.${sectionId}`)}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
