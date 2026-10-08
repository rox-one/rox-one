import { resolve, dirname, relative, sep } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { build as bundle } from 'esbuild'

const main = resolve(import.meta.dir, '../MainContentPanel.tsx')
const panelSlot = resolve(import.meta.dir, '../PanelSlot.tsx')
const types = resolve(import.meta.dir, '../../../../shared/types.ts')
const parser = resolve(import.meta.dir, '../../../../shared/route-parser.ts')
const tooltip = resolve(import.meta.dir, '../../../../../../../packages/ui/src/components/tooltip.tsx')
const leafSource = `import * as React from 'react';
let nextMount = 0;
export function leaf(name) { return function Surface(props) {
 const [mount] = React.useState(() => ++nextMount);
 React.useEffect(() => {
  if (name === 'ChatPage') (window.__ui001ChatMounts ??= []).push(props.sessionId);
 }, [props.sessionId]);
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
export const NavigationStatusContext=React.createContext({isSessionsReady:true,unavailableWorkspaceSlug:null});
export const AppShellProvider=ShellContext.Provider;
export const useAppShellContext=()=>React.useContext(ShellContext);
export const useNavigationState=()=>React.useContext(NavContext);
export const useNavigation=()=>({...React.useContext(NavigationStatusContext),navigateToSource:()=>{}});
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
export const toast={error:()=>{}};
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
export const Tooltip=Section,TooltipContent=Section,TooltipTrigger=Section;
Info_Table.Row=({label,value,children})=><div>{label}{value}{children}</div>;
export const PermissionsDataTable=()=>null,ToolsDataTable=()=>null;
export const EditPopover=({trigger})=>trigger??null,getEditConfig=()=>({});
export const Button=({children,...props})=><button {...props}>{children}</button>;
export const PanelHeaderCenterButton=({icon,tooltip,...props})=><button aria-label={tooltip} {...props}>{icon}</button>;
export const Input=(props)=><input {...props}/>;
export const Textarea=(props)=><textarea {...props}/>;
export const Switch=()=>null,SourceAvatar=()=>null,SkillAvatar=()=>null,SourceMenu=()=>null,SkillMenu=()=>null;
export const toast={error:()=>{},success:()=>{}};
export const navigate=()=>{},routes={view:{skills:()=> 'skills'}};
`

