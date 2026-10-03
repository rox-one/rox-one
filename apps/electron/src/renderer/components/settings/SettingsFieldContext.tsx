import * as React from 'react'

/** Connect a custom row's visible label to the control rendered in its slot. */
export interface SettingsFieldDescription {
  labelId?: string
  descriptionId?: string
}

export const SettingsFieldContext = React.createContext<SettingsFieldDescription>({})

export function useSettingsFieldDescription() {
  return React.useContext(SettingsFieldContext)
}

export function settingsDescriptionIds(...ids: Array<string | undefined | false>): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined
}
