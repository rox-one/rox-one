import { resolve, dirname } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { build as bundle } from 'esbuild'

const main = resolve(import.meta.dir, '../MainContentPanel.tsx')
const types = resolve(import.meta.dir, '../../../../shared/types.ts')
const parser = resolve(import.meta.dir, '../../../../shared/route-parser.ts')
const leafSource = `import * as React from 'react';
let nextMount = 0;
export function leaf(name) { return function Surface(props) {
 const [mount] = React.useState(() => ++nextMount);
 return React.createElement('section', {'data-route-host':name,'data-mount':mount,'data-props':JSON.stringify(props)}, name);
} }
export const MultiSelectPanel = leaf('MultiSelectPanel');
export const MemoryScreen = leaf('MemoryScreen'); export const ProjectsHomeInMain=leaf('ProjectsHomeInMain');
export const PageView=leaf('PageView'); export const SessionHeatmapHost=leaf('SessionHeatmapHost');
export const HomeFrontPage=leaf('HomeFrontPage'); export const SettingsOverviewPage=leaf('SettingsOverviewPage');
export const PagesHome=leaf('PagesHome'); export const KanbanBoardContainer=leaf('KanbanBoardContainer');
export const SessionTableHost=leaf('SessionTableHost'); export const AutomationEditor=leaf('AutomationEditor');
export const KnowledgeDiff=leaf('KnowledgeDiff'); export const KnowledgeProposals=leaf('KnowledgeProposals');
export const KnowledgeHome=leaf('KnowledgeHome'); export const CollectionBulkBar=()=>null;
export const SendResourceToWorkspaceDialog=()=>null;
export const getSettingsPageComponent=(subpage)=>leaf('Settings:'+subpage);
`
const bindings = `import * as React from 'react'; import {atom} from 'jotai';
export const ShellContext=React.createContext(null); export const NavContext=React.createContext(null);
export const useAppShellContext=()=>React.useContext(ShellContext);
export const useNavigationState=()=>React.useContext(NavContext);
export const useNavigation=()=>({navigateToSource:()=>{}});
export const useActiveWorkspace=()=>({id:React.useContext(ShellContext)?.activeWorkspaceId});
export { isSessionsNavigation,isSourcesNavigation,isSettingsNavigation,isSkillsNavigation,isMemoryNavigation,
 isTasksNavigation,isMeetingsNavigation,isInboxNavigation,isFeedNavigation,isNotesNavigation,isAutomationsNavigation,
 isProjectsNavigation,isPagesNavigation,isBrowserNavigation,isKnowledgeNavigation,isDiffNavigation,isExtensionNavigation,
 isConnectionsNavigation,isHomeNavigation,isCloudRunNavigation,isTerminalNavigation } from ${JSON.stringify(types)};
export const sessionMetaMapAtom=atom(new Map()); export const automationsAtom=atom([]);
export const knowledgeActiveViewIdAtom=atom(null); export const knowledgeHomeViewAtom=atom('search');
const selection={useIsMultiSelectActive:()=>false,useSelectionCount:()=>0,useSelectedIds:()=>new Set(),useSelection:()=>({clearMultiSelect:()=>{}})};
export const sourceSelection=selection,skillSelection=selection,automationSelection=selection;
export const recordRecentSetting=async()=>{};
const translate=(key)=>key;
export const useTranslation=()=>({t:translate});
`

const entityUi = `import * as React from 'react';
export function Info_Page({loading,error,empty,children}) {
 return <section data-entity-page data-loading={String(!!loading)} data-entity-error={error??''} data-entity-empty={empty??''}>
  {loading?'loading':error??empty??children}
 </section>;
}
const Section=({children,title,actions})=><div>{title}{actions}{children}</div>;
Info_Page.Header=Section; Info_Page.Content=Section; Info_Page.Hero=Section;
export const Info_Section=Section,Info_Table=Section,Info_Alert=Section;
Info_Table.Row=({label,value,children})=><div>{label}{value}{children}</div>;
export const PermissionsDataTable=()=>null,ToolsDataTable=()=>null;
export const EditPopover=({trigger})=>trigger??null,getEditConfig=()=>({});
export const Button=({children,...props})=><button {...props}>{children}</button>;
export const Input=(props)=><input {...props}/>;
export const Textarea=(props)=><textarea {...props}/>;
export const Switch=()=>null,SourceAvatar=()=>null,SkillAvatar=()=>null,SourceMenu=()=>null,SkillMenu=()=>null;
export const toast={error:()=>{},success:()=>{}};
export const navigate=()=>{},routes={view:{skills:()=> 'skills'}};
`

