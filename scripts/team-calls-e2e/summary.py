import json,os,urllib.request
t=json.load(open("transcript.json"));txt="\n".join(f"{s['speakerName']}: {s['text']}" for s in t["segments"])
def call(model):
    body=json.dumps({"model":model,"messages":[{"role":"system","content":"Кратко резюмируй звонок по-русски: 2-4 пункта, решения и задачи с ответственными."},{"role":"user","content":txt}],"max_tokens":400}).encode()
    r=urllib.request.Request("https://api.rox.one/v1/chat/completions",body,{"Authorization":"Bearer "+os.environ["ROX_API_KEY"],"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r,timeout=60))["choices"][0]["message"]["content"]
for m in ["rox/r1-max","rox/rox-r1-max","rox/deepseek-v4.1-flash"]:
    try: s=call(m); print("MODEL",m); print(s); t["summary"]={"model":m,"text":s}; json.dump(t,open("transcript.json","w"),ensure_ascii=False,indent=1); break
    except Exception as e: print("fail",m,str(e)[:80])
