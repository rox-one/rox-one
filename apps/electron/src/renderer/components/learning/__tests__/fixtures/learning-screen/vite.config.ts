import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {resolve} from 'node:path'
const root=import.meta.dirname,repository=resolve(root,'../../../../../../../../..'),shimId='virtual:learning-app-shell-shim'
// Real ShellSidebarPortal reads `useOptionalAppShellContext`; the production
// AppShellContext pulls jotai atoms and the whole shell, so the fixture serves a
// minimal context shim from a virtual module and imports the REAL LearningScreen.
const shimSource=['export const useOptionalAppShellContext = () => null','export const useAppShellContext = () => ({})','export const useActiveWorkspace = () => null',''].join('\n')
export default defineConfig({root,plugins:[{name:'learning-screen-app-shell-shim',enforce:'pre',resolveId(id){return id==='@/context/AppShellContext'?shimId:null},load(id){return id===shimId?shimSource:null}},react(),tailwindcss()],resolve:{alias:[{find:'@rox/shared',replacement:resolve(repository,'packages/shared/src')},{find:'@',replacement:resolve(repository,'apps/electron/src/renderer')},{find:'react-dom',replacement:resolve(repository,'node_modules/react-dom')},{find:'react',replacement:resolve(repository,'node_modules/react')}],dedupe:['react','react-dom']},server:{host:'127.0.0.1',strictPort:true,hmr:false,watch:null,fs:{allow:[repository]}}})