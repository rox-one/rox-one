/**
 * AppearanceSettingsPage
 *
 * Visual customization settings: fonts, contrast, language, per-workspace
 * avatar colors, and CLI tool icon mappings. The Rox theme itself is fixed
 * and has no user-selectable mode or color theme.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import './AppearanceSettingsPage.css'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageCode } from '@rox/shared/i18n'
import type { ColumnDef } from '@tanstack/react-table'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useTheme, useAppTheme } from '@/context/ThemeContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes } from '@/lib/navigate'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { ToolIconMapping } from '../../../shared/types'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsMenuSelect,
  SettingsToggle,
} from '@/components/settings'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import * as storage from '@/lib/local-storage'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { ColorPicker } from '@/components/ui/color-picker'
import { workspaceAvatarColorsAtom } from '@/atoms/workspace-avatar-colors'
import { kanbanColumnColorsAtom, kanbanColumnStatusAtom, kanbanLivePulseAtom } from '@/atoms/kanban'
import { sessionMetaMapAtom, updateSessionMetaAtom } from '@/atoms/sessions'
import { Button } from '@/components/ui/button'
import { showBackgroundFinishedChipAtom } from '@/atoms/background-finished'
import { KANBAN_COLUMNS, resolveBoardColumns } from '@/components/app-shell/kanban/status-column'
import { isClaimableLive } from '@rox/core/rox2'
import { settingsPageActionResult } from './settings-rox2-surface'

function appearancePrefLive(): boolean {
  return isClaimableLive(
    settingsPageActionResult({ pageId: 'appearance', action: 'pref-write', source: 'native' }),
  )
}
import { DEFAULT_KANBAN_COLUMN_COLORS } from '@/components/app-shell/kanban/kanban-colors'
import type { BuiltInKanbanColumnId, KanbanColumnId } from '@/components/app-shell/kanban/types'
import {
  getDefaultKanbanBoardConfig,
  patchKanbanColumn,
  type KanbanBoardConfig,
} from '@rox/shared/kanban/browser'
import { setProjectColorTreatment, useProjectColorTreatment } from '@/hooks/useProjectColorTreatment'
import { PROJECT_COLOR_PALETTE, type ProjectColorTreatment } from '@/utils/project-colors'
import { Info_DataTable, SortableHeader } from '@/components/info/Info_DataTable'
import { Info_Badge } from '@/components/info/Info_Badge'
import { readDesktopAppearance, saveDesktopAppearance } from '@/lib/desktop-appearance'
import { WorkbenchChromeSettings } from './WorkbenchChromeSettings'
import { ConationShellSettings } from './ConationShellSettings'
import { ZenShellSettings } from './ZenShellSettings'
import { SuperEngineeringAppearanceSettings } from './SuperEngineeringAppearanceSettings'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleTrigger,
  AnimatedCollapsibleContent,
} from '@/components/ui/collapsible'
import {
  MATERIAL_CHAT_EFFECT_KINDS,
  MATERIAL_TEXTURE_KINDS,
  type MaterialChatEffectKind,
  type MaterialSettings,
  type MaterialTextureKind,
} from '@config/theme'
import {
  MATERIAL_CHAT_EFFECT_LABELS,
  MATERIAL_CONTENT_PANE_ROWS,
  MATERIAL_PRESETS,
  MATERIAL_SURFACE_ROWS,
  MATERIAL_TEXTURE_LABELS,
  effectiveBlur,
  effectiveChatEffect,
  effectiveDeepGlass,
  effectiveHaze,
  effectiveMattePercent,
  effectiveOpacityPercent,
  effectiveTexture,
  effectiveTint,
  materialEquals,
  parseMaterialImport,
  serializeMaterialExport,
  setChatEffect,
  setDeepGlass,
  setHaze,
  setMaterialEnabled,
  setMatte,
  setSurfaceBlur,
  setSurfaceOpacity,
  setTexture,
  setTint,
} from './material-settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'appearance',
}

// ============================================
// Tool Icons Table
// ============================================

/**
 * Column definitions for the tool icon mappings table.
 * Shows a preview icon, tool name, and the CLI commands that trigger it.
 */
const getToolIconColumns = (t: (key: string) => string): ColumnDef<ToolIconMapping>[] => [
  {
    accessorKey: 'iconDataUrl',
    header: () => <span className="p-1.5 pl-2.5">{t("settings.appearance.iconHeader")}</span>,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <img
          src={row.original.iconDataUrl}
          alt={row.original.displayName}
          className="w-5 h-5 object-contain"
        />
      </div>
    ),
    size: 60,
    enableSorting: false,
  },
  {
    accessorKey: 'displayName',
    header: ({ column }) => <SortableHeader column={column} title={t("settings.appearance.toolHeader")} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 font-medium">
        {row.original.displayName}
      </div>
    ),
    size: 150,
  },
  {
    accessorKey: 'commands',
    header: () => <span className="p-1.5 pl-2.5">{t("settings.appearance.commandsHeader")}</span>,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 flex flex-wrap gap-1">
        {row.original.commands.map(cmd => (
          <Info_Badge key={cmd} color="muted" className="font-mono">
            {cmd}
          </Info_Badge>
        ))}
      </div>
    ),
    meta: { fillWidth: true },
    enableSorting: false,
  },
]

// ============================================
// Material & effects (glass) section
// ============================================

/** Apply debounce for the material draft (control release / typing). */
const MATERIAL_APPLY_DEBOUNCE_MS = 200

interface MaterialSliderRowProps {
  label: string
  ariaLabel: string
  min: number
  max: number
  step: number
  value: number
  display: string
  disabled?: boolean
  onChange: (value: number) => void
}

