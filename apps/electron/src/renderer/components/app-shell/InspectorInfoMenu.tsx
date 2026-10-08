/**
 * InspectorInfoMenu - Self-contained Help / documentation dropdown.
 *
 * Extracted from the TopBar so the inspector action rail can host it as a
 * standalone rail button (see InspectorActionRail for the matching style).
 */

import * as Icons from "lucide-react"
import { useTranslation } from "react-i18next"
import { getDocUrl } from "@rox/shared/docs/doc-links"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"

export function InspectorInfoMenu({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("menu.helpAndDocs")}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted transition-colors hover:bg-surface-hover hover:text-foreground',
            className,
          )}
        >
          <Icons.HelpCircle className="icon-toolbar" />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" minWidth="min-w-48">
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}>
          <Icons.DatabaseZap className="icon-caption" />
          <span className="flex-1">{t("sidebar.sources")}</span>
          <Icons.ExternalLink className="icon-status text-muted-foreground" />
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('skills'))}>
          <Icons.Zap className="icon-caption" />
          <span className="flex-1">{t("sidebar.skills")}</span>
          <Icons.ExternalLink className="icon-status text-muted-foreground" />
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('statuses'))}>
          <Icons.CheckCircle2 className="icon-caption" />
          <span className="flex-1">{t("sidebar.statuses")}</span>
          <Icons.ExternalLink className="icon-status text-muted-foreground" />
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('permissions'))}>
          <Icons.Settings className="icon-caption" />
          <span className="flex-1">{t("settings.permissions.title")}</span>
          <Icons.ExternalLink className="icon-status text-muted-foreground" />
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('automations'))}>
          <Icons.Webhook className="icon-caption" />
          <span className="flex-1">{t("sidebar.automations")}</span>
          <Icons.ExternalLink className="icon-status text-muted-foreground" />
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl(getDocUrl('messaging'))}>
          <Icons.MessageSquare className="icon-caption" />
          <span className="flex-1">{t("settings.messaging.title")}</span>
          <Icons.ExternalLink className="icon-status text-muted-foreground" />
        </StyledDropdownMenuItem>
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://thecraftagents.com/docs')}>
          <Icons.ExternalLink className="icon-caption" />
          <span className="flex-1">{t("menu.allDocumentation")}</span>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}