export async function buildMainFixture(
  outdir: string,
  browser = false,
  options: { realEntityPages?: boolean; realNavigation?: boolean; browserBootstrap?: string } = {},
) {
  mkdirSync(outdir, { recursive: true })
  const entry = resolve(outdir, 'rox-readiness-ui-001.entry.tsx')
  writeFileSync(entry, `import * as React from 'react';
import {MainContentPanel} from ${JSON.stringify(main)};
import {Provider as FixtureProvider,createStore as createFixtureStore} from 'jotai';
import {ShellContext,NavContext,NavigationStatusContext,sessionMetaMapAtom as fixtureSessionMetaMapAtom} from 'rox-ui001-bindings';
import {parseRouteToNavigationStateOrUnavailable as parseRouteToNavigationState} from ${JSON.stringify(parser)};
${options.realEntityPages ? `import {TooltipProvider as FixtureTooltipProvider} from ${JSON.stringify(resolve(import.meta.dir, '../../../../../../../packages/ui/src/components/tooltip.tsx'))};` : ''}
const emptyFixtureSessions=[];
export function Fixture({route='sources/source/one',workspace='workspace-a',directory,override,sessions=emptyFixtureSessions,sessionsReady=true,remoteWorkspaceId,unavailableWorkspaceSlug=null}) {
 const nav=override??parseRouteToNavigationState(route);
 // Initialize an unpublished store before subscribers mount; replacing the
 // fixture's metadata never mutates a store subscribed by the previous render.
 const fixtureStore=React.useMemo(()=>{const store=createFixtureStore();
  store.set(fixtureSessionMetaMapAtom,new Map(sessions.map(session=>[session.id,session])));return store;
 },[sessions]);
 const workspaces=remoteWorkspaceId?[{id:workspace,remoteServer:{remoteWorkspaceId}}]:[];
 return ${options.realEntityPages ? '<FixtureTooltipProvider>' : ''}<FixtureProvider store={fixtureStore}><ShellContext.Provider value={{activeWorkspaceId:workspace,workspaces,sessionStatuses:[],projects:[],loadedProjects:[],labels:[],activeSessionWorkingDirectory:directory}}>
 <NavigationStatusContext.Provider value={{isSessionsReady:sessionsReady,unavailableWorkspaceSlug}}>
  <NavContext.Provider value={nav}><MainContentPanel panelId="fixture-panel" /></NavContext.Provider>
 </NavigationStatusContext.Provider></ShellContext.Provider></FixtureProvider>${options.realEntityPages ? '</FixtureTooltipProvider>' : ''}
}
${browser ? options.browserBootstrap ?? `import {createRoot} from 'react-dom/client';
const sourceListeners=new Set(),skillListeners=new Set();
let sources=['one','two'].map(slug=>({config:{slug}})),skills=[{slug:'one',source:'workspace'}];
window.electronAPI={getSources:async()=>sources,getSkills:async()=>skills,onSourcesChanged:(fn)=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)},onSkillsChanged:(fn)=>{skillListeners.add(fn);return()=>skillListeners.delete(fn)}};
const root=createRoot(document.getElementById('root'));
window.ui001={render:(props)=>root.render(<Fixture {...props}/>),sources:(ws,data)=>{sources=data;for(const fn of sourceListeners)fn(ws,data)},skills:(ws,data)=>{skills=data;for(const fn of skillListeners)fn(ws,data)}};
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
  const result = await bundle({
    entryPoints: [entry], outdir, entryNames: '[name].bundle', target: 'es2022',
    platform: browser ? 'browser' : 'node', format: 'esm', bundle: true, jsx: 'automatic',
    external: browser ? [] : ['react', 'react/jsx-runtime', 'jotai'],
    metafile: !!process.env.ROX_UI001_COMPONENT_MANIFEST,
    plugins: [{ name: 'UI-001 component boundaries', setup(build) {
      build.onResolve({ filter: /^rox-ui001-bindings$/ }, () => ({ path: 'bindings', namespace: 'ui001' }))
      build.onResolve({ filter: /.*/ }, args => {
        // Resolve the same public tooltip exports directly, avoiding unrelated KaTeX barrel assets.
        if (/\/components\/ui\/source-status-indicator\.tsx$/.test(args.importer)) {
          if (options.realEntityPages && args.path === '@rox/ui') {
            // Keep its real tooltip exports without pulling unrelated markdown
            // font assets from the UI package's broad index into this fixture.
            return { path: resolve(import.meta.dir, '../../../../../../../packages/ui/src/components/tooltip.tsx') }
          }
          if (args.path === '@rox/ui') return { path: 'entity-ui', namespace: 'ui001' }
          if (args.path === 'react-i18next') return { path: 'bindings', namespace: 'ui001' }
        }
        if (options.realNavigation && /\/contexts\/NavigationContext\.tsx$/.test(args.importer)
          && ['react-i18next', 'sonner'].includes(args.path)) return { path: 'bindings', namespace: 'ui001' }
        if (options.realEntityPages && /\/pages\/(SourceInfoPage|SkillInfoPage)\.tsx$/.test(args.importer)) {
          // Source availability uses the shipped status derivation; the detail
          // fixture must not replace that collaborator with a generic UI stub.
          // Keep the shipped connection-status derivation and its indicator.
          if (args.path === '@/components/ui/source-status-indicator') return
          if (['react-i18next', '@/contexts/NavigationContext', '@/context/AppShellContext'].includes(args.path)) {
            return { path: 'bindings', namespace: 'ui001' }
          }
          if (args.path.startsWith('@/components/') || args.path === 'sonner' || args.path === '@/lib/navigate') {
            return { path: 'entity-ui', namespace: 'ui001' }
          }
        }
        if (args.importer === panelSlot) {
          if (bindingImports.has(args.path)) return { path: 'bindings', namespace: 'ui001' }
          if (args.path === '@/components/ui/PanelHeaderCenterButton') return { path: 'entity-ui', namespace: 'ui001' }
        }
        if (args.importer !== main) return
        if (options.realNavigation && ['@/contexts/NavigationContext', '@/atoms/sessions'].includes(args.path)) return
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
  const output = resolve(outdir, 'rox-readiness-ui-001.entry.bundle.js')
  if (process.env.ROX_UI001_COMPONENT_MANIFEST) {
    const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
    const inputs = Object.keys(result.metafile!.inputs).map(path => resolve(path))
      .filter(path => existsSync(path) && !path.startsWith(resolve(outdir) + sep))
    writeFileSync(process.env.ROX_UI001_COMPONENT_MANIFEST, JSON.stringify({
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      bundleSha256: sha256(readFileSync(output)), bootstrapSha256: sha256(readFileSync(entry)),
      inputSha256: Object.fromEntries(inputs.map(path => [relative(process.cwd(), path), sha256(readFileSync(path))])),
      scope: 'real MainContentPanel component fixture; IPC and leaf boundaries remain explicit',
    }, null, 2) + '\n')
  }
  return output
}
