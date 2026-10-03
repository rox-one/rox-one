export const TEAM_FLAG = { mentions: 'synthetic-disabled-team' }
export const useTeamFlag = () => false
const state = {}
export const useTeamState = () => state
export const readTeamState = () => state
export const dispatchTeam = () => true
export const teamActionContext = () => ({})
export const useTeamRoster = () => ({ sync: { state: 'disconnected' }, identityAuthority: 'none', identityIssuer: null, selfUserId: null, members: [] })