function MaterialSliderRow({
  label,
  ariaLabel,
  min,
  max,
  step,
  value,
  display,
  disabled,
  onChange,
}: MaterialSliderRowProps) {
  return (
    <SettingsRow label={label}>
      <div className="material-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={ariaLabel}
          className="material-slider-input"
        />
        <span className="material-slider-value tabular-nums">{display}</span>
      </div>
    </SettingsRow>
  )
}

function MaterialGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="material-group">
      <h4 className="material-group-title">{title}</h4>
      <SettingsCard>{children}</SettingsCard>
    </div>
  )
}

function MaterialEffectsSection() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  // Display/base value: the preset theme merged with the app override.
  const committed = resolvedTheme.material ?? null
  // Persisted layer: the raw app-level override only. Edits must patch this
  // layer (never the merged view) so preset-owned fields are not baked into
  // theme.json on the first control change.
  const overrideMaterial = useAppTheme()?.material ?? null

  const setAppMaterial = window.electronAPI?.setAppMaterial
  const available = typeof setAppMaterial === 'function'
    && window.electronAPI?.getRuntimeEnvironment?.() === 'electron'

  const [draft, setDraft] = useState<MaterialSettings | null>(committed)
  const [saveFailed, setSaveFailed] = useState(false)
  const [importStatus, setImportStatus] = useState<'success' | 'error' | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const mountedRef = useRef(true)
  const timerRef = useRef<number | null>(null)
  const seqRef = useRef(0)
  const pendingRef = useRef(false)
  // Last value we optimistically displayed (or the last committed value); used
  // to ignore the echo of our own write while still adopting external changes.
  const lastSentRef = useRef<MaterialSettings | null>(committed)
  const committedRef = useRef<MaterialSettings | null>(committed)
  committedRef.current = committed
  const draftRef = useRef<MaterialSettings | null>(committed)
  draftRef.current = draft
  // Optimistic override layer: the raw override with our own unsaved patches
  // folded in, so rapid multi-field edits compose instead of clobbering.
  const overrideBaseRef = useRef<MaterialSettings | null>(overrideMaterial)
  const confirmedOverrideRef = useRef<MaterialSettings | null>(overrideMaterial)
  confirmedOverrideRef.current = overrideMaterial
  const importPendingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Adopt the raw override layer when it changes from outside our own write.
  useEffect(() => {
    if (pendingRef.current) return
    overrideBaseRef.current = overrideMaterial
  }, [overrideMaterial])

  useEffect(() => {
    if (pendingRef.current || materialEquals(committed, lastSentRef.current)) return
    lastSentRef.current = committed
    draftRef.current = committed
    setDraft(committed)
  }, [committed])

  const commit = useCallback((persist: MaterialSettings | null) => {
    if (typeof setAppMaterial !== 'function') return
    const seq = ++seqRef.current
    void setAppMaterial(persist).then(
      (overrides) => {
        if (seq !== seqRef.current) return
        pendingRef.current = false
        // `overrides` is the full app-theme override object; only its material
        // layer is our persisted layer (the preset material stays untouched).
        const value = overrides?.material ?? null
        overrideBaseRef.current = value
        if (importPendingRef.current) {
          importPendingRef.current = false
          if (mountedRef.current) setImportStatus('success')
        }
        if (mountedRef.current) setSaveFailed(false)
      },
      (error: unknown) => {
        if (seq !== seqRef.current) return
        pendingRef.current = false
        overrideBaseRef.current = confirmedOverrideRef.current
        const previous = committedRef.current
        lastSentRef.current = previous
        if (importPendingRef.current) {
          importPendingRef.current = false
          if (mountedRef.current) setImportStatus('error')
        }
        if (mountedRef.current) {
          draftRef.current = previous
          setDraft(previous)
          setSaveFailed(true)
        }
        if (error) console.warn('Failed to save material settings:', error)
      },
    )
  }, [setAppMaterial])

  const schedule = useCallback((
    persist: MaterialSettings | null,
    display: MaterialSettings | null,
    options?: { imported?: boolean },
  ) => {
    seqRef.current += 1          // a newer local intent supersedes in-flight echoes
    pendingRef.current = true
    importPendingRef.current = options?.imported === true
    setImportStatus(null)
    overrideBaseRef.current = persist
    draftRef.current = display
    setDraft(display)
    lastSentRef.current = display
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      commit(persist)
    }, MATERIAL_APPLY_DEBOUNCE_MS)
  }, [commit])

  // Apply a single-field patch to both layers: the raw override (persisted) and
  // the merged view (displayed optimistically).
  const applyPatch = useCallback((patch: (material: MaterialSettings | null) => MaterialSettings) => {
    schedule(patch(overrideBaseRef.current), patch(draftRef.current))
  }, [schedule])

  const handleExport = useCallback(() => {
    const text = serializeMaterialExport(draft, t('settings.appearance.material.exportName'))
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'rox-material.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [draft, t])

  const handleImportFile = useCallback((file: File) => {
    void file.text().then((text) => {
      const result = parseMaterialImport(text)
      if (!result.ok) {
        setImportStatus('error')
        return
      }
      // Wholesale replace of both layers; the success note is deferred until
      // the debounced write actually lands (commit).
      schedule(result.material, result.material, { imported: true })
    }).catch(() => {
      setImportStatus('error')
    })
  }, [schedule])

  const enabled = draft?.enabled ?? false
  const controlsDisabled = !available || !enabled
  const tint = effectiveTint(draft)
  const texture = effectiveTexture(draft)
  const haze = effectiveHaze(draft)
  const chatEffect = effectiveChatEffect(draft)
  const mattePercent = effectiveMattePercent(draft)

  return (
    <SettingsSection
      title={t('settings.appearance.material.title')}
      description={t('settings.appearance.material.description')}
    >
      <SettingsCard>
        <SettingsToggle
          label={t('settings.appearance.material.enabled')}
          description={t('settings.appearance.material.enabledDesc')}
          checked={enabled}
          onCheckedChange={(value) => applyPatch((base) => setMaterialEnabled(base, value))}
          disabled={!available}
        />
        <SettingsRow label={t('settings.appearance.material.presets')}>
          <div className="material-presets">
            {MATERIAL_PRESETS.map(preset => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={!available}
                onClick={() => schedule({ ...preset.material }, { ...preset.material })}
              >
                {t(preset.labelKey)}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!available}
              onClick={() => schedule(null, null)}
            >
              {t('settings.appearance.material.reset')}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label={t('settings.appearance.material.transfer')}>
          <div className="material-transfer">
            <Button type="button" variant="secondary" size="sm" disabled={!available} onClick={handleExport}>
              {t('settings.appearance.material.export')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!available}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('settings.appearance.material.import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              className="material-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) handleImportFile(file)
              }}
            />
          </div>
        </SettingsRow>
        {importStatus && (
          <p role="status" className={cn('material-note', importStatus === 'error' && 'material-note-error')}>
            {t(importStatus === 'error'
              ? 'settings.appearance.material.importError'
              : 'settings.appearance.material.importSuccess')}
          </p>
        )}
        {saveFailed && (
          <p role="alert" className="material-note material-note-error">
            {t('settings.appearance.material.saveError')}
          </p>
        )}
        {!available && (
          <p role="alert" className="material-note">
            {t('settings.appearance.material.unavailable')}
          </p>
        )}
      </SettingsCard>

      <div className="material-groups">
        <MaterialGroup title={t('settings.appearance.material.opacity')}>
          {MATERIAL_SURFACE_ROWS.map(row => {
            const value = effectiveOpacityPercent(draft, row.surface)
            const label = t(row.labelKey)
            return (
              <MaterialSliderRow
                key={row.surface}
                label={label}
                ariaLabel={label}
                min={0}
                max={100}
                step={1}
                value={value}
                display={`${value}%`}
                disabled={controlsDisabled}
                onChange={(next) => applyPatch((base) => setSurfaceOpacity(base, row.surface, next / 100))}
              />
            )
          })}
        </MaterialGroup>

        <MaterialGroup title={t('settings.appearance.material.blur')}>
          {MATERIAL_SURFACE_ROWS.map(row => {
            const value = effectiveBlur(draft, row.surface)
            const label = t(row.labelKey)
            return (
              <MaterialSliderRow
                key={row.surface}
                label={label}
                ariaLabel={label}
                min={0}
                max={64}
                step={1}
                value={value}
                display={`${value}px`}
                disabled={controlsDisabled}
                onChange={(next) => applyPatch((base) => setSurfaceBlur(base, row.surface, next))}
              />
            )
          })}
        </MaterialGroup>

        <MaterialGroup title={t('settings.appearance.material.tint')}>
          <MaterialSliderRow
            label={t('settings.appearance.material.tintHue')}
            ariaLabel={t('settings.appearance.material.tintHue')}
            min={-180}
            max={180}
            step={1}
            value={tint.hue}
            display={`${tint.hue}°`}
            disabled={controlsDisabled}
            onChange={(next) => applyPatch((base) => setTint(base, { hue: next }))}
          />
          <MaterialSliderRow
            label={t('settings.appearance.material.tintSaturation')}
            ariaLabel={t('settings.appearance.material.tintSaturation')}
            min={-100}
            max={100}
            step={1}
            value={tint.saturation}
            display={`${tint.saturation}%`}
            disabled={controlsDisabled}
            onChange={(next) => applyPatch((base) => setTint(base, { saturation: next }))}
          />
          <MaterialSliderRow
            label={t('settings.appearance.material.tintLightness')}
            ariaLabel={t('settings.appearance.material.tintLightness')}
            min={-30}
            max={30}
            step={1}
            value={tint.lightness}
            display={`${tint.lightness}%`}
            disabled={controlsDisabled}
            onChange={(next) => applyPatch((base) => setTint(base, { lightness: next }))}
          />
        </MaterialGroup>

        <MaterialGroup title={t('settings.appearance.material.texture')}>
          <SettingsRow label={t('settings.appearance.material.textureKind')}>
            <SettingsMenuSelect
              value={texture.kind}
              disabled={controlsDisabled}
              onValueChange={(value) => applyPatch((base) => setTexture(base, { kind: value as MaterialTextureKind }))}
              options={MATERIAL_TEXTURE_KINDS.map(kind => ({
                value: kind,
                label: t(MATERIAL_TEXTURE_LABELS[kind]),
              }))}
            />
          </SettingsRow>
          <MaterialSliderRow
            label={t('settings.appearance.material.textureIntensity')}
            ariaLabel={t('settings.appearance.material.textureIntensity')}
            min={0}
            max={1}
            step={0.01}
            value={texture.intensity}
            display={`${Math.round(texture.intensity * 100)}%`}
            disabled={controlsDisabled || texture.kind === 'none'}
            onChange={(next) => applyPatch((base) => setTexture(base, { intensity: next }))}
          />
          <MaterialSliderRow
            label={t('settings.appearance.material.textureScale')}
            ariaLabel={t('settings.appearance.material.textureScale')}
            min={0.5}
            max={3}
            step={0.1}
            value={texture.scale}
            display={`${texture.scale.toFixed(1)}×`}
            disabled={controlsDisabled || texture.kind === 'none'}
            onChange={(next) => applyPatch((base) => setTexture(base, { scale: next }))}
          />
        </MaterialGroup>

        <MaterialGroup title={t('settings.appearance.material.haze')}>
          <SettingsToggle
            label={t('settings.appearance.material.hazeEnabled')}
            checked={haze.enabled}
            disabled={controlsDisabled}
            onCheckedChange={(value) => applyPatch((base) => setHaze(base, { enabled: value }))}
          />
          <MaterialSliderRow
            label={t('settings.appearance.material.hazeIntensity')}
            ariaLabel={t('settings.appearance.material.hazeIntensity')}
            min={0}
            max={1}
            step={0.01}
            value={haze.intensity}
            display={`${Math.round(haze.intensity * 100)}%`}
            disabled={controlsDisabled || !haze.enabled}
            onChange={(next) => applyPatch((base) => setHaze(base, { intensity: next }))}
          />
          <MaterialSliderRow
            label={t('settings.appearance.material.matte')}
            ariaLabel={t('settings.appearance.material.matte')}
            min={0}
            max={100}
            step={1}
            value={mattePercent}
            display={`${mattePercent}%`}
            disabled={controlsDisabled}
            onChange={(next) => applyPatch((base) => setMatte(base, next / 100))}
          />
        </MaterialGroup>

        <MaterialGroup title={t('settings.appearance.material.chatEffect')}>
          <SettingsRow label={t('settings.appearance.material.chatEffectKind')}>
            <SettingsMenuSelect
              value={chatEffect.kind}
              disabled={controlsDisabled}
              onValueChange={(value) => applyPatch((base) => setChatEffect(base, { kind: value as MaterialChatEffectKind }))}
              options={MATERIAL_CHAT_EFFECT_KINDS.map(kind => ({
                value: kind,
                label: t(MATERIAL_CHAT_EFFECT_LABELS[kind]),
              }))}
            />
          </SettingsRow>
          <MaterialSliderRow
            label={t('settings.appearance.material.chatEffectIntensity')}
            ariaLabel={t('settings.appearance.material.chatEffectIntensity')}
            min={0}
            max={1}
            step={0.01}
            value={chatEffect.intensity}
            display={`${Math.round(chatEffect.intensity * 100)}%`}
            disabled={controlsDisabled || chatEffect.kind === 'none'}
            onChange={(next) => applyPatch((base) => setChatEffect(base, { intensity: next }))}
          />
        </MaterialGroup>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="material-group">
          <CollapsibleTrigger className="material-group-trigger" disabled={!available}>
            <span className="material-group-title">{t('settings.appearance.material.advanced')}</span>
            <ChevronDown
              className={cn('material-chevron', advancedOpen && 'material-chevron-open')}
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <AnimatedCollapsibleContent isOpen={advancedOpen}>
            <SettingsCard>
              <div className="material-group-heading">
                <div className="material-group-title">{t('settings.appearance.material.deepGlass')}</div>
                <p className="material-group-hint">{t('settings.appearance.material.deepGlassDesc')}</p>
              </div>
              {MATERIAL_CONTENT_PANE_ROWS.map(row => (
                <SettingsToggle
                  key={row.pane}
                  label={t(row.labelKey)}
                  checked={effectiveDeepGlass(draft, row.pane)}
                  disabled={controlsDisabled}
                  onCheckedChange={(value) => applyPatch((base) => setDeepGlass(base, row.pane, value))}
                />
              ))}
            </SettingsCard>
          </AnimatedCollapsibleContent>
        </Collapsible>
      </div>
    </SettingsSection>
  )
}

// ============================================
// Main Component
// ============================================

export default function AppearanceSettingsPage() {
  const { t, i18n } = useTranslation()
  const toolIconColumns = useMemo(() => getToolIconColumns(t), [t])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const {
    font,
    setFont,
    chatFont,
    setChatFont,
    terminalFont,
    setTerminalFont,
    contrast,
    setContrast,
    activeWorkspaceId,
    themeLoadError,
    themeResolvedFrom,
  } = useTheme()
  const { workspaces, sessionStatuses } = useAppShellContext()
  // Kanban column assignment lives on session metadata; used to migrate tiles when a
  // custom column is removed from settings (mirrors the board's own removal path).
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)

  // Fetch workspace icons as data URLs (file:// URLs don't work in renderer)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  // Tool icon mappings loaded from main process
  const [toolIcons, setToolIcons] = useState<ToolIconMapping[]>([])

  // Tool icon config location resolved by main (real config dir; no renderer guessing)
  const [toolIconsConfig, setToolIconsConfig] = useState<{ dir: string; configPath: string } | null>(null)

  // Connection icon visibility toggle
  const [showConnectionIcons, setShowConnectionIcons] = useState(() =>
    storage.get(storage.KEYS.showConnectionIcons, true)
  )
  const handleConnectionIconsChange = useCallback((checked: boolean) => {
    if (!appearancePrefLive()) return
    setShowConnectionIcons(checked)
    storage.set(storage.KEYS.showConnectionIcons, checked)
  }, [])
  const handleLanguageChange = useCallback((value: string) => {
    if (!appearancePrefLive()) return
    void (async () => {
      try {
        console.info('[i18n] Appearance dropdown change', {
          from: i18n.resolvedLanguage ?? null,
          to: value,
        })
        await i18n.changeLanguage(value)
        await window.electronAPI?.changeLanguage?.(value)
      } catch (error) {
        console.error('Failed to change language:', error)
      }
    })()
  }, [i18n])

  // Project color treatment in the SessionList
  const projectColorTreatment = useProjectColorTreatment()
  const handleProjectColorTreatmentChange = useCallback((value: string) => {
    if (!appearancePrefLive()) return
    setProjectColorTreatment(value as ProjectColorTreatment)
  }, [])

  // Per-workspace avatar color overrides (persisted in localStorage)
  const [workspaceAvatarColors, setWorkspaceAvatarColors] = useAtom(workspaceAvatarColorsAtom)
  const setWorkspaceAvatarColor = useCallback((workspaceId: string, hex: string) => {
    setWorkspaceAvatarColors(prev => ({ ...prev, [workspaceId]: hex }))
  }, [setWorkspaceAvatarColors])
  const clearWorkspaceAvatarColor = useCallback((workspaceId: string) => {
    setWorkspaceAvatarColors(prev => {
      const next = { ...prev }
      delete next[workspaceId]
      return next
    })
  }, [setWorkspaceAvatarColors])

  // Kanban board appearance — source of truth is workspace kanban/config.json
  // via getKanbanConfig/setKanbanConfig. Atoms remain an optional local mirror.
  const [kanbanBoardConfig, setKanbanBoardConfig] = useState<KanbanBoardConfig | null>(null)
  const kanbanBoardConfigRef = useRef<KanbanBoardConfig | null>(null)
  kanbanBoardConfigRef.current = kanbanBoardConfig

  const [, setKanbanColumnColors] = useAtom(kanbanColumnColorsAtom)
  const [, setKanbanColumnStatus] = useAtom(kanbanColumnStatusAtom)

  const syncKanbanAtomsFromConfig = useCallback(
    (cfg: KanbanBoardConfig) => {
      const colors: Partial<Record<KanbanColumnId, string>> = {}
      const statuses: Partial<Record<KanbanColumnId, string>> = {}
      for (const col of cfg.columns) {
        const id = col.id as KanbanColumnId
        if (col.color) colors[id] = col.color
        if (col.dropStatusId) statuses[id] = col.dropStatusId
      }
      setKanbanColumnColors(colors)
      setKanbanColumnStatus(statuses)
    },
    [setKanbanColumnColors, setKanbanColumnStatus],
  )

  useEffect(() => {
    if (!activeWorkspaceId) {
      setKanbanBoardConfig(null)
      return
    }
    const remoteWorkspaceId = workspaces.find(w => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId
    let cancelled = false
    void window.electronAPI.getKanbanConfig(activeWorkspaceId).then(
      cfg => {
        if (cancelled) return
        setKanbanBoardConfig(cfg)
        syncKanbanAtomsFromConfig(cfg)
      },
      () => {
        if (!cancelled) setKanbanBoardConfig(getDefaultKanbanBoardConfig())
      },
    )
    const unsub = window.electronAPI.onKanbanConfigChanged?.((wsId, cfg) => {
      if (wsId !== activeWorkspaceId && wsId !== remoteWorkspaceId) return
      setKanbanBoardConfig(cfg)
      syncKanbanAtomsFromConfig(cfg)
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [activeWorkspaceId, workspaces, syncKanbanAtomsFromConfig])

  const persistKanbanConfig = useCallback(
    async (next: KanbanBoardConfig) => {
      if (!appearancePrefLive()) return
      setKanbanBoardConfig(next)
      kanbanBoardConfigRef.current = next
      syncKanbanAtomsFromConfig(next)
      if (!activeWorkspaceId) return
      try {
        const saved = await window.electronAPI.setKanbanConfig(activeWorkspaceId, next)
        setKanbanBoardConfig(saved)
        kanbanBoardConfigRef.current = saved
        syncKanbanAtomsFromConfig(saved)
      } catch (error) {
        console.error('Failed to save kanban board config:', error)
      }
    },
    [activeWorkspaceId, syncKanbanAtomsFromConfig],
  )

  const setKanbanColumnColor = useCallback(
    (column: KanbanColumnId, hex: string) => {
      const base = kanbanBoardConfigRef.current ?? getDefaultKanbanBoardConfig()
      void persistKanbanConfig(patchKanbanColumn(base, column, { color: hex }))
    },
    [persistKanbanConfig],
  )
  const resetKanbanColumnColor = useCallback(
    (column: KanbanColumnId) => {
      const base = kanbanBoardConfigRef.current ?? getDefaultKanbanBoardConfig()
      const stock = DEFAULT_KANBAN_COLUMN_COLORS[column as BuiltInKanbanColumnId]
      void persistKanbanConfig(
        patchKanbanColumn(base, column, {
          color: stock ?? undefined,
        }),
      )
    },
    [persistKanbanConfig],
  )
  const [kanbanLivePulse, setKanbanLivePulse] = useAtom(kanbanLivePulseAtom)

  // Per-column status applied when a task is dragged into that column. Empty
  // selection ('') clears the override (built-ins normalize back to column id).
  const setColumnStatus = useCallback(
    (column: KanbanColumnId, statusId: string) => {
      const base = kanbanBoardConfigRef.current ?? getDefaultKanbanBoardConfig()
      void persistKanbanConfig(
        patchKanbanColumn(base, column, {
          dropStatusId: statusId || undefined,
        }),
      )
    },
    [persistKanbanConfig],
  )
  const columnStatusOptions = useMemo(
    () => [
      { value: '', label: t("settings.appearance.kanbanColumnStatusNone") },
      ...(sessionStatuses ?? []).map(s => ({ value: s.id, label: s.label })),
    ],
    [sessionStatuses, t]
  )

  // Effective board columns: built-ins merged with custom columns from the workspace config.
  const boardColumns = useMemo(() => resolveBoardColumns(kanbanBoardConfig), [kanbanBoardConfig])

  const addKanbanColumn = useCallback(() => {
    const base = kanbanBoardConfigRef.current ?? getDefaultKanbanBoardConfig()
    void persistKanbanConfig({
      ...base,
      columns: [
        ...base.columns,
        {
          id: `col-${crypto.randomUUID().slice(0, 8)}`,
          label: t('kanban.column.newColumnName'),
          isBuiltIn: false,
          promptEnabled: false,
          prompt: '',
        },
      ],
    })
  }, [persistKanbanConfig, t])

  const removeKanbanColumn = useCallback(
    (columnId: KanbanColumnId) => {
      const base = kanbanBoardConfigRef.current ?? getDefaultKanbanBoardConfig()
      const target = base.columns.find(c => c.id === columnId)
      if (!target || target.isBuiltIn) return
      const columns = base.columns.filter(c => c.id !== columnId)
      const fallbackId = columns[0]?.id
      if (!fallbackId) return
      // Move any tiles off the removed column so they stay on the board.
      for (const meta of sessionMetaMap.values()) {
        if (meta.kanbanColumn !== columnId) continue
        updateSessionMeta(meta.id, { kanbanColumn: fallbackId })
        void window.electronAPI.sessionCommand(meta.id, {
          type: 'setKanbanColumn',
          column: fallbackId,
        })
      }
      void persistKanbanConfig({ ...base, columns })
    },
    [persistKanbanConfig, sessionMetaMap, updateSessionMeta],
  )
  // Turn activity cards: default expansion state (persisted in localStorage)
  const [turnActivitiesExpandedByDefault, setTurnActivitiesExpandedByDefault] = useState(() =>
    storage.get(storage.KEYS.turnActivitiesExpandedByDefault, false)
  )
  const handleTurnActivitiesDefaultChange = useCallback((value: string) => {
    if (!appearancePrefLive()) return
    const expanded = value === 'expanded'
    setTurnActivitiesExpandedByDefault(expanded)
    storage.set(storage.KEYS.turnActivitiesExpandedByDefault, expanded)
    window.dispatchEvent(new CustomEvent(storage.EVENTS.turnActivitiesExpandedByDefaultChanged, { detail: expanded }))
  }, [])

  // Default zoom level (persisted in config.json and applied to every app window)
  const [defaultZoomLevel, setDefaultZoomLevel] = useState(90)
  const [desktopZoomAvailable, setDesktopZoomAvailable] = useState(false)
  const [savingZoom, setSavingZoom] = useState(false)
  useEffect(() => {
    return readDesktopAppearance(window.electronAPI, () => window.electronAPI.getDefaultZoomLevel(), level => {
      setDefaultZoomLevel(level)
      setDesktopZoomAvailable(true)
    }, error => { setDesktopZoomAvailable(false); if (error) console.warn('Desktop zoom setting unavailable:', error) })
  }, [])
  const handleDefaultZoomLevelChange = useCallback(async (level: number) => {
    if (!appearancePrefLive() || !desktopZoomAvailable || savingZoom) return
    setSavingZoom(true)
    await saveDesktopAppearance(window.electronAPI, () => window.electronAPI.setDefaultZoomLevel(level), () => setDefaultZoomLevel(level),
      error => { setDesktopZoomAvailable(false); if (error) console.warn('Failed to save desktop zoom:', error) }, () => !mounted.current)
    if (mounted.current) setSavingZoom(false)
  }, [desktopZoomAvailable, savingZoom])

  // "Background session finished" chip toggle (renderer-only appearance pref,
  // persisted in localStorage via atomWithStorage — read by App.tsx + ChatPage).
  const [showBackgroundFinishedChip, setShowBackgroundFinishedChip] = useAtom(showBackgroundFinishedChipAtom)

  // Rich tool descriptions toggle (persisted in config.json, read by SDK subprocess)
  const [richToolDescriptions, setRichToolDescriptions] = useState(true)
  const [desktopToolDescriptionsAvailable, setDesktopToolDescriptionsAvailable] = useState(false)
  const [savingToolDescriptions, setSavingToolDescriptions] = useState(false)
  useEffect(() => {
    return readDesktopAppearance(window.electronAPI, () => window.electronAPI.getRichToolDescriptions(), value => {
      setRichToolDescriptions(value)
      setDesktopToolDescriptionsAvailable(true)
    }, error => { setDesktopToolDescriptionsAvailable(false); if (error) console.warn('Desktop tool descriptions unavailable:', error) })
  }, [])
  const handleRichToolDescriptionsChange = useCallback(async (checked: boolean) => {
    if (!appearancePrefLive() || !desktopToolDescriptionsAvailable || savingToolDescriptions) return
    setSavingToolDescriptions(true)
    await saveDesktopAppearance(window.electronAPI, () => window.electronAPI.setRichToolDescriptions(checked), () => setRichToolDescriptions(checked),
      error => { setDesktopToolDescriptionsAvailable(false); if (error) console.warn('Failed to save desktop tool descriptions:', error) }, () => !mounted.current)
    if (mounted.current) setSavingToolDescriptions(false)
  }, [desktopToolDescriptionsAvailable, savingToolDescriptions])


  // Load tool icon mappings and the real config location from main on mount
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const config = await window.electronAPI.getToolIconMappings?.()
        if (!config) return
        setToolIcons(config.mappings)
        setToolIconsConfig({ dir: config.dir, configPath: config.configPath })
      } catch (error) {
        console.error('Failed to load tool icon mappings:', error)
      }
    }
    load()
  }, [])

  return (
    <div className="appearance-settings-page flex h-full min-h-0 min-w-0 flex-col">
      <PanelHeader
        title={t("settings.appearance.title")}
        actions={<HeaderMenu route={routes.view.settings('appearance')} helpFeature="themes" />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="appearance-settings-content px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">

              {/* Display & accessibility. The Rox theme is fixed, so there is
                  no light/dark or color theme picker. */}
              <SettingsSection title={t("settings.appearance.display")}>
                <SettingsCard>
                  <SettingsRow
                    label={t("settings.appearance.contrast")}
                    description={t("settings.appearance.contrastDesc")}
                  >
                    <SettingsSegmentedControl
                      value={contrast}
                      onValueChange={(value) => {
                        if (!appearancePrefLive()) return
                        setContrast(value)
                      }}
                      options={[
                        { value: 'system', label: t("settings.appearance.contrastSystem") },
                        { value: 'normal', label: t("settings.appearance.contrastNormal") },
                        { value: 'high', label: t("settings.appearance.contrastHigh") },
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={t("settings.appearance.fontUi")}
                    description={t("settings.appearance.fontUiDesc")}
                  >
                    <SettingsSegmentedControl
                      value={font}
                      onValueChange={(value) => {
                        if (!appearancePrefLive()) return
                        setFont(value as typeof font)
                      }}
                      options={[
                        { value: 'rox', label: t("settings.appearance.fontArialNarrow") },
                        { value: 'inter', label: t("settings.appearance.fontInter") },
                        { value: 'system', label: t("settings.appearance.fontSystem") },
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={t("settings.appearance.fontChat")}
                    description={t("settings.appearance.fontChatDesc")}
                  >
                    <SettingsSegmentedControl
                      value={chatFont}
                      onValueChange={(value) => {
                        if (!appearancePrefLive()) return
                        setChatFont(value as typeof chatFont)
                      }}
                      options={[
                        { value: 'rox', label: t("settings.appearance.fontArialNarrow") },
                        { value: 'inter', label: t("settings.appearance.fontInter") },
                        { value: 'system', label: t("settings.appearance.fontSystem") },
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={t("settings.appearance.fontTerminal")}
                    description={t("settings.appearance.fontTerminalDesc")}
                  >
                    <SettingsSegmentedControl
                      value={terminalFont}
                      onValueChange={(value) => {
                        if (!appearancePrefLive()) return
                        setTerminalFont(value as typeof terminalFont)
                      }}
                      options={[
                        { value: 'rox', label: t("settings.appearance.fontRox") },
                        { value: 'jetbrains', label: t("settings.appearance.fontJetbrains") },
                        { value: 'system', label: t("settings.appearance.fontSystem") },
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow label={t("settings.appearance.language")}>
                    <SettingsMenuSelect
                      value={(i18n.resolvedLanguage ?? i18n.language) as LanguageCode}
                      onValueChange={handleLanguageChange}
                      options={Object.entries(LANGUAGES).map(([code, config]) => ({
                        value: code,
                        label: config.nativeName,
                      }))}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={t("settings.appearance.turnActivities")}
                    description={t("settings.appearance.turnActivitiesDesc")}
                  >
                    <SettingsSegmentedControl
                      value={turnActivitiesExpandedByDefault ? 'expanded' : 'collapsed'}
                      onValueChange={handleTurnActivitiesDefaultChange}
                      options={[
                        { value: 'collapsed', label: t("settings.appearance.turnActivitiesCollapsed") },
                        { value: 'expanded', label: t("settings.appearance.turnActivitiesExpanded") },
                      ]}
                    />
                  </SettingsRow>
                </SettingsCard>
                {themeLoadError && (
                  <p className="mt-2 text-xs text-info">
                    {themeLoadError === 'THEME_SAVE_FAILED' ? t("settings.appearance.themeSaveFailed") : <>{t("settings.appearance.themeWarning")} {themeLoadError} ({themeResolvedFrom === 'fallback' ? t("settings.appearance.usingBundledFallback") : t("settings.appearance.usingDefaultTheme")})</>}
                  </p>
                )}
              </SettingsSection>

              {/* Workspace appearance — avatar colors only; theme overrides are
                  disabled because the Rox theme is fixed. */}
              {workspaces.length > 0 && (
                <SettingsSection title={t("settings.appearance.workspaceAppearance")}>
                  <SettingsCard>
                    {workspaces.map((workspace) => (
                      <SettingsRow
                        key={workspace.id}
                        label={
                          <div className="flex items-center gap-2">
                            <ColorPicker
                              value={workspaceAvatarColors[workspace.id] || ''}
                              onChange={(hex) => setWorkspaceAvatarColor(workspace.id, hex)}
                              onClear={() => clearWorkspaceAvatarColor(workspace.id)}
                              clearLabel={t("settings.appearance.workspaceAvatarReset")}
                              presets={PROJECT_COLOR_PALETTE}
                              ariaLabel={t("settings.appearance.workspaceAvatarColor")}
                              trigger={
                                <button
                                  type="button"
                                  className="cursor-pointer rounded hover:opacity-80 transition-opacity"
                                  aria-label={t("settings.appearance.workspaceAvatarColor")}
                                >
                                  <WorkspaceAvatar
                                    workspaceId={workspace.id}
                                    workspaceName={workspace.name}
                                    src={workspaceIconMap.get(workspace.id)}
                                    className="w-4 h-4 rounded"
                                  />
                                </button>
                              }
                            />
                            <span>{workspace.name}</span>
                          </div>
                        }
                      />
                    ))}
                  </SettingsCard>
                </SettingsSection>
              )}

              {/* Interface */}
              <SettingsSection title={t("settings.appearance.interface")}>
                <SettingsCard>
                  <SettingsRow
                    label={t("settings.appearance.defaultZoomLevel")}
                    description={t("settings.appearance.defaultZoomLevelDesc")}
                  >
                    <div className="flex items-center gap-3 w-64">
                      <input
                        type="range"
                        min={50}
                        max={150}
                        step={10}
                        value={defaultZoomLevel}
                        disabled={!desktopZoomAvailable || savingZoom}
                        onChange={(event) => handleDefaultZoomLevelChange(Number(event.target.value))}
                        className="w-44 accent-primary"
                        aria-label={t("settings.appearance.defaultZoomLevel")}
                      />
                      <span className="w-12 text-right text-sm font-medium tabular-nums">
                        {defaultZoomLevel}%
                      </span>
                    </div>
                  </SettingsRow>
                  <SettingsToggle
                    label={t("settings.appearance.connectionIcons")}
                    description={t("settings.appearance.connectionIconsDesc")}
                    checked={showConnectionIcons}
                    onCheckedChange={handleConnectionIconsChange}
                  />
                  <SettingsToggle
                    label={t("settings.appearance.richToolDescriptions")}
                    description={t("settings.appearance.richToolDescriptionsDesc")}
                    checked={richToolDescriptions}
                    onCheckedChange={handleRichToolDescriptionsChange}
                    disabled={!desktopToolDescriptionsAvailable || savingToolDescriptions}
                  />
                  <SettingsToggle
                    label={t("settings.appearance.backgroundFinishedChip")}
                    description={t("settings.appearance.backgroundFinishedChipDesc")}
                    checked={showBackgroundFinishedChip}
                    onCheckedChange={(checked) => {
                      if (!appearancePrefLive()) return
                      setShowBackgroundFinishedChip(checked)
                    }}
                  />
                  <SettingsRow
                    label={t("settings.appearance.projectColorTreatment")}
                    description={t("settings.appearance.projectColorTreatmentDesc")}
                  >
                    <SettingsMenuSelect
                      value={projectColorTreatment}
                      onValueChange={handleProjectColorTreatmentChange}
                      options={[
                        { value: 'stripe', label: t("settings.appearance.projectColorStripe") },
                        { value: 'stripe-tint', label: t("settings.appearance.projectColorStripeTint") },
                      ]}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              <MaterialEffectsSection />

              <SuperEngineeringAppearanceSettings />
              <ZenShellSettings />
              <WorkbenchChromeSettings />
              <ConationShellSettings />

              {/* Kanban board — column colors + live-pulse toggle */}
              <SettingsSection
                title={t("settings.appearance.kanbanBoard")}
                description={t("settings.appearance.kanbanBoardDesc")}
              >
                <SettingsCard>
                  {KANBAN_COLUMNS.map(column => {
                    const cfgCol = kanbanBoardConfig?.columns.find(c => c.id === column.id)
                    const stock = DEFAULT_KANBAN_COLUMN_COLORS[column.id]
                    const merged = cfgCol?.color ?? stock
                    const isCustom = Boolean(cfgCol?.color && cfgCol.color !== stock)
                    return (
                      <SettingsRow key={column.id} label={t(column.labelKey)}>
                        <ColorPicker
                          value={merged}
                          onChange={(hex) => setKanbanColumnColor(column.id, hex)}
                          onClear={isCustom ? () => resetKanbanColumnColor(column.id) : undefined}
                          clearLabel={t("settings.appearance.kanbanColumnColorReset")}
                          presets={PROJECT_COLOR_PALETTE}
                          ariaLabel={t("settings.appearance.kanbanColumnColor", { column: t(column.labelKey) })}
                          align="end"
                        />
                      </SettingsRow>
                    )
                  })}
                  <SettingsToggle
                    label={t("settings.appearance.kanbanLivePulse")}
                    description={t("settings.appearance.kanbanLivePulseDesc")}
                    checked={kanbanLivePulse}
                    onCheckedChange={(checked) => {
                      if (!appearancePrefLive()) return
                      setKanbanLivePulse(checked)
                    }}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Kanban status automation — status applied on drag into a column */}
              <SettingsSection
                title={t("settings.appearance.kanbanColumnStatus")}
                description={t("settings.appearance.kanbanColumnStatusDesc")}
                action={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={addKanbanColumn}
                    aria-label={t("kanban.column.add")}
                    title={t("kanban.column.add")}
                  >
                    <Plus />
                  </Button>
                }
              >
                <SettingsCard>
                  {boardColumns.map(column => {
                    const label = column.name ?? (column.labelKey ? t(column.labelKey) : column.id)
                    const dropStatusId = column.dropStatusId ?? ''
                    return (
                      <SettingsRow key={column.id} label={label}>
                        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center">
                          <SettingsMenuSelect
                            value={columnStatusOptions.some(o => o.value === dropStatusId) ? dropStatusId : ''}
                            onValueChange={(value) => setColumnStatus(column.id, value)}
                            options={columnStatusOptions}
                          />
                          <input
                            type="text"
                            className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-foreground/10 bg-transparent px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-accent"
                            placeholder={t('settings.appearance.kanbanColumnStatusCustom')}
                            value={dropStatusId}
                            onChange={(e) => setColumnStatus(column.id, e.target.value)}
                            aria-label={t('settings.appearance.kanbanColumnStatusCustom')}
                          />
                          {!column.isBuiltIn && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground"
                              onClick={() => removeKanbanColumn(column.id)}
                              aria-label={t('kanban.column.remove')}
                              title={t('kanban.column.remove')}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </SettingsRow>
                    )
                  })}
                </SettingsCard>
              </SettingsSection>

              {/* Tool Icons — shows the command → icon mapping used in turn cards */}
              <SettingsSection
                title={t("settings.appearance.toolIcons")}
                description={t("settings.appearance.toolIconsDesc")}
                action={
                  toolIconsConfig ? (
                    <EditPopover
                      trigger={<EditButton />}
                      {...getEditConfig('edit-tool-icons', toolIconsConfig.dir)}
                      secondaryAction={{
                        label: t("settings.appearance.editFile"),
                        filePath: toolIconsConfig.configPath,
                      }}
                    />
                  ) : undefined
                }
              >
                <SettingsCard>
                  <Info_DataTable
                    columns={toolIconColumns}
                    data={toolIcons}
                    searchable={{ placeholder: t("settings.appearance.searchTools") }}
                    maxHeight={480}
                    emptyContent={t("settings.appearance.noToolIcons")}
                  />
                </SettingsCard>
              </SettingsSection>

            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
