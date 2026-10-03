import * as React from 'react'
const Context = React.createContext<any>({ activeWorkspaceId: 'workspace-a', isFocusedPanel: true })
export const AppShellProvider = ({value,children}:{value:any;children:React.ReactNode}) => <Context.Provider value={value}>{children}</Context.Provider>
export const useAppShellContext = () => React.useContext(Context)
