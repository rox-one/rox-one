import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../')
const { build } = await import(root + '/node_modules/esbuild/lib/main.js')
const mocks = {
  '@/context/AppShellContext': `export const useActiveWorkspace=()=>({id:window.tasksFixture.workspace});export const useOptionalAppShellContext=()=>null;`,
  '@/hooks/useProjects': `export const useProjects=()=>({projects:[]});`,
  '@/atoms/sessions': `import {atom} from 'jotai';export const sessionMetaMapAtom=atom(new Map());`,
  '@/actions': `export const useAction=()=>{};`,
  '@/components/calendar/CalendarStatusStrip': `export const CalendarStatusStrip=()=>null;`,
  'sonner': `export const toast=Object.assign((text)=>window.tasksFixture.toasts.push(['success',text]),{error:text=>window.tasksFixture.toasts.push(['error',text])});`,
  '@/lib/navigate': `export {routes} from ${JSON.stringify(root+'/apps/electron/src/shared/routes.ts')};export const navigate=route=>window.tasksFixture.navigations.push(route);`,
  '@rox/ui': `import React from 'react';export {PremiumMenuSelect} from ${JSON.stringify(root+'/packages/ui/src/components/ui/PremiumMenuSelect.tsx')};export const Markdown=props=>React.createElement('div',null,props.children);`,
}
const result = await build({ entryPoints: [resolve(import.meta.dirname, 'tasks-import-responsive.fixture.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: root + '/apps/electron/tsconfig.json', plugins: [{ name: 'explicit-unchanged-fixture-leaves', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : null)
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: root }))
  for (const [file, variable] of [['TasksPage.tsx', 'ROX_TASKS_OLD_COMPONENT'], ['ModeScreen.tsx', 'ROX_TASKS_OLD_LAYOUT'], ['TaskDetail.tsx', 'ROX_TASKS_OLD_DETAIL']]) {
    if (process.env[variable]) builder.onLoad({ filter: new RegExp('/'+file.replace('.', '\\.')+'$') }, args => ({ contents: readFileSync(process.env[variable], 'utf8'), loader: 'tsx', resolveDir: dirname(args.path) }))
  }
} }] })
writeFileSync(process.argv[2], result.outputFiles[0].text)
// Compile the actual renderer stylesheet with Tailwind v4, including the
// production component candidates. No hand-written substitute layout CSS.
const { compile } = await import(root + '/node_modules/@tailwindcss/node/dist/index.mjs')
const cssPath = root + '/apps/electron/src/renderer/index.css'
const compiler = await compile(readFileSync(cssPath, 'utf8'), { base: dirname(cssPath), from: cssPath, onDependency() {} })
const candidates = new Set()
function scan(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const file=join(path,entry.name); if(entry.isDirectory())scan(file);else if(/\.[cm]?[jt]sx?$/.test(file))for(const token of readFileSync(file,'utf8').split(/[\s"'`<>]+/))candidates.add(token) } }
scan(root+'/apps/electron/src/renderer');scan(root+'/packages/ui/src/components')
writeFileSync(process.argv[3], compiler.build([...candidates]))
