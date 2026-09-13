/**
 * PermissionsSettingsPage
 *
 * Displays permissions configuration for Explore mode.
 * Shows both default patterns (from ~/.craft-agent/permissions/default.json)
 * and custom workspace additions (from workspace permissions.json).
 *
 * Default patterns can be edited by the user in ~/.craft-agent/permissions/default.json.
 * Custom patterns can be edited via workspace permissions.json file.
 */

import * as React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Loader2 } from 'lucide-react'
import { useAppShellContext, useActiveWorkspace } from '@/context/AppShellContext'
import { type PermissionsConfigFile } from '@craft-agent/shared/agent/modes'
import { OpenClawAuditSection } from '@/components/settings/OpenClawAuditSection'
import { CommandGatewaySection } from '@/components/settings/CommandGatewaySection'
import {
  PermissionsDataTable,
  type PermissionRow,
} from '@/components/info'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isClaimableLive } from '@craft-agent/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'permissions',
}

/**
 * Build default permissions data from ~/.craft-agent/permissions/default.json.
 * These are the Explore mode patterns that can be customized by the user.
 * Patterns can include comments which are displayed in the table.
 *
 * Note: We only show allowed patterns here. Anything not on this list is implicitly denied.
 */
function buildDefaultPermissionsData(config: PermissionsConfigFile | null): PermissionRow[] {
  if (!config) return []

  const rows: PermissionRow[] = []

  // Helper to extract pattern and comment from string or object format
  const extractPatternInfo = (item: string | { pattern: string; comment?: string }): { pattern: string; comment: string | null } => {
    if (typeof item === 'string') {
      return { pattern: item, comment: null }
    }
    return { pattern: item.pattern, comment: item.comment || null }
  }

  // Note: We don't show blockedTools here - anything not on the allowed list is implicitly denied

  // Allowed bash patterns
  config.allowedBashPatterns?.forEach((item) => {
    const { pattern, comment } = extractPatternInfo(item)
    rows.push({ access: 'allowed', type: 'bash', pattern, comment })
  })

  // Allowed MCP patterns
  config.allowedMcpPatterns?.forEach((item) => {
    const { pattern, comment } = extractPatternInfo(item)
    rows.push({ access: 'allowed', type: 'mcp', pattern, comment })
  })

  // API endpoints
  config.allowedApiEndpoints?.forEach((item) => {
    const pattern = `${item.method} ${item.path}`
    rows.push({ access: 'allowed', type: 'api', pattern, comment: item.comment || null })
  })

  // Write paths
  config.allowedWritePaths?.forEach((item) => {
    const { pattern, comment } = extractPatternInfo(item)
    rows.push({ access: 'allowed', type: 'tool', pattern: `Write to: ${pattern}`, comment })
  })

  return rows
}

/**
 * Build custom permissions data from workspace permissions.json.
 * These are user-added patterns that extend the defaults.
 */
function buildCustomPermissionsData(config: PermissionsConfigFile, fallbackLabels: { blockedTool: string; bashPattern: string; mcpPattern: string; apiEndpoint: string; writePath: string }): PermissionRow[] {
  const rows: PermissionRow[] = []

  // Additional blocked tools
  config.blockedTools?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? fallbackLabels.blockedTool : (item.comment || fallbackLabels.blockedTool)
    rows.push({ access: 'blocked', type: 'tool', pattern, comment })
  })

  // Additional bash patterns
  config.allowedBashPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? fallbackLabels.bashPattern : (item.comment || fallbackLabels.bashPattern)
    rows.push({ access: 'allowed', type: 'bash', pattern, comment })
  })

  // Additional MCP patterns
  config.allowedMcpPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? fallbackLabels.mcpPattern : (item.comment || fallbackLabels.mcpPattern)
    rows.push({ access: 'allowed', type: 'mcp', pattern, comment })
  })

  // API endpoints
  config.allowedApiEndpoints?.forEach((item) => {
    const pattern = `${item.method} ${item.path}`
    rows.push({ access: 'allowed', type: 'api', pattern, comment: item.comment || fallbackLabels.apiEndpoint })
  })

  // Write paths are shown as allowed paths
  config.allowedWritePaths?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? fallbackLabels.writePath : (item.comment || fallbackLabels.writePath)
    // Show as a special "tool" type since it's about Write/Edit operations
    rows.push({ access: 'allowed', type: 'tool', pattern: `Write to: ${pattern}`, comment })
  })

  return rows
}

