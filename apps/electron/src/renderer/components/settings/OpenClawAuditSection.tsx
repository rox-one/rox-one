/**
 * OpenClawAuditSection — settings panel for the OpenClaw security audit
 * (RX-TSK-0112). Shows managed-runtime status, runs standard/deep audits,
 * lists findings with severity, and lets the owner accept (with rationale +
 * expiry) or revoke risk acceptances. Degrades silently on transports
 * without the OpenClaw handlers.
 */

import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'
import { SettingsSection, SettingsCard } from '@/components/settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { AuditSeverity, SecurityFinding } from '@craft-agent/shared/openclaw'
import { useOpenClawAudit } from '@/hooks/useOpenClawAudit'

const SEVERITY_ORDER: readonly AuditSeverity[] = ['critical', 'warn', 'info', 'pass']

function severityTone(severity: AuditSeverity): string {
  switch (severity) {
    case 'critical':
      return 'text-red-500'
    case 'warn':
      return 'text-amber-500'
    case 'pass':
      return 'text-emerald-500'
    default:
      return 'text-muted-foreground'
  }
}

export interface OpenClawAuditSectionProps {
  workspaceId: string | undefined
}

export function OpenClawAuditSection({ workspaceId }: OpenClawAuditSectionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const audit = useOpenClawAudit(workspaceId)
  const [acceptTarget, setAcceptTarget] = useState<SecurityFinding | null>(null)
  const [rationale, setRationale] = useState('')

  const findings = useMemo(() => {
    if (!audit.snapshot) return []
    const order = new Map(SEVERITY_ORDER.map((s, i) => [s, i]))
    return [...audit.snapshot.findings].sort(
      (a, b) => (order.get(a.severity) ?? 99) - (order.get(b.severity) ?? 99),
    )
  }, [audit.snapshot])

  if (!audit.available && !audit.isLoading) return null

  const runtimeState = audit.runtimeStatus?.state ?? audit.snapshot?.runtime.state

  const submitAcceptance = async () => {
    if (!acceptTarget) return
    // Acceptance expires in 30 days; the backend re-validates rationale length.
    await audit.acceptRisk(acceptTarget.fingerprint, rationale.trim(), Date.now() + 30 * 24 * 60 * 60 * 1000)
    setAcceptTarget(null)
    setRationale('')
  }

  return (
    <SettingsSection
      title={t("settings.openclawAudit.title")}
      description={t("settings.openclawAudit.description")}
    >
      <SettingsCard className="p-4 space-y-4">
        {/* Runtime status line */}
        <div className="flex items-center gap-2 text-sm">
          {runtimeState === 'running' ? (
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-muted-foreground">{t("settings.openclawAudit.runtimeState")}:</span>
          <span className="font-medium">{runtimeState ?? t("settings.openclawAudit.stateUnknown")}</span>
        </div>

        {/* Run controls */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void audit.runAudit('standard')} disabled={audit.runningMode !== null}>
            {audit.runningMode === 'standard' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            {t("settings.openclawAudit.runStandard")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void audit.runAudit('deep')} disabled={audit.runningMode !== null}>
            {audit.runningMode === 'deep' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            {t("settings.openclawAudit.runDeep")}
          </Button>
          {audit.snapshot ? (
            <span className="text-xs text-muted-foreground">
              {t("settings.openclawAudit.lastRun")}: {new Date(audit.snapshot.completedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        {audit.error ? (
          <p className="text-sm text-red-500">{audit.error}</p>
        ) : null}

        {/* Findings */}
        {findings.length === 0 && !audit.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("settings.openclawAudit.noFindings")}</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.fingerprint} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${severityTone(f.severity)}`}>
                      {f.title}
                      {f.acceptance && !f.acceptance.expired ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({t("settings.openclawAudit.accepted")})
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                    {f.remediation ? (
                      <p className="mt-1 text-xs italic text-muted-foreground">{f.remediation}</p>
                    ) : null}
                  </div>
                  {f.acceptance && !f.acceptance.expired ? (
                    <Button size="sm" variant="outline" onClick={() => void audit.revokeRisk(f.fingerprint)}>
                      {t("settings.openclawAudit.revoke")}
                    </Button>
                  ) : f.severity !== 'pass' ? (
                    <Button size="sm" variant="ghost" onClick={() => setAcceptTarget(f)}>
                      {t("settings.openclawAudit.accept")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {audit.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </SettingsCard>

      {/* Accept-with-rationale dialog */}
      <Dialog open={acceptTarget !== null} onOpenChange={(open) => !open && setAcceptTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.openclawAudit.acceptDialogTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder={t("settings.openclawAudit.acceptPlaceholder")}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAcceptTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={rationale.trim().length < 10} onClick={() => void submitAcceptance()}>
              {t("settings.openclawAudit.acceptConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
