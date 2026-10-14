import { mintLiveKitToken } from './lktoken.mjs' // bun build packages/shared/src/team-chat/livekit-token.ts --target=node --outfile=lktoken.mjs
import { Room, RoomEvent, AudioSource, AudioFrame, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioStream, TrackKind } from '@livekit/rtc-node'
import { readFileSync, writeFileSync } from 'fs'
const env = Object.fromEntries(readFileSync(process.env.ROX_CALLS_ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const room = process.argv[2] || `rox-verify-${Date.now()}`
async function tok(id,name){return mintLiveKitToken({apiKey:env.LIVEKIT_API_KEY,apiSecret:env.LIVEKIT_API_SECRET,identity:id,name,room})}
async function join(id,name){const r=new Room();await r.connect(env.LIVEKIT_URL,await tok(id,name),{autoSubscribe:true,dynacast:false});return r}
// transcriber agent
const agent=await join('rox-transcriber','Rox Transcriber')
const bufs={}, t0=Date.now(), starts={}
agent.on(RoomEvent.TrackSubscribed,async(track,pub,p)=>{ if(track.kind!==TrackKind.KIND_AUDIO)return; starts[p.identity]=Date.now()-t0; const chunks=[];bufs[p.identity]={name:p.name,chunks}
  for await (const f of new AudioStream(track,{sampleRate:16000,numChannels:1})) chunks.push(Buffer.from(f.data.buffer,f.data.byteOffset,f.data.byteLength)) })
async function speaker(id,name,file,delay){const r=await join(id,name);const src=new AudioSource(48000,1);const tr=LocalAudioTrack.createAudioTrack('mic',src);const o=new TrackPublishOptions();o.source=TrackSource.SOURCE_MICROPHONE;await r.localParticipant.publishTrack(tr,o)
  await new Promise(s=>setTimeout(s,delay)); const pcm=readFileSync(file);const n=480
  for(let i=0;i+n*2<=pcm.length;i+=n*2){const d=new Int16Array(pcm.buffer.slice(pcm.byteOffset+i,pcm.byteOffset+i+n*2));await src.captureFrame(new AudioFrame(d,48000,1,n))}
  await src.waitForPlayout?.(); await new Promise(s=>setTimeout(s,1500)); return r}
console.log('room',room)
const [ra,rb]=await Promise.all([speaker('mark','Марк','a.pcm',1500),speaker('anna','Анна','b.pcm',9500)])
console.log('participants seen by agent:',[...agent.remoteParticipants.values()].map(p=>p.identity).join(','))
await ra.disconnect();await rb.disconnect();await new Promise(s=>setTimeout(s,800));await agent.disconnect()
const meta={}
for(const [id,b] of Object.entries(bufs)){writeFileSync(`rec-${id}.s16`,Buffer.concat(b.chunks));meta[id]={name:b.name,startMs:starts[id],bytes:Buffer.concat(b.chunks).length}}
writeFileSync('rec-meta.json',JSON.stringify({room,meta},null,1));console.log(JSON.stringify(meta))
process.exit(0)