export async function buildMainFixture(
  outdir: string,
  browser = false,
  options: { realEntityPages?: boolean; browserBootstrap?: string } = {},
) {
  mkdirSync(outdir, { recursive: true })
  const entry = resolve(outdir, 'rox-readiness-ui-001.entry.tsx')
  writeFileSync(entry, `import * as React from 'react';
import {MainContentPanel} from ${JSON.stringify(main)};
import {ShellContext,NavContext} from 'rox-ui001-bindings';
import {parseRouteToNavigationState} from ${JSON.stringify(parser)};
export function Fixture({route='sources/source/one',workspace='workspace-a',directory,override}) {
 const nav=override??parseRouteToNavigationState(route);
 return <ShellContext.Provider value={{activeWorkspaceId:workspace,workspaces:[],sessionStatuses:[],projects:[],loadedProjects:[],labels:[],activeSessionWorkingDirectory:directory}}>
  <NavContext.Provider value={nav}><MainContentPanel panelId="fixture-panel" /></NavContext.Provider>
 </ShellContext.Provider>
}
${browser ? options.browserBootstrap ?? `import {createRoot} from 'react-dom/client';
const sourceListeners=new Set(),skillListeners=new Set();
window.electronAPI={onSourcesChanged:(fn)=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)},onSkillsChanged:(fn)=>{skillListeners.add(fn);return()=>skillListeners.delete(fn)}};
const root=createRoot(document.getElementById('root'));
window.ui001={render:(props)=>root.render(<Fixture {...props}/>),sources:(ws,data)=>{for(const fn of sourceListeners)fn(ws,data)},skills:(ws,data)=>{for(const fn of skillListeners)fn(ws,data)}};
window.ui001.render({});` : ''}
`)
  const stubs = new Set([
    '../memory/MemoryScreen', './ProjectsHomeInMain', './MultiSelectPanel', './collection/CollectionBulkBar',
    '@/pages/ChatPage', '@/platform/HomeFrontPage', '@/pages/settings/settings-pages', '@/pages/settings/SettingsOverviewPage',
    '../pages/PageView', './session-heatmap/SessionHeatmapHost', './SendResourceToWorkspaceDialog',
    '../pages/PagesHome', './kanban/KanbanBoardContainer', './session-table/SessionTableHost', '../automations/AutomationEditor',
    '../../knowledge/KnowledgeDiff', '../../knowledge/KnowledgeProposals',
  ])
  const bindingImports = new Set([
    '@/context/AppShellContext', '@/contexts/NavigationContext', '@/atoms/sessions', '@/atoms/automations',
    '@/hooks/useEntitySelection', '@/lib/settings-recent', 'react-i18next',
  ])
  await bundle({
    entryPoints: [entry], outdir, entryNames: '[name].bundle', target: 'es2022',
    platform: browser ? 'browser' : 'node', format: 'esm', bundle: true, jsx: 'automatic',
    external: browser ? [] : ['react', 'react/jsx-runtime', 'jotai'],
    plugins: [{ name: 'UI-001 component boundaries', setup(build) {
      build.onResolve({ filter: /^rox-ui001-bindings$/ }, () => ({ path: 'bindings', namespace: 'ui001' }))
      build.onResolve({ filter: /.*/ }, args => {
        if (options.realEntityPages && /\/pages\/(SourceInfoPage|SkillInfoPage)\.tsx$/.test(args.importer)) {
          if (['react-i18next', '@/contexts/NavigationContext', '@/context/AppShellContext'].includes(args.path)) {
            return { path: 'bindings', namespace: 'ui001' }
          }
          if (args.path.startsWith('@/components/') || args.path === 'sonner' || args.path === '@/lib/navigate') {
            return { path: 'entity-ui', namespace: 'ui001' }
          }
        }
        if (args.importer !== main) return
        if (bindingImports.has(args.path)) return { path: 'bindings', namespace: 'ui001' }
        if (args.path === '../../knowledge/KnowledgeHome') return { path: 'knowledge', namespace: 'ui001' }
        if (options.realEntityPages && ['@/pages/SourceInfoPage', '@/pages/SkillInfoPage'].includes(args.path)) return
        if (stubs.has(args.path) || args.path.startsWith('@/pages/')) return { path: `leaf:${args.path}`, namespace: 'ui001' }
      })
      build.onLoad({ filter: /.*/, namespace: 'ui001' }, args => {
        if (args.path === 'bindings') return { contents: bindings, loader: 'tsx', resolveDir: dirname(main) }
        if (args.path === 'entity-ui') return { contents: entityUi, loader: 'tsx', resolveDir: dirname(main) }
        if (args.path === 'knowledge') return { contents: `${leafSource}\nexport {knowledgeActiveViewIdAtom,knowledgeHomeViewAtom} from 'rox-ui001-bindings';`, loader:'tsx',resolveDir:dirname(main) }
        const name = args.path.split('/').at(-1)
        return { contents: `${leafSource}\nexport default leaf(${JSON.stringify(name)});`, loader: 'tsx', resolveDir: dirname(main) }
      })
    } }],
  })
  return resolve(outdir, 'rox-readiness-ui-001.entry.bundle.js')
}
