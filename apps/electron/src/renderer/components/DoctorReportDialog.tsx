/**
 * Doctor report dialog (row b2.7) — the user-visible consumer of the tray's
 * "Run diagnostics" item.
 *
 * Renders the safe `DoctorReport` projection returned by the host doctor
 * (`diagnostics:run`). Each finding already carries its i18n `messageKey` and
 * interpolation `detail`, so the dialog needs no severity→key mapping beyond
 * the badge.
 */

import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRegisterModal } from '@/context/ModalContext'
import type { DoctorReport, DoctorSeverity } from '@rox/shared/service-lifecycle'

const SEVERITY_STYLE: Record<DoctorSeverity, { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: 'text-status-success' },
  warn: { icon: AlertTriangle, className: 'text-status-warning' },
  error: { icon: XCircle, className: 'text-destructive' },
}

interface DoctorReportDialogProps {
  /** `null` keeps the dialog closed. */
  report: DoctorReport | null
  onClose: () => void
}

export function DoctorReportDialog({ report, onClose }: DoctorReportDialogProps) {
  const { t } = useTranslation()
  useRegisterModal(report !== null, onClose)

  return (
    <Dialog open={report !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('doctor.title')}</DialogTitle>
          <DialogDescription className="text-left">
            {new Date(report?.generatedAt ?? 0).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3 text-sm">
          {(report?.checks ?? []).map((check, index) => {
            const { icon: Icon, className } = SEVERITY_STYLE[check.severity]
            return (
              <li key={`${check.checkId}-${index}`} className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">{t(check.messageKey, check.detail)}</span>
                <span className={`shrink-0 text-xs font-medium ${className}`}>{t(`doctor.result.${check.severity}`)}</span>
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}