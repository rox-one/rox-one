import { useSyncExternalStore } from 'react'

function subscribeProfile(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ui-profile'],
  })
  return () => observer.disconnect()
}

function readSuperEngineeringProfile(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.uiProfile === 'super-engineering'
}

/** True when theme preset set `html[data-ui-profile="super-engineering"]`. */
export function useSuperEngineeringProfile(): boolean {
  return useSyncExternalStore(subscribeProfile, readSuperEngineeringProfile, () => false)
}
