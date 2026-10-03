import {describe,expect,it} from 'bun:test'
import {followChatOutput} from '../chat-scroll'
describe('owned chat viewport output follow',()=>{
 const create=()=>{const calls:ScrollToOptions[]=[];return {calls,viewport:{isConnected:true,clientHeight:300,scrollHeight:1600,scrollTo:(options:ScrollToOptions)=>calls.push(options)}}}
 const base={stickToBottom:true,focused:true,reducedMotion:false,documentVisible:true}
 it('scrolls only the owned viewport with the source focused/unfocused motion policy',()=>{const {calls,viewport}=create();expect(followChatOutput(viewport,base)).toBeTrue();expect(calls).toEqual([{top:1600,behavior:'smooth'}]);expect(followChatOutput(viewport,{...base,focused:false})).toBeTrue();expect(calls.at(-1)).toEqual({top:1600,behavior:'instant'})})
 it('respects reduced motion and refuses hidden, unstuck, zero-sized and disconnected output',()=>{const {calls,viewport}=create();expect(followChatOutput(viewport,{...base,reducedMotion:true})).toBeTrue();expect(calls.at(-1)?.behavior).toBe('instant');for(const options of [{...base,stickToBottom:false},{...base,documentVisible:false}])expect(followChatOutput(viewport,options)).toBeFalse();expect(followChatOutput({...viewport,clientHeight:0},base)).toBeFalse();expect(followChatOutput({...viewport,isConnected:false},base)).toBeFalse();expect(followChatOutput(null,base)).toBeFalse();expect(calls).toHaveLength(1)})
})
