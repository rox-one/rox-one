import { atom } from 'jotai'
export const sessionMetaMapAtom = atom(new Map())
const team = {}
export const useTeamState = () => team
export const useTeamRoster = () => ({ org: null, members: [], selfUserId: null })
const automations = { automations: [], automationTestResults: {}, handleTestAutomation() {} }
export const useAutomations = () => automations
