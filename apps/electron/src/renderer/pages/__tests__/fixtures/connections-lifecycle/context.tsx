import * as React from 'react'
const Context=React.createContext<any>({activeWorkspaceId:'workspace-a'})
export const AppShellProvider=({value,children}:{value:any;children:React.ReactNode})=><Context.Provider value={value}>{children}</Context.Provider>
export const useOptionalAppShellContext=()=>React.useContext(Context)
export const useAppShellContext=()=>React.useContext(Context)
export const useActiveWorkspace=()=>({id:React.useContext(Context).activeWorkspaceId})