export default function PermissionsSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()

  // config-read is device-read: the user must explicitly grant it before any
  // permission file is read. Opening the page is not a grant.
  const [granted, setGranted] = useState(false)

  // Loading and data state
  const [isLoading, setIsLoading] = useState(false)
  const [defaultConfig, setDefaultConfig] = useState<PermissionsConfigFile | null>(null)
  const [defaultPermissionsPath, setDefaultPermissionsPath] = useState<string | null>(null)
  const [customConfig, setCustomConfig] = useState<PermissionsConfigFile | null>(null)

  // Build default permissions data from ~/.craft-agent/permissions/default.json
  const defaultPermissionsData = useMemo(() => buildDefaultPermissionsData(defaultConfig), [defaultConfig])

  // Fallback labels for custom permissions (translated)
  const permissionFallbackLabels = useMemo(() => ({
    blockedTool: t("settings.permissions.customBlockedTool"),
    bashPattern: t("settings.permissions.customBashPattern"),
    mcpPattern: t("settings.permissions.customMcpPattern"),
    apiEndpoint: t("settings.permissions.customApiEndpoint"),
    writePath: t("settings.permissions.allowedWritePath"),
  }), [t])

  // Build custom permissions data from workspace permissions.json
  const customPermissionsData = useMemo(() => {
    if (!customConfig) return []
    return buildCustomPermissionsData(customConfig, permissionFallbackLabels)
  }, [customConfig, permissionFallbackLabels])

  // Load both default and workspace permissions configs. Only runs with a real grant.
  const loadPermissions = useCallback(async (isGranted: boolean) => {
    if (!window.electronAPI) return

    const gate = settingsPageActionResult({
      pageId: 'permissions',
      action: 'config-read',
      source: 'native',
      granted: isGranted,
    })
    if (!isClaimableLive(gate)) return

    setIsLoading(true)
    try {
      // Load default permissions (app-level) - returns both config and path
      const { config: defaults, path: defaultsPath } = await window.electronAPI.getDefaultPermissionsConfig()
      setDefaultConfig(defaults)
      setDefaultPermissionsPath(defaultsPath)

      // Load workspace permissions if we have an active workspace
      if (activeWorkspaceId) {
        const workspace = await window.electronAPI.getWorkspacePermissionsConfig(activeWorkspaceId)
        setCustomConfig(workspace)
      }
    } catch (error) {
      console.error('Failed to load permissions:', error)
    } finally {
      setIsLoading(false)
    }
  }, [activeWorkspaceId])

  // Load on grant and reload when the workspace changes, but only after a grant was collected
  useEffect(() => {
    if (!granted) return
    void loadPermissions(granted)
  }, [granted, loadPermissions])

  // Listen for default permissions changes (file watcher); rereads go through the same gate
  useEffect(() => {
    if (!granted) return
    if (!window.electronAPI?.onDefaultPermissionsChanged) return

    const unsubscribe = window.electronAPI.onDefaultPermissionsChanged(async () => {
      const gate = settingsPageActionResult({
        pageId: 'permissions',
        action: 'config-read',
        source: 'native',
        granted,
      })
      if (!isClaimableLive(gate)) return
      // Reload default permissions when the file changes
      const { config: defaults } = await window.electronAPI.getDefaultPermissionsConfig()
      setDefaultConfig(defaults)
    })

    return unsubscribe
  }, [granted])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t("settings.permissions.title")} actions={<HeaderMenu route={routes.view.settings('permissions')} helpFeature="permissions" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {!granted ? (
                <SettingsSection title={t("settings.permissions.aboutPermissions")}>
                  <SettingsCard className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {t("settings.permissions.loadConfigDesc")}
                      </p>
                      <Button size="sm" onClick={() => setGranted(true)}>
                        {t("settings.permissions.loadConfig")}
                      </Button>
                    </div>
                  </SettingsCard>
                </SettingsSection>
              ) : isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* About Section */}
                  <SettingsSection title={t("settings.permissions.aboutPermissions")}>
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>
                          {t("settings.permissions.aboutText1")}
                        </p>
                        <p>
                          {t("settings.permissions.aboutText2")}
                        </p>
                        <p>
                          <button
                            type="button"
                            onClick={() => window.electronAPI?.openUrl(getDocUrl('permissions'))}
                            className="text-foreground/70 hover:text-foreground underline underline-offset-2"
                          >
                            {t("common.learnMore")}
                          </button>
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  {/* Default Permissions Section */}
                  <SettingsSection
                    title={t("settings.permissions.defaultPermissions")}
                    description={t("settings.permissions.defaultPermissionsDesc")}
                    action={
                      // EditPopover for AI-assisted default permissions editing
                      defaultPermissionsPath ? (
                        <EditPopover
                          trigger={<EditButton />}
                          {...getEditConfig('default-permissions', defaultPermissionsPath)}
                          secondaryAction={{
                            label: t("common.editFile"),
                            filePath: defaultPermissionsPath,
                          }}
                        />
                      ) : null
                    }
                  >
                    <SettingsCard className="p-0">
                      {defaultPermissionsData.length > 0 ? (
                        <PermissionsDataTable
                          data={defaultPermissionsData}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={t("settings.permissions.defaultPermissions")}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{t("settings.permissions.noDefaultPermissions")}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {t("settings.permissions.noDefaultPermissionsDesc")}
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  {/* Custom Permissions Section */}
                  <SettingsSection
                    title={t("settings.permissions.workspaceCustomizations")}
                    description={t("settings.permissions.workspaceCustomizationsDesc")}
                    action={
                      (() => {
                        // Get centralized edit config - all strings defined in EditPopover.tsx
                        const { context, example, displayLabel } = getEditConfig('workspace-permissions', activeWorkspace?.rootPath || '')
                        return (
                          <EditPopover
                            trigger={<EditButton />}
                            example={example}
                            context={context}
                            displayLabel={displayLabel}
                            secondaryAction={activeWorkspace ? {
                              label: t("common.editFile"),
                              filePath: `${activeWorkspace.rootPath}/permissions.json`,
                            } : undefined}
                          />
                        )
                      })()
                    }
                  >
                    <SettingsCard className="p-0">
                      {customPermissionsData.length > 0 ? (
                        <PermissionsDataTable
                          data={customPermissionsData}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={t("settings.permissions.workspaceCustomizations")}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{t("settings.permissions.noCustomPermissions")}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {t("settings.permissions.noCustomPermissionsDesc")}
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  {/* OpenClaw security audit (RX-TSK-0112) */}
                  <OpenClawAuditSection workspaceId={activeWorkspace?.id} />
                  <CommandGatewaySection workspaceId={activeWorkspace?.id} />
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
