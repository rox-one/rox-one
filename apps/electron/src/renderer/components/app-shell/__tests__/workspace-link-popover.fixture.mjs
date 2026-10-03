import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../');
let directory=process.argv[2];if(!directory)throw new Error('Supply a fixture directory');mkdirSync(directory,{recursive:true});directory=realpathSync(directory);
const override=process.argv[3];
const require=createRequire(root+'/package.json');
const {build}=await import(root+'/node_modules/vite/dist/node/index.js');
const tailwind=(await import(root+'/node_modules/@tailwindcss/vite/dist/index.mjs')).default;
const ui=JSON.parse(readFileSync(root+'/packages/ui/package.json','utf8'));
const mocks={
 'react-i18next':"const t=key=>key;export const useTranslation=()=>({t});",
 'sonner':"export const toast={success:(...v)=>window.railFixture.toasts.push(v),error:(...v)=>window.railFixture.toasts.push(v)};",
 '@/components/ui/avatar':"import React from 'react';export const CrossfadeAvatar=()=>React.createElement('span',null,'avatar');",
 '@/components/workspace':"export const WorkspaceCreationScreen=()=>null;",
 '@/hooks/useTransportConnectionState':"export const useTransportConnectionState=()=>null;",
 '@/hooks/useWorkspaceIcon':"const icons=new Map();export const useWorkspaceIcons=()=>icons;",
 '@/lib/transport-wait':"export const waitForTransportConnected=()=>Promise.resolve();",
 '@/lib/navigate':`export {routes} from ${JSON.stringify(root+'/apps/electron/src/shared/routes.ts')};export const navigate=route=>window.railFixture.navigations.push(route);`,
 '@rox/ui':`export {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from ${JSON.stringify(root+'/packages/ui/src/components/tooltip.tsx')};export {PremiumMenuSelect} from ${JSON.stringify(root+'/packages/ui/src/components/ui/PremiumMenuSelect.tsx')};`
};
for(const [key,value] of Object.entries(mocks)) if(key.startsWith('@/')) mocks[root+'/apps/electron/src/renderer/'+key.slice(2)]=value;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {TooltipProvider} from '@rox/ui';import {WorkspaceIconRail} from '${root}/apps/electron/src/renderer/components/app-shell/WorkspaceIconRail';
import {loadRailLinks} from '${root}/apps/electron/src/renderer/lib/rail-links';
import '${root}/apps/electron/src/renderer/index.css';
let activeWorkspaceId='ws-a';const workspaces=[{id:'ws-a',name:'Workspace A',rootPath:'/fixture/a'},{id:'ws-b',name:'Workspace B',rootPath:'/fixture/b'}];
const app=createRoot(document.getElementById('root'));window.railFixture={toasts:[],navigations:[],links:()=>loadRailLinks(activeWorkspaceId),scope(id){activeWorkspaceId=id;render()}};
window.electronAPI={openUrl:async url=>window.railFixture.navigations.push(url)};
function render(){flushSync(()=>app.render(React.createElement(TooltipProvider,null,React.createElement(WorkspaceIconRail,{workspaces,activeWorkspaceId,onSelect:id=>{activeWorkspaceId=id;render()}}))))};render();`;
writeFileSync(directory+'/entry.jsx',entry);writeFileSync(directory+'/index.html','<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body style="margin:0;height:100vh"><div id="root" style="height:100vh"></div><script type="module" src="/entry.jsx"></script></body></html>');
await build({configFile:false,root:directory,base:'./',plugins:[{name:'explicit-unchanged-rail-seams',enforce:'pre',resolveId(id){return mocks[id]?'\0rail:'+id:null},load(id){if(override&&id===root+'/apps/electron/src/renderer/components/app-shell/WorkspaceIconRail.tsx')return readFileSync(override,'utf8');return id.startsWith('\0rail:')?mocks[id.slice(6)]:null}},tailwind()],resolve:{alias:[{find:'react-dom/client',replacement:require.resolve('react-dom/client')},{find:/^react-dom$/,replacement:require.resolve('react-dom')},{find:'react/jsx-runtime',replacement:require.resolve('react/jsx-runtime')},{find:'react/jsx-dev-runtime',replacement:require.resolve('react/jsx-dev-runtime')},{find:/^react$/,replacement:require.resolve('react')},{find:'@rox/ui/styles',replacement:root+'/packages/ui/'+ui.exports['./styles']},{find:'@',replacement:root+'/apps/electron/src/renderer'}]},build:{outDir:directory+'/dist',emptyOutDir:true,minify:false},logLevel:'warn'});
