/** Task-owned native acceptance state. Never imports or copies user data. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveConfig, addWorkspace } from '../packages/shared/src/config/storage'
import { writeAutoImportFile } from '../packages/server-core/src/handlers/rpc/session-foreign-auto-import-storage'
const base=process.env.ROX_CONFIG_DIR
if (!base || !base.includes('rox-navigation-native-20261004')) throw new Error('Isolated acceptance config required')
mkdirSync(base,{recursive:true})
saveConfig({workspaces:[],activeWorkspaceId:null,activeSessionId:null,setupDeferred:true,notificationsEnabled:false})
const workspace=addWorkspace({name:'ROX · проверка навигации',rootPath:join(base,'workspaces','navigation-check')})
writeAutoImportFile(workspace.rootPath,{enabled:false})
writeFileSync(join(base,'acceptance-workspace.json'),JSON.stringify({workspaceId:workspace.id,rootPath:workspace.rootPath,slug:workspace.slug},null,2)+'\n')
console.log(JSON.stringify({workspaceId:workspace.id,rootPath:workspace.rootPath,slug:workspace.slug}))
