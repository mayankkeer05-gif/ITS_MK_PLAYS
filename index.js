"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");

const app = express();
app.use(express.json({ limit: "1mb" }));
const PORT = process.env.PORT || 5000;
const PANEL_TOKEN = process.env.PANEL_TOKEN || "";
const DATA_DIR = path.join(__dirname, "multi-bots");
const BOT_WORKER = path.join(__dirname, "bot_worker.js");
const BASE_SETTINGS = path.join(__dirname, "settings.json");
const bots = new Map();

if (!PANEL_TOKEN) console.warn("[Manager] PANEL_TOKEN is not set.");
fs.mkdirSync(DATA_DIR, { recursive: true });

function auth(req, res, next) {
  if (!PANEL_TOKEN) return res.status(500).json({ success:false, msg:"PANEL_TOKEN is not configured." });
  if (req.get("x-panel-token") === PANEL_TOKEN) return next();
  const origin = req.get("origin"), host = req.get("host");
  if (origin && host) { try { if (new URL(origin).host === host) return next(); } catch (_) {} }
  return res.status(401).json({ success:false, msg:"Unauthorized" });
}
function safeId(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40); }
function listBots() {
  return fs.readdirSync(DATA_DIR, {withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name);
}
function settingsPath(id) { return path.join(DATA_DIR, id, "settings.json"); }
function metaPath(id) { return path.join(DATA_DIR, id, "meta.json"); }
function readJson(p, fallback={}) { try { return JSON.parse(fs.readFileSync(p,"utf8")); } catch (_) { return fallback; } }
function meta(id) { return readJson(metaPath(id), {id, name:id}); }
function workerPort(id) { return 6000 + (parseInt(require("crypto").createHash("md5").update(id).digest("hex").slice(0,6),16) % 1000); }
async function workerRequest(id, pathname, options={}) {
  const m = bots.get(id);
  if (!m) throw new Error("Bot process is not running");
  const url = `http://127.0.0.1:${m.port}${pathname}`;
  const r = await fetch(url, { ...options, headers:{ ...(options.headers||{}), "x-panel-token":PANEL_TOKEN, "content-type":"application/json" } });
  const text = await r.text(); let data; try { data=JSON.parse(text); } catch (_) { data={success:r.ok,msg:text}; }
  return data;
}
function spawnBot(id) {
  if (bots.has(id)) return bots.get(id);
  const dir = path.join(DATA_DIR,id); fs.mkdirSync(dir,{recursive:true});
  const port = workerPort(id);
  const child = fork(BOT_WORKER, [], { env:{...process.env, BOT_WORKER:"1", SETTINGS_FILE:settingsPath(id), PORT:String(port), BOT_ID:id}, stdio:"inherit" });
  const info={id,port,child,startedAt:Date.now()}; bots.set(id,info);
  child.on("exit",()=>{ if (bots.get(id)?.child===child) bots.delete(id); });
  return info;
}
async function waitWorker(id, ms=5000) { const start=Date.now(); while(Date.now()-start<ms){ try { return await workerRequest(id,"/health"); } catch (_) { await new Promise(r=>setTimeout(r,150)); } } throw new Error("Bot worker did not start"); }

// Ensure existing single-bot settings becomes Bot 1 on first launch.
if (!listBots().length && fs.existsSync(BASE_SETTINGS)) {
  const id="bot-1", dir=path.join(DATA_DIR,id); fs.mkdirSync(dir,{recursive:true});
  fs.copyFileSync(BASE_SETTINGS, settingsPath(id));
  fs.writeFileSync(metaPath(id), JSON.stringify({id,name:"Bot 1"},null,2));
}

app.get("/", (req,res)=>res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ITS_MK Multi Bot Panel</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b0f14;color:#e6edf3;font:14px Arial,sans-serif}main{max-width:1100px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px}h1{margin:0;font-size:26px}button,input,textarea{font:inherit}button{border:0;border-radius:10px;padding:11px 14px;cursor:pointer;background:#212936;color:#fff}button:hover{filter:brightness(1.15)}.add{background:#238636}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}.card{background:#111820;border:1px solid #26313d;border-radius:16px;padding:18px;box-shadow:0 8px 30px #0004}.name{font-size:19px;font-weight:700}.status{margin:8px 0 16px;color:#8b949e}.online{color:#3fb950}.offline{color:#f85149}.actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.wide{grid-column:1/-1}.danger{background:#8e2b2b}.blue{background:#1f6feb}.modal{position:fixed;inset:0;background:#000b;display:none;align-items:center;justify-content:center;padding:20px}.box{width:min(600px,100%);background:#111820;border:1px solid #26313d;border-radius:16px;padding:20px}.box input,.box textarea{width:100%;background:#0b0f14;border:1px solid #303b48;color:#fff;border-radius:9px;padding:10px;margin:6px 0 12px}.row{display:flex;gap:8px;flex-wrap:wrap}.hint{color:#8b949e;font-size:12px;margin-top:4px}</style></head><body><main><div class="top"><div><h1>🤖 Minecraft Multi-Bot Panel</h1><div class="hint">Multiple bots • one dashboard • independent controls</div></div><button class="add" onclick="openAdd()">＋ Add Bot</button></div><div id="grid" class="grid"></div></main><div id="modal" class="modal"><div class="box"><h2 id="mtitle">Add Bot</h2><label>Bot ID</label><input id="id" placeholder="bot-2"><label>Display name</label><input id="name" placeholder="My Bot 2"><label>Server IP</label><input id="ip" placeholder="play.example.com"><label>Server Port</label><input id="port" value="25565" type="number"><label>Minecraft username</label><input id="user" placeholder="BotAccount"><div class="row"><button class="add" onclick="createBot()">Create</button><button onclick="closeModal()">Cancel</button></div><div class="hint">Password/auth/version can be edited from Settings after creation.</div></div></div><script>
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function api(u,o={}){const r=await fetch(u,{...o,headers:{'Content-Type':'application/json',...(o.headers||{})}});return r.json()}
async function load(){const d=await api('/api/bots');grid.innerHTML=d.bots.map(function(b){return '<div class="card"><div class="name">'+esc(b.name||b.id)+'</div><div class="hint">'+esc(b.id)+'</div><div class="status '+(b.status==='connected'?'online':'offline')+'">● '+esc(b.status||'stopped')+(b.server?' • '+esc(b.server):'')+'</div><div class="actions"><button class="add" onclick="act(\''+b.id+'\',\'start\')">▶ Start</button><button class="danger" onclick="act(\''+b.id+'\',\'stop\')">■ Stop</button><button class="blue" onclick="act(\''+b.id+'\',\'restart\')">↻ Restart</button><button onclick="chat(\''+b.id+'\')">💬 Chat</button><button onclick="cmd(\''+b.id+'\')">⌨ Command</button><button onclick="settings(\''+b.id+'\')">⚙ Settings</button><button class="wide" onclick="logs(\''+b.id+'\')">📜 Logs / Health</button></div></div>';}).join('')||'<div class="card">No bots yet. Click Add Bot.</div>'}
async function act(id,a){const d=await api('/api/bots/'+encodeURIComponent(id)+'/'+a,{method:'POST'});alert(d.msg||'Done');load()} async function chat(id){const x=prompt('Minecraft chat message:');if(x)alert((await api('/api/bots/'+encodeURIComponent(id)+'/chat',{method:'POST',body:JSON.stringify({message:x})})).msg)} async function cmd(id){const x=prompt('Minecraft command (without /):');if(x)alert((await api('/api/bots/'+encodeURIComponent(id)+'/command',{method:'POST',body:JSON.stringify({command:x})})).msg)} async function logs(id){const d=await api('/api/bots/'+encodeURIComponent(id)+'/health');alert(JSON.stringify(d,null,2))} function settings(id){location.href='/bot/'+encodeURIComponent(id)} function openAdd(){modal.style.display='flex'} function closeModal(){modal.style.display='none'} async function createBot(){const d=await api('/api/bots',{method:'POST',body:JSON.stringify({id:id.value,name:name.value,ip:ip.value,port:Number(port.value),username:user.value})});alert(d.msg||'Created');if(d.success){closeModal();load()}} load();setInterval(load,5000);</script></body></html>`));

app.get('/bot/:id',(req,res)=>{const id=safeId(req.params.id); if(!fs.existsSync(settingsPath(id))) return res.status(404).send('Bot not found'); res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${id} Settings</title><style>body{background:#0b0f14;color:#e6edf3;font:14px Arial;padding:24px}main{max-width:800px;margin:auto}textarea{width:100%;height:500px;background:#111820;color:#fff;border:1px solid #303b48;border-radius:12px;padding:14px;font-family:monospace}.row{display:flex;gap:10px;margin:12px 0}button{padding:11px 15px;border:0;border-radius:9px;background:#238636;color:#fff}a{color:#58a6ff}</style></head><body><main><a href="/">← Back</a><h1>⚙ ${id} Settings</h1><textarea id="x"></textarea><div class="row"><button onclick="save()">Save Settings</button><button onclick="restart()">Restart Bot</button></div><script>async function load(){x.value=JSON.stringify((await (await fetch('/api/bots/${id}/settings')).json()).settings,null,2)}async function save(){try{const d=await (await fetch('/api/bots/${id}/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:x.value})).json();alert(d.msg)}catch(e){alert(e)}}async function restart(){alert((await (await fetch('/api/bots/${id}/restart',{method:'POST'})).json()).msg)}load()</script></main></body></html>`)});

