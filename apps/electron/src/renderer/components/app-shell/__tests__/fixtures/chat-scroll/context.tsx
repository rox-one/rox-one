import * as React from 'react'
export const FocusContext=React.createContext(true)
export const useAppShellContext=()=>({isFocusedPanel:React.useContext(FocusContext)})
export const useAuthenticatedReactionActor=()=>null
export const useFocusZone=()=>({zoneRef:React.useRef(null),isFocused:false})
export const useBackgroundTasks=()=>({tasks:[],killTask:()=>{}})
export const useContextualSuggestions=()=>{}
export const useTheme=()=>({isDark:false})
export const useNavigation=()=>({navigate:()=>{}})
export const SessionMemoryProposalLane=()=>null
export const MemoryProvenanceStrip=()=>null
export function ChatInputZone({inputProps}:any){return <div style={{height:42,flexShrink:0}}><button id="submit" onClick={()=>inputProps.onSubmit('Synthetic question')}>Send fixture message</button></div>}
