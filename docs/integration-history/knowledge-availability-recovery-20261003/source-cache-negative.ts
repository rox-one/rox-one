const [implementation]=process.argv.slice(2)
const module=await import(implementation)
const deferred=()=>{let resolve!:(value:{running:boolean})=>void;const promise=new Promise<{running:boolean}>(r=>resolve=r);return{promise,resolve}}
module.__resetKernelAvailabilityForTests()
let calls=0;const api={engineStatus:async()=>({running:++calls>1})}
const A=await module.getKernelAvailability(api,{workspaceId:'A',connectionId:'one'})
const B=await module.getKernelAvailability(api,{workspaceId:'B',connectionId:'one'})
const connection=await module.getKernelAvailability(api,{workspaceId:'A',connectionId:'two'})
const crossScope={A:A.running,B:B.running,connection:connection.running,calls}
module.__resetKernelAvailabilityForTests();const old=deferred(),fresh=deferred();calls=0
const pendingApi={engineStatus:()=>++calls===1?old.promise:fresh.promise},opts={workspaceId:'A'}
const oldCall=module.getKernelAvailability(pendingApi,opts)
if(module.invalidateKernelAvailability)module.invalidateKernelAvailability(pendingApi,'A');else module.__resetKernelAvailabilityForTests()
const freshCall=module.getKernelAvailability(pendingApi,opts);old.resolve({running:false});await oldCall
const beforeFresh=await Promise.race([module.getKernelAvailability(pendingApi,opts).then((v:any)=>({returnedBeforeFresh:true,running:v.running})),new Promise(resolve=>setTimeout(()=>resolve({returnedBeforeFresh:false}),20))])
fresh.resolve({running:true});await freshCall
console.log(JSON.stringify({implementation,crossScope,invalidation:{beforeFresh,final:(await module.getKernelAvailability(pendingApi,opts)).running,calls}},null,2))
