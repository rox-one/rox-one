/** Only shell navigation ports are substituted; both production Knowledge consumers render unchanged. */
export const useNavigation=()=>({navigate:(route:string)=>(window as any).__knowledgeFixture.routes.push(route)})
export const useOptionalAppShellContext=()=>null
