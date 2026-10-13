import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {resolve} from 'node:path'
import {nodeBuiltinStubPlugin} from '../node-builtin-stub'
const root=import.meta.dirname,repository=resolve(root,'../../../../../../../../..')
// The dep-optimizer cache is isolated per fixture: several browser fixtures run
// concurrently in CI (scripts/test-all.ts --concurrency N), and a shared
// node_modules/.vite cache lets one server's re-optimization invalidate the dep
// chunks another server's page is still fetching (504 Outdated Optimize Dep /
// ERR_ABORTED on /@fs/.../.vite/deps/chunk-*.js), so the module graph never
// loads and the fixture never mounts. See the same pattern in
// fixtures/product-learning-results/vite.config.ts.
export default defineConfig({root,cacheDir:resolve(repository,'apps/electron/.vite-worktree/panel-workspace'),optimizeDeps:{entries:[resolve(root,'index.html')]},plugins:[nodeBuiltinStubPlugin(repository),react(),tailwindcss()],resolve:{alias:[{find:'@/context/AppShellContext',replacement:resolve(root,'context.tsx')},{find:/.*MainContentPanel$/,replacement:resolve(root,'content.tsx')},{find:'@',replacement:resolve(repository,'apps/electron/src/renderer')},{find:'react',replacement:resolve(repository,'node_modules/react')},{find:'react-dom',replacement:resolve(repository,'node_modules/react-dom')}],dedupe:['react','react-dom']},build:{target:'esnext'},server:{host:'127.0.0.1',strictPort:true,hmr:false,watch:null,fs:{allow:[repository]}}})
