import json,sys,numpy as np
from faster_whisper import WhisperModel
m=WhisperModel(sys.argv[1] if len(sys.argv)>1 else "small",device="cpu",compute_type="int8",cpu_threads=4)
meta=json.load(open("rec-meta.json"));segs=[]
for pid,info in meta["meta"].items():
    a=np.frombuffer(open(f"rec-{pid}.s16","rb").read(),dtype=np.int16).astype(np.float32)/32768
    nz=np.flatnonzero(np.abs(a)>0.01); off=0
    if len(nz)==0: continue
    off=max(0,nz[0]-8000); a=a[off:nz[-1]+8000]; offms=int(off)//16
    out,_=m.transcribe(a,language="ru",vad_filter=True,condition_on_previous_text=False,beam_size=5)
    for s in out: segs.append({"speakerId":pid,"speakerName":info["name"],"text":s.text.strip(),"startMs":int(s.start*1000)+info["startMs"]+offms,"endMs":int(s.end*1000)+info["startMs"]+offms})
segs.sort(key=lambda s:s["startMs"]);json.dump({"room":meta["room"],"segments":segs},open("transcript.json","w"),ensure_ascii=False,indent=1)
for s in segs: print(f"[{s['startMs']//60000:02d}:{s['startMs']//1000%60:02d}] {s['speakerName']}: {s['text']}")
