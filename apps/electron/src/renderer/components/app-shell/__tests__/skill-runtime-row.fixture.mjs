import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const root=new URL('../../../../../../../',import.meta.url).pathname;
const output=process.argv[2];if(!output)throw Error('Supply fixture bundle output');
const mocks={
'react-i18next':`export const useTranslation=()=>({t:k=>k});`,
'sonner':`export const toast={success(){},error(){}};`,
'jotai':`export const useAtomValue=atom=>atom==='sessions'?new Map():atom==='projects'?[]:null;`,
'@/atoms/sessions':`export const activeSessionIdAtom='active';export const sessionMetaMapAtom='sessions';`,
'@/atoms/projects':`export const projectsAtom='projects';`,
'@/atoms/panel-stack':`export const focusedPanelIdAtom='focused';`,
'@/features/product-tour/runtime/hooks':`const tour={capability(){}};export const useTourTarget=()=>({ref(){}});export const useTourSignals=()=>tour;`,
'@/context/AppShellContext':`export const useActiveWorkspace=()=>({id:'fixture'});export const useAppShellContext=()=>({workspaces:[{id:'fixture'}],activeWorkspaceId:'fixture'});`,
'@/hooks/useEntitySelection':`export const skillSelection={useSelection(){return{reset(){window.rows.resets++;window.rows.craftSelection=[]}}}};`,
'@/components/ui/entity-panel':`import React from 'react';export const EntityPanel=props=>React.createElement('section',null,props.children);`,
'@/components/ui/entity-list-empty':`export const EntityListEmptyScreen=()=>null;`,
'@/components/ui/skill-avatar':`export const SkillAvatar=()=>null;`,
'@/components/ui/EditPopover':`export const EditPopover=()=>null;export const getEditConfig=()=>({});`,
'@/components/ui/HeaderIconButton':`export const HeaderIconButton=()=>null;`,
'./SkillMenu':`export const SkillMenu=()=>null;`,
'./SendResourceToWorkspaceDialog':`export const SendResourceToWorkspaceDialog=()=>null;`,
'@/lib/platform':`export const getFileManagerName=()=> 'Finder';`
};
const contents=`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {SkillsListPanel} from './apps/electron/src/renderer/components/app-shell/SkillsListPanel';
window.rows={resets:0,clicks:[],craftSelection:['old-craft']};window.electronAPI={listPendingSkills:async()=>[],getSkillUsage:async()=>({}),onSkillsPendingChanged:()=>()=>{},onSkillsChanged:()=>()=>{},listBundledSkillPacks:async()=>[],onBundledSkillsChanged:()=>()=>{}};
const item=(slug,name,shadowedByCraft=false)=>({slug,metadata:{name,description:'Canonical metadata'},content:'',path:'/fixture/'+slug,source:'omp',shadowedByCraft});
const skills=[item('selected','Selected runtime'),item('shadowed','Shadowed runtime',true)];let selected=null;const root=createRoot(document.getElementById('root'));const render=()=>flushSync(()=>root.render(React.createElement(SkillsListPanel,{skills,workspaceId:'fixture',selectedSkillSlug:selected,onDeleteSkill(){throw Error('unexpected mutation')},onSkillClick(skill){window.rows.clicks.push({slug:skill.slug,remainingCraft:[...window.rows.craftSelection]});selected=skill.slug;render()}})));render();`;
const result=await build({stdin:{contents,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',tsconfig:root+'apps/electron/tsconfig.json',plugins:[{name:'explicit-row-leaves',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js',resolveDir:root}));}}]});writeFileSync(output,result.outputFiles[0].text);
