import json, sys, urllib.request
TPL="/opt/clipwaltz-ai/venv/lib/python3.12/site-packages/comfyui_workflow_templates_json/templates/video_wan2_2_5B_ti2v.json"
OINFO=json.load(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30))
t=json.load(open(TPL))
nodes=t["nodes"]; links=t.get("links",[])
# link id -> (src_node, src_slot)
lm={}
for L in links:
    # [id, src_node, src_slot, dst_node, dst_slot, type]
    lm[L[0]]=(L[1], L[2])
SKIP={"MarkdownNote","Note","Reroute"}
LINKTYPES={"MODEL","CLIP","VAE","IMAGE","LATENT","CONDITIONING","MASK","CONTROL_NET","SIGMAS","GUIDER","SAMPLER","NOISE","WEBM","VIDEO","AUDIO"}
api={}
for n in nodes:
    ty=n["type"]
    if ty in SKIP: continue
    nid=str(n["id"])
    entry={"class_type":ty,"inputs":{}}
    # connection inputs
    connected=set()
    for inp in n.get("inputs",[]):
        if inp.get("link") is not None and inp["link"] in lm:
            src=lm[inp["link"]]
            entry["inputs"][inp["name"]]=[str(src[0]),src[1]]
            connected.add(inp["name"])
    # widget inputs, mapped positionally from object_info order
    spec=OINFO.get(ty,{}).get("input",{})
    order=[]
    for grp in ("required","optional"):
        for name,d in spec.get(grp,{}).items():
            order.append((name,d))
    wv=list(n.get("widgets_values",[]) or [])
    wi=0
    for name,d in order:
        if name in connected: continue
        tspec=d[0] if isinstance(d,list) and d else d
        opts=d[1] if isinstance(d,list) and len(d)>1 and isinstance(d[1],dict) else {}
        is_widget = isinstance(tspec,list) or tspec in ("INT","FLOAT","STRING","BOOLEAN","COMBO")
        if not is_widget: 
            continue
        if wi>=len(wv): continue
        entry["inputs"][name]=wv[wi]; wi+=1
        # control_after_generate pseudo-widget follows seed-like INT controls
        if opts.get("control_after_generate") or name in ("seed","noise_seed"):
            if wi<len(wv) and isinstance(wv[wi],str): wi+=1
    api[nid]=entry
open("/opt/clipwaltz-ai/workflows/ltx/../wan/workflow.api.json","w").write(json.dumps(api,indent=2))
print("nodes:",len(api))
print(json.dumps(api,indent=1)[:1200])
