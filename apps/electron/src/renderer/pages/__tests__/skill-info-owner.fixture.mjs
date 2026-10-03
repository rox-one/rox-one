import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const ts=(await import(root+'/node_modules/typescript/lib/typescript.js')).default;
const source=readFileSync(new URL('./skill-info-owner.browser.node.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true);
let contents;
const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='fixtureSource'&&node.initializer&&ts.isNoSubstitutionTemplateLiteral(node.initializer))contents=node.initializer.text;ts.forEachChild(node,visit)};visit(tree);
if(!contents)throw new Error('Exact test fixture template is missing');
const output=process.argv[2];if(!output)throw new Error('Supply an output bundle path');
const componentOverride=process.argv[3];
const {build}=await import(root+'/node_modules/esbuild/lib/main.js');
const mocks={
'react-i18next':`const t=key=>key;export const useTranslation=()=>({t});`,
'sonner':`export const toast={success:(...args)=>window.skillInfo.toasts.push(['success',...args]),error:(...args)=>window.skillInfo.toasts.push(['error',...args])};`,
'@/context/AppShellContext':`export const useActiveWorkspace=()=>({id:window.skillInfo.props.workspaceId});`,
'@/components/ui/EditPopover':`import React from 'react';export const EditPopover=()=>React.createElement('button',null,'fixture AI edit');export const getEditConfig=()=>({});`,
'@/components/ui/skill-avatar':`export const SkillAvatar=()=>null;`,
'@/components/app-shell/SkillMenu':`import React from 'react';export const SkillMenu=props=>React.createElement('div',null,props.canDelete&&React.createElement('button',{onClick:props.onDelete},'delete'),props.canShowInFinder&&React.createElement('button',{onClick:props.onShowInFinder},'finder'));`,
'@/lib/navigate':`export {routes} from ${JSON.stringify(root+'/apps/electron/src/shared/routes.ts')};export const navigate=route=>window.skillInfo.navigations.push(route);`,
'@/components/info':`import React from 'react';
 export const Info_Page=props=>props.loading?React.createElement('output',null,'loading'):props.error?React.createElement('p',{role:'alert'},props.error):React.createElement('main',null,props.children);
 Info_Page.Header=props=>React.createElement('header',null,React.createElement('h1',null,props.title),props.titleMenu);
 Info_Page.Content=props=>React.createElement('article',null,props.children);
 Info_Page.Hero=props=>React.createElement('div',null,props.title,props.tagline);
 export const Info_Section=props=>React.createElement('section',null,props.actions,props.children);
 export const Info_Table=props=>React.createElement('div',null,props.children);
 Info_Table.Row=props=>React.createElement('div',null,props.label,props.value,props.children);`
};
const result=await build({stdin:{contents,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:root+'/apps/electron/tsconfig.json',plugins:[{name:'explicit-unchanged-fixture-leaves',setup(builder){builder.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:null);if(componentOverride)builder.onLoad({filter:/SkillInfoPage\.tsx$/},args=>({contents:readFileSync(resolve(componentOverride),'utf8'),loader:'tsx',resolveDir:dirname(args.path)}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js',resolveDir:root}));}}]});
writeFileSync(output,result.outputFiles[0].text);

