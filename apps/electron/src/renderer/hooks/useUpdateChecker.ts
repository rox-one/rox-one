/**
 * Update Checker Hook
 *
 * Manages auto-update state for the Electron app.
 * - Listens for update availability broadcasts from main process
 * - Tracks download progress
 * - Provides methods to check for updates and install
 * - Shows toast notification when update is ready
 * - Persistent dismissal across app restarts (per version)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UpdateInfo } from '../../shared/types'

interface UseUpdateCheckerResult {
  /** Current update info */
  updateInfo: UpdateInfo | null
  /** Whether an update is available */
  updateAvailable: boolean
  /** Whether update is currently downloading */
  isDownloading: boolean
  /** Whether update is ready to install */
  isReadyToInstall: boolean
  /** Download progress (0-100) */
  downloadProgress: number
  /** Check for updates manually */
  checkForUpdates: () => Promise<void>
  /** Install the downloaded update and restart */
  installUpdate: () => Promise<void>
}

// Toast ID for update notification (allows dismiss/update)
const UPDATE_TOAST_ID = 'update-available'
const MANUAL_UPDATE_TOAST_ID = 'manual-update-check'

export function useUpdateChecker(): UseUpdateCheckerResult {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  // Track if we've shown the toast for this version to avoid duplicates
  const shownToastVersionRef = useRef<string | null>(null)

  // Show toast notification when update is ready
  const showUpdateToast = useCallback((version: string, onInstall: () => void) => {
    // Don't show if already shown for this version in this session
    if (shownToastVersionRef.current === version) {
      return
    }
    shownToastVersionRef.current = version

    toast.info(t('toast.updateReady', { version }), {
      id: UPDATE_TOAST_ID,
      description: t('toast.restartToApply'),
      duration: 10000, // 10 seconds, then auto-dismiss
      action: {
        label: t('toast.restart'),
        onClick: onInstall,
      },
      onDismiss: () => {
        // Persist dismissal so we don't show again after app restart
        void window.electronAPI.dismissUpdate(version).catch(() => {})
      },
    })
  }, [t])

  // A native menu check broadcasts the same metadata as Settings Check Now.
  // Notify once per result so broadcast + RPC return do not duplicate it.
  const shownManualNoticeRef = useRef<{ notice: string; at: number } | null>(null)
  const showManualUpdateToast = useCallback((info: UpdateInfo) => {
    if (info.updateMode !== 'manual') return
    const notice = info.error ? `error:${info.error}`
      : info.available && info.releaseUrl ? info.releaseUrl : `current:${info.currentVersion}`
    const previous = shownManualNoticeRef.current
    if (previous?.notice === notice && Date.now() - previous.at < 1000) return
    shownManualNoticeRef.current = { notice, at: Date.now() }
    if (info.error) {
      toast.error(t('toast.failedToCheckUpdates'), { id: MANUAL_UPDATE_TOAST_ID, description: info.error })
      return
    }
    if (!info.available) {
      toast.success(t('toast.upToDate'), {
        id: MANUAL_UPDATE_TOAST_ID, description: t('toast.versionIsLatest', { version: info.currentVersion }), duration: 3000,
      })
      return
    }
    if (!info.releaseUrl) return
    toast.info(t('settings.about.manualUpdateAvailable', { defaultValue: 'A new ROX release is available', version: info.latestVersion }), {
      id: MANUAL_UPDATE_TOAST_ID,
      description: t('settings.about.manualUpdateDescription', { defaultValue: 'This build requires manual installation. Automatic installation is disabled.' }),
      action: { label: t('settings.about.openRelease', { defaultValue: 'Open release downloads' }),
        onClick: () => { void window.electronAPI.openUrl(info.releaseUrl!) } },
    })
  }, [t])

  // Install the update
  const installUpdate = useCallback(async () => {
    try {
      // Dismiss the update toast first
      toast.dismiss(UPDATE_TOAST_ID)
      toast.info(t('toast.installingUpdate'), {
        description: t('toast.appWillRestart'),
        duration: 5000,
      })
      await window.electronAPI.installUpdate()
    } catch (error) {
      console.error('[useUpdateChecker] Install failed:', error)
      toast.error(t('toast.failedToInstallUpdate'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    }
  }, [t])

  // Load initial state and check if update ready
  useEffect(() => {
    let active = true
    let revision = 0
    let notificationEpoch = 0
    const checkAndNotify = async (info: UpdateInfo) => {
      const epoch = ++notificationEpoch
      if (info.updateMode === 'manual') {
        showManualUpdateToast(info)
        return
      }
      if (!info.available || !info.latestVersion) return
      if (info.downloadState !== 'ready') return

      // Check if this version was dismissed
      const dismissedVersion = await window.electronAPI.getDismissedUpdateVersion()
      if (!active || epoch !== notificationEpoch) return
      if (dismissedVersion === info.latestVersion) {
        return
      }

      // Show toast for ready update
      showUpdateToast(info.latestVersion, installUpdate)
    }

    // Get initial update info
    void window.electronAPI.getUpdateInfo().then((info) => {
      if (!active || revision !== 0) return
      setUpdateInfo(info)
      void checkAndNotify(info).catch(() => {})
    }).catch(() => {
      if (active && revision === 0) setUpdateInfo(null)
    })

    // Subscribe to update availability changes
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      if (!active) return
      revision += 1
      setUpdateInfo(info)
      void checkAndNotify(info).catch(() => {})
    })

    // Subscribe to download progress updates
    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      if (!active) return
      revision += 1
      setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: progress } : prev)
    })

    return () => {
      active = false
      notificationEpoch += 1
      cleanupAvailable()
      cleanupProgress()
    }
  }, [showUpdateToast, showManualUpdateToast, installUpdate])

  // Check for updates manually
  const checkForUpdates = useCallback(async () => {
    try {
      shownManualNoticeRef.current = null // Explicit user checks may notify again.
      const info = await window.electronAPI.checkForUpdates()
      setUpdateInfo(info)

      if (info.updateMode === 'manual') {
        showManualUpdateToast(info)
        return
      }
      if (info.error) throw new Error(info.error)
      if (!info.available) {
        toast.success(t('toast.upToDate'), {
          description: t('toast.versionIsLatest', { version: info.currentVersion }),
          duration: 3000,
        })
      } else if (info.downloadState === 'ready' && info.latestVersion) {
        // If already ready, show toast (clear any previous dismissal since user explicitly checked)
        shownToastVersionRef.current = null // Reset so toast can show again
        showUpdateToast(info.latestVersion, installUpdate)
      }
    } catch (error) {
      console.error('[useUpdateChecker] Check failed:', error)
      toast.error(t('toast.failedToCheckUpdates'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    }
  }, [showUpdateToast, showManualUpdateToast, installUpdate, t])

  return {
    updateInfo,
    updateAvailable: updateInfo?.available ?? false,
    isDownloading: updateInfo?.downloadState === 'downloading',
    isReadyToInstall: updateInfo?.downloadState === 'ready',
    downloadProgress: updateInfo?.downloadProgress ?? 0,
    checkForUpdates,
    installUpdate,
  }
}
