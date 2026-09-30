import fs from 'node:fs';
import crypto from 'node:crypto';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export function buildHandoff(catalogs,ownership){
 const controls=[];
 for(const {path,data} of catalogs)for(const [i,s] of data.screenContracts.entries())for(const [j,c] of s.controls.entries()){
  const primaryOwner=ownership.screenPrimaryUiOwners[s.id];
  controls.push({id:`${s.id}.${c.id}`,screenId:s.id,controlId:c.id,labelRu:c.labelRu||c.label,source:{path,pointer:`/screenContracts/${i}/controls/${j}`},primaryUiOwner:primaryOwner,featureOwners:s.workPackages,input:c.input||c.inputType,output:c.output||c.outputType,interaction:{hover:c.onHover||c.hoverHelp||c.hover,focus:c.onFocus||c.focusHelp||c.focus,click:c.onClick||c.click,keyboard:c.keyboard,help:c.onHelpClick||c.clickHelp||c.help},testHook:{root:`[data-screen-contract="${s.id}"]`,control:`[data-control-id="${s.id}.${c.id}"]`,status:'PROPOSED_NOT_IMPLEMENTED',compatibility:'Existing selectors remain compatibility aliases; target marker is not evidence current UI exists'},testFile:`tests/macro-integration/ui/${s.id.toLowerCase()}.spec.ts`,proofRequirements:['exact entity ref/revision','input/action/observed output','keyboard/focus return','failure or denied state','reload or explicit N/A reason','computed theme/font in visible-change evidence'],runtimeStatus:'PLANNED_NOT_RUN'});
 }
 return{schemaVersion:1,status:'GENERATED_HANDOFF_NOT_PRODUCT_IMPLEMENTATION',counts:{screens:new Set(controls.map(c=>c.screenId)).size,controls:controls.length},inputs:catalogs.map(c=>({path:c.path,sha256:hash(c.bytes||JSON.stringify(c.data)),hashEncoding:c.bytes?'exact-file-bytes':'canonical-json-fallback'})),controls};
}
export function validateHandoff(h,catalogs,ownership){
 const expected=buildHandoff(catalogs,ownership),errors=[],check=(ok,m)=>{if(!ok)errors.push(m);};
 check(h.counts.controls===expected.controls.length,'control count mismatch');check(h.counts.screens===expected.counts.screens,'screen count mismatch');
 check(h.controls.length===h.counts.controls,'declared/actual count mismatch');check(JSON.stringify(h.inputs)===JSON.stringify(expected.inputs),'source input hash drift');
 for(const c of h.controls){const e=expected.controls.find(x=>x.id===c.id);if(!e)continue;for(const k of ['screenId','controlId','featureOwners','proofRequirements','testHook'])check(JSON.stringify(c[k])===JSON.stringify(e[k]),'handoff field drift '+c.id+' '+k);}
 const ids=new Set();for(const c of h.controls){check(!ids.has(c.id),'duplicate '+c.id);ids.add(c.id);const e=expected.controls.find(x=>x.id===c.id);if(!e){errors.push('unknown '+c.id);continue;}check(c.primaryUiOwner===e.primaryUiOwner&&e.featureOwners.includes(c.primaryUiOwner),'wrong UI owner '+c.id);check(c.input===e.input&&c.output===e.output,'input/output drift '+c.id);check(/[А-Яа-яЁё]/.test(c.labelRu||''),'missing Russian label '+c.id);check(c.labelRu===e.labelRu,'label drift '+c.id);for(const k of ['hover','focus','click','keyboard','help']){check(!!c.interaction?.[k],'missing interaction '+c.id+' '+k);check(JSON.stringify(c.interaction?.[k])===JSON.stringify(e.interaction[k]),'interaction drift '+c.id+' '+k);}check(c.testHook.control===e.testHook.control,'selector drift '+c.id);check(c.testHook.status==='PROPOSED_NOT_IMPLEMENTED'&&c.runtimeStatus==='PLANNED_NOT_RUN','false runtime claim '+c.id);check(c.testFile===e.testFile,'test ownership path drift '+c.id);check(c.source.path===e.source.path&&c.source.pointer===e.source.pointer,'source pointer drift '+c.id);}
 for(const c of expected.controls)check(ids.has(c.id),'uncovered '+c.id);
 return errors;
}
export function loadInputs(root=process.cwd()){
 return{catalogs:['collaboration','domain','shared'].map(n=>{const path=`plans/macro-integration/${n}-screen-contracts.json`,bytes=fs.readFileSync(`${root}/${path}`,'utf8');return{path,bytes,data:JSON.parse(bytes)};}),ownership:JSON.parse(fs.readFileSync(`${root}/plans/macro-integration/cloud/ui-slices.json`))};
}
if(import.meta.main){const {catalogs,ownership}=loadInputs(),h=buildHandoff(catalogs,ownership),errors=validateHandoff(h,catalogs,ownership);if(errors.length)throw Error(errors.join('\n'));fs.writeFileSync('plans/macro-integration/control-handoff.json',JSON.stringify(h,null,2)+'\n');console.log(JSON.stringify({status:'PASSED_PLANNING_ONLY',...h.counts}));}
