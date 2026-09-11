/**
 * CommandGatewaySection — owner console for pending commands
 * (RX-DOC-0032 phase 0). Lists commands awaiting a decision for the active
 * workspace with approve/deny. Degrades to null on transports without the
 * gateway handlers.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { SettingsSection, SettingsCard } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { useCommandGateway } from '@/hooks/useCommandGateway'

export interface CommandGatewaySectionProps {
  workspaceId: string | undefined
}

export function CommandGatewaySection({ workspaceId }: CommandGatewaySectionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const gw = useCommandGateway(workspaceId)

  if (!gw.available && !gw.isLoading) return null

  return (
    <SettingsSection
      title={t("settings.commandGateway.title")}
      description={t("settings.commandGateway.description")}
    >
      <SettingsCard className="p-4 space-y-3">
        {gw.error ? <p className="text-sm text-red-500">{gw.error}</p> : null}

        {gw.commands.length === 0 && !gw.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("settings.commandGateway.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {gw.commands.map((c) => (
              <li key={c.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-muted-foreground">{c.command}</p>
                    <p className="mt-1 text-sm">{c.reason}</p>
                    {c.impact ? (
                      <p className="text-xs italic text-muted-foreground">{c.impact}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("settings.commandGateway.expires")}:{' '}
                      {new Date(c.expiresAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" onClick={() => void gw.approve(c.id)}>
                      {t("settings.commandGateway.approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void gw.deny(c.id)}>
                      {t("settings.commandGateway.deny")}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {gw.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </SettingsCard>
    </SettingsSection>
  )
}