app.get('/api/bots', auth, async (req,res)=>{const out=[];for(const id of listBots()){const m=meta(id), s=readJson(settingsPath(id),{});let h={status:'stopped'};if(bots.has(id)){try{h=await workerRequest(id,'/health')}catch(_){h={status:'starting'}}}out.push({id,name:m.name||s.name||id,status:h.status,server:s.server?`${s.server.ip}:${s.server.port}`:''});}res.json({success:true,bots:out})});
app.post('/api/bots', auth, (req,res)=>{const id=safeId(req.body.id);if(!id)return res.json({success:false,msg:'Invalid bot ID'});if(fs.existsSync(settingsPath(id)))return res.json({success:false,msg:'Bot already exists'});const dir=path.join(DATA_DIR,id);fs.mkdirSync(dir,{recursive:true});let s=readJson(BASE_SETTINGS,{});s.name=req.body.name||id;s.server=s.server||{};s.server.ip=req.body.ip||s.server.ip||'';s.server.port=Number(req.body.port||s.server.port||25565);s['bot-account']=s['bot-account']||{};s['bot-account'].username=req.body.username||s['bot-account'].username||id;fs.writeFileSync(settingsPath(id),JSON.stringify(s,null,2));fs.writeFileSync(metaPath(id),JSON.stringify({id,name:req.body.name||id},null,2));res.json({success:true,msg:`${id} created`})});
async function control(id,action,res){try{if(!bots.has(id))spawnBot(id);await waitWorker(id);let d;if(action==='start')d=await workerRequest(id,'/start',{method:'POST'});else if(action==='stop')d=await workerRequest(id,'/stop',{method:'POST'});else d=await workerRequest(id,'/api/restart',{method:'POST'});res.json(d)}catch(e){res.json({success:false,msg:e.message})}}
for(const a of ['start','stop','restart']) app.post('/api/bots/:id/'+a,auth,(req,res)=>control(safeId(req.params.id),a,res));
app.post('/api/bots/:id/chat',auth,async(req,res)=>{try{const id=safeId(req.params.id);if(!bots.has(id))spawnBot(id);await waitWorker(id);res.json(await workerRequest(id,'/command',{method:'POST',body:JSON.stringify({command:'say '+String(req.body.message||'')})}))}catch(e){res.json({success:false,msg:e.message})}});
app.post('/api/bots/:id/command',auth,async(req,res)=>{try{const id=safeId(req.params.id);if(!bots.has(id))spawnBot(id);await waitWorker(id);res.json(await workerRequest(id,'/command',{method:'POST',body:JSON.stringify({command:String(req.body.command||'').replace(/^\//,'')})}))}catch(e){res.json({success:false,msg:e.message})}});
app.get('/api/bots/:id/health',auth,async(req,res)=>{try{const id=safeId(req.params.id);if(!bots.has(id))return res.json({status:'stopped'});res.json(await workerRequest(id,'/health'))}catch(e){res.json({status:'error',msg:e.message})}});
app.get('/api/bots/:id/settings',auth,(req,res)=>{const id=safeId(req.params.id);res.json({success:true,settings:readJson(settingsPath(id),{})})});
app.post('/api/bots/:id/settings',auth,(req,res)=>{const id=safeId(req.params.id);try{if(!fs.existsSync(settingsPath(id)))return res.status(404).json({success:false,msg:'Bot not found'});fs.writeFileSync(settingsPath(id),JSON.stringify(req.body,null,2));res.json({success:true,msg:'Settings saved. Restart bot to apply.'})}catch(e){res.json({success:false,msg:e.message})}});

app.listen(PORT,'0.0.0.0',()=>console.log(`[Manager] Multi-bot panel on ${PORT}`));
