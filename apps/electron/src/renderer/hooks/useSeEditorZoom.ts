import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { seEditorZoomPercentAtom } from '@/atoms/workbench-layout'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'

/** Applies editor font scale for super.engineering profile (UI zoom stays on Electron zoom). */
export function useSeEditorZoom(): void {
  const se = useSuperEngineeringProfile()
  const percent = useAtomValue(seEditorZoomPercentAtom)
  useEffect(() => {
    const root = document.documentElement
    if (!se) {
      root.style.removeProperty('--se-editor-font-scale')
      return
    }
    root.style.setProperty('--se-editor-font-scale', String(percent / 100))
  }, [percent, se])
}
