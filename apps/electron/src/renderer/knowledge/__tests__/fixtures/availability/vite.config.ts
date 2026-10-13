import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {resolve} from 'node:path'
import {nodeBuiltinStubPlugin} from '../../../../components/app-shell/__tests__/fixtures/node-builtin-stub'
const root=import.meta.dirname,repository=resolve(root,'../../../../../../../..')
export default defineConfig({root,plugins:[nodeBuiltinStubPlugin(repository),react(),tailwindcss()],resolve:{alias:[{find:'@/contexts/NavigationContext',replacement:resolve(root,'context.tsx')},{find:'@/context/AppShellContext',replacement:resolve(root,'context.tsx')},{find:'@config',replacement:resolve(repository,'packages/shared/src/config')},{find:'@',replacement:resolve(repository,'apps/electron/src/renderer')},{find:'react',replacement:resolve(repository,'node_modules/react')},{find:'react-dom',replacement:resolve(repository,'node_modules/react-dom')}],dedupe:['react','react-dom']},build:{target:'esnext'},server:{host:'127.0.0.1',strictPort:true,hmr:false,watch:null,fs:{allow:[repository]}}})
