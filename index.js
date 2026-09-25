// ============================================================
// PROFESSIONAL MK PANEL
// ============================================================

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

<title>${config.name} • MK Panel</title>

<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

<style>

*{
 box-sizing:border-box;
 margin:0;
 padding:0;
}

:root{
 --bg:#05070b;
 --panel:#0b1017;
 --panel2:#101721;
 --border:#202a36;
 --text:#f5f7fa;
 --muted:#778496;
 --green:#38e58a;
 --red:#ff5968;
 --blue:#638cff;
 --yellow:#ffd166;
}

html{
 scroll-behavior:smooth;
}

body{
 min-height:100vh;
 overflow-x:hidden;
 background:
 radial-gradient(circle at 15% 10%,
 rgba(88,110,255,.15),
 transparent 28%),
 radial-gradient(circle at 90% 90%,
 rgba(35,230,135,.08),
 transparent 30%),
 var(--bg);
 color:var(--text);
 font-family:Inter,Arial,sans-serif;
}

/* animated background */

body:before,
body:after{
 content:"";
 position:fixed;
 width:350px;
 height:350px;
 border-radius:50%;
 filter:blur(100px);
 opacity:.08;
 pointer-events:none;
 z-index:-1;
}

body:before{
 background:#5c78ff;
 top:-120px;
 left:-100px;
 animation:float1 9s ease-in-out infinite;
}

body:after{
 background:#24df83;
 right:-100px;
 bottom:-130px;
 animation:float2 11s ease-in-out infinite;
}

@keyframes float1{
 50%{transform:translate(80px,70px)}
}

@keyframes float2{
 50%{transform:translate(-70px,-60px)}
}

/* SIDEBAR */

.sidebar{
 position:fixed;
 top:0;
 bottom:0;
 left:0;
 width:245px;
 padding:25px 15px;
 background:rgba(7,11,17,.88);
 border-right:1px solid var(--border);
 backdrop-filter:blur(20px);
 z-index:50;
}

.logo{
 padding:5px 12px 30px;
}

.logo h1{
 font-size:22px;
 font-weight:800;
 letter-spacing:-1px;
}

.logo p{
 margin-top:5px;
 font-size:9px;
 color:var(--muted);
 letter-spacing:1px;
}

.nav{
 display:flex;
 flex-direction:column;
 gap:7px;
}

.nav button{
 width:100%;
 border:1px solid transparent;
 background:transparent;
 color:#778394;
 padding:13px;
 border-radius:11px;
 text-align:left;
 cursor:pointer;
 transition:.25s;
}

.nav button:hover,
.nav button.active{
 color:white;
 background:#141b25;
 border-color:#26313f;
 transform:translateX(3px);
}

.nav-icon{
 display:inline-block;
 width:24px;
}

.credits{
 position:absolute;
 left:15px;
 right:15px;
 bottom:20px;
 padding-top:15px;
 border-top:1px solid var(--border);
 text-align:center;
 color:#414c5b;
 font-size:9px;
 line-height:1.9;
}

.credits strong{
 color:#687587;
}

/* MAIN */

.main{
 margin-left:245px;
 padding:35px;
 max-width:1500px;
}

.topbar{
 display:flex;
 align-items:center;
 justify-content:space-between;
 margin-bottom:28px;
}

.title h2{
 font-size:28px;
 letter-spacing:-1px;
}

.title p{
 margin-top:6px;
 color:var(--muted);
 font-size:12px;
}

.actions{
 display:flex;
 gap:8px;
}

.icon{
 width:43px;
 height:43px;
 border-radius:11px;
 border:1px solid var(--border);
 background:var(--panel);
 color:#9ba6b5;
 cursor:pointer;
 transition:.2s;
}

.icon:hover{
 color:white;
 background:#151e29;
 transform:translateY(-2px);
}

.icon:active{
 transform:scale(.94);
}

/* STATUS */

.status{
 position:relative;
 overflow:hidden;
 display:flex;
 align-items:center;
 justify-content:space-between;
 padding:24px;
 border-radius:17px;
 border:1px solid var(--border);
 background:
 linear-gradient(120deg,
 rgba(55,229,138,.08),
 transparent 60%),
 var(--panel);
 animation:appear .5s ease;
}

.status:after{
 content:"";
 position:absolute;
 width:180px;
 height:180px;
 right:-90px;
 top:-90px;
 border-radius:50%;
 border:1px solid rgba(255,255,255,.04);
 animation:rotate 12s linear infinite;
}

@keyframes rotate{
 to{transform:rotate(360deg)}
}

@keyframes appear{
 from{
  opacity:0;
  transform:translateY(15px);
 }
 to{
  opacity:1;
  transform:none;
 }
}

.status-left{
 display:flex;
 align-items:center;
 gap:15px;
}

.status-icon{
 width:51px;
 height:51px;
 display:flex;
 align-items:center;
 justify-content:center;
 border-radius:15px;
 background:#251116;
 color:var(--red);
 font-size:21px;
}

.status-icon.online{
 background:#0b291b;
 color:var(--green);
 animation:pulse 2s infinite;
}

@keyframes pulse{
 0%,100%{
  box-shadow:0 0 0 0 transparent;
 }
 50%{
  box-shadow:0 0 0 9px rgba(56,229,138,.07);
 }
}

.status-title{
 font-size:17px;
 font-weight:800;
}

.status-desc{
 margin-top:5px;
 color:var(--muted);
 font-size:11px;
}

.badge{
 padding:7px 13px;
 border-radius:30px;
 background:#251116;
 color:var(--red);
 font-size:10px;
 font-weight:800;
}

.badge.online{
 background:#0b291b;
 color:var(--green);
}

/* STATS */

.stats{
 display:grid;
 grid-template-columns:repeat(4,1fr);
 gap:13px;
 margin-top:15px;
}

.card{
 position:relative;
 overflow:hidden;
 padding:20px;
 border:1px solid var(--border);
 border-radius:14px;
 background:rgba(11,16,23,.92);
 transition:.25s;
 animation:card .6s ease both;
}

.card:nth-child(2){animation-delay:.05s}
.card:nth-child(3){animation-delay:.1s}
.card:nth-child(4){animation-delay:.15s}

@keyframes card{
 from{
  opacity:0;
  transform:translateY(18px);
 }
 to{
  opacity:1;
  transform:none;
 }
}

.card:hover{
 transform:translateY(-4px);
 border-color:#2d3948;
}

.card:before{
 content:"";
 position:absolute;
 top:0;
 left:-100%;
 width:60%;
 height:1px;
 background:linear-gradient(
  90deg,
  transparent,
  #6f91ff,
  transparent
 );
 animation:scan 4s linear infinite;
}

@keyframes scan{
 to{left:150%}
}

.label{
 color:var(--muted);
 font-size:10px;
 font-weight:700;
 letter-spacing:.7px;
 text-transform:uppercase;
}

.value{
 margin-top:9px;
 font-size:19px;
 font-weight:800;
}

.sub{
 margin-top:5px;
 color:#4d5968;
 font-size:9px;
}

/* BUTTONS */

.controls{
 display:grid;
 grid-template-columns:repeat(3,1fr);
 gap:11px;
 margin-top:15px;
}

.control{
 height:55px;
 border-radius:12px;
 font-size:12px;
 font-weight:800;
 cursor:pointer;
 transition:.2s;
 border:1px solid var(--border);
 position:relative;
 overflow:hidden;
}

.control:after{
 content:"";
 position:absolute;
 width:70px;
 height:100%;
 top:0;
 left:-100px;
 transform:skewX(-20deg);
 background:rgba(255,255,255,.08);
 transition:.5s;
}

.control:hover:after{
 left:120%;
}

.control:hover{
 transform:translateY(-2px);
 filter:brightness(1.12);
}

.control:active{
 transform:scale(.97);
}

.start{
 background:#0b2418;
 border-color:#1d6541;
 color:var(--green);
}

.stop{
 background:#251014;
 border-color:#692731;
 color:var(--red);
}

.restart{
 background:#10182d;
 border-color:#30467f;
 color:#7898ff;
}

/* LOADING */

.loading{
 pointer-events:none;
 opacity:.55;
}

.spinner{
 display:inline-block;
 width:12px;
 height:12px;
 border:2px solid currentColor;
 border-right-color:transparent;
 border-radius:50%;
 animation:spin .6s linear infinite;
 margin-right:7px;
}

@keyframes spin{
 to{transform:rotate(360deg)}
}

/* LOGS */

.section{
 margin-top:18px;
}

.section-head{
 display:flex;
 justify-content:space-between;
 align-items:center;
 margin-bottom:10px;
}

.section-head h3{
 font-size:14px;
}

.section-head span{
 color:var(--muted);
 font-size:10px;
}

.logs{
 height:300px;
 overflow:auto;
 padding:15px;
 border:1px solid var(--border);
 border-radius:14px;
 background:#06090e;
 color:#8995a5;
 font-family:Consolas,monospace;
 font-size:11px;
 line-height:1.75;
}

.log{
 padding:2px 0;
 border-bottom:1px solid rgba(255,255,255,.025);
}

/* MODAL */

.overlay{
 position:fixed;
 inset:0;
 display:none;
 align-items:center;
 justify-content:center;
 background:rgba(0,0,0,.76);
 backdrop-filter:blur(10px);
 z-index:100;
}

.overlay.show{
 display:flex;
}

.modal{
 width:min(490px,calc(100% - 28px));
 border:1px solid #293544;
 border-radius:18px;
 background:#0c121a;
 box-shadow:0 30px 100px rgba(0,0,0,.65);
 animation:modalIn .22s ease;
 overflow:hidden;
}

@keyframes modalIn{
 from{
  opacity:0;
  transform:translateY(20px) scale(.96);
 }
 to{
  opacity:1;
  transform:none;
 }
}

.modal-head{
 display:flex;
 justify-content:space-between;
 align-items:center;
 padding:19px;
 border-bottom:1px solid var(--border);
}

.modal-head h3{
 font-size:16px;
}

.close{
 border:0;
 background:none;
 color:#7b8797;
 font-size:23px;
 cursor:pointer;
}

.modal-body{
 padding:19px;
}

.setting{
 display:flex;
 justify-content:space-between;
 align-items:center;
 padding:14px 0;
 border-bottom:1px solid #19222d;
}

.setting-name{
 font-size:12px;
 font-weight:700;
}

.setting-desc{
 margin-top:4px;
 color:#586677;
 font-size:9px;
}

.switch{
 position:relative;
 width:43px;
 height:23px;
}

.switch input{
 display:none;
}

.slider{
 position:absolute;
 inset:0;
 border-radius:20px;
 background:#252e3a;
 cursor:pointer;
 transition:.2s;
}

.slider:before{
 content:"";
 position:absolute;
 width:17px;
 height:17px;
 left:3px;
 top:3px;
 border-radius:50%;
 background:#8c98a7;
 transition:.2s;
}

.switch input:checked+.slider{
 background:#17653f;
}

.switch input:checked+.slider:before{
 transform:translateX(20px);
 background:#45df8b;
}

.select{
 border:1px solid #2a3544;
 border-radius:8px;
 padding:7px;
 background:#151d27;
 color:white;
 font-size:10px;
}

.save{
 width:100%;
 height:45px;
 margin-top:17px;
 border:0;
 border-radius:10px;
 background:var(--green);
 color:#06130c;
 font-size:11px;
 font-weight:800;
 cursor:pointer;
 transition:.2s;
}

.save:hover{
 filter:brightness(1.08);
 transform:translateY(-1px);
}

/* TOAST */

.toasts{
 position:fixed;
 right:20px;
 bottom:20px;
 z-index:200;
 display:flex;
 flex-direction:column;
 gap:8px;
}

.toast{
 min-width:250px;
 padding:13px 15px;
 border-radius:11px;
 border:1px solid #293543;
 background:#101720;
 box-shadow:0 15px 50px rgba(0,0,0,.5);
 font-size:11px;
 animation:toastIn .25s ease;
}

.toast.success{
 border-color:#216543;
}

.toast.error{
 border-color:#70303b;
}

@keyframes toastIn{
 from{
  opacity:0;
  transform:translateX(20px);
 }
 to{
  opacity:1;
  transform:none;
 }
}

/* FOOTER */

.footer{
 text-align:center;
 padding:25px;
 margin-top:22px;
 color:#414b59;
 font-size:9px;
 line-height:1.9;
}

.footer strong{
 color:#6b7889;
}

/* MOBILE */

@media(max-width:950px){

 .sidebar{
  width:70px;
 }

 .logo{
  padding-left:0;
  padding-right:0;
  text-align:center;
 }

 .logo h1{
  font-size:15px;
 }

 .logo p,
 .nav-text,
 .credits{
  display:none;
 }

 .nav button{
  text-align:center;
  padding:13px 0;
 }

 .main{
  margin-left:70px;
 }

 .stats{
  grid-template-columns:repeat(2,1fr);
 }

}

@media(max-width:600px){

 .main{
  padding:16px;
 }

 .title h2{
  font-size:22px;
 }

 .status{
  padding:17px;
 }

 .badge{
  display:none;
 }

 .controls{
  grid-template-columns:1fr;
 }

 .stats{
  gap:9px;
 }

 .card{
  padding:15px;
 }

 .toasts{
  left:15px;
  right:15px;
  bottom:15px;
 }

 .toast{
  min-width:0;
 }

}

</style>
</head>

<body>

<aside class="sidebar">

 <div class="logo">
  <h1>MK PANEL</h1>
  <p>MINECRAFT CONTROL</p>
 </div>

 <nav class="nav">

  <button class="active" onclick="topPage()">
   <span class="nav-icon">⌂</span>
   <span class="nav-text">Dashboard</span>
  </button>

  <button onclick="logsPage()">
   <span class="nav-icon">▤</span>
   <span class="nav-text">Live Logs</span>
  </button>

  <button onclick="openSettings()">
   <span class="nav-icon">⚙</span>
   <span class="nav-text">Settings</span>
  </button>

 </nav>

 <div class="credits">
  <strong>MADE BY MAYANK_KEER</strong><br>
  MADE BY ITS_MK_PLAYS
 </div>

</aside>


<main class="main">

 <div class="topbar">

  <div class="title">
   <h2>Control Dashboard</h2>
   <p>Real-time Minecraft bot management</p>
  </div>

  <div class="actions">

   <button class="icon" onclick="refreshAll()">↻</button>

   <button class="icon" onclick="openSettings()">⚙</button>

  </div>

 </div>


 <section class="status">

  <div class="status-left">

   <div id="statusIcon" class="status-icon">
    ✕
   </div>

   <div>

    <div id="statusTitle" class="status-title">
     Disconnected
    </div>

    <div id="statusDesc" class="status-desc">
     Waiting for bot connection
    </div>

   </div>

  </div>

  <div id="badge" class="badge">
   OFFLINE
  </div>

 </section>


 <section class="stats">

  <div class="card">
   <div class="label">Uptime</div>
   <div id="uptime" class="value">0s</div>
   <div class="sub">Current session</div>
  </div>

  <div class="card">
   <div class="label">Coordinates</div>
   <div id="coords" class="value">—</div>
   <div class="sub">In-game position</div>
  </div>

  <div class="card">
   <div class="label">Server</div>
   <div id="server" class="value">Loading</div>
   <div class="sub">Minecraft server</div>
  </div>

  <div class="card">
   <div class="label">Memory</div>
   <div id="memory" class="value">— MB</div>
   <div class="sub">Node.js heap</div>
  </div>

 </section>


 <section class="controls">

  <button id="startBtn"
   class="control start"
   onclick="botAction('/start','Starting bot...')">
   ▶ START BOT
  </button>

  <button id="stopBtn"
   class="control stop"
   onclick="botAction('/stop','Stopping bot...')">
   ■ STOP BOT
  </button>

  <button id="restartBtn"
   class="control restart"
   onclick="botAction('/restart','Restarting bot...')">
   ↻ RESTART BOT
  </button>

 </section>


 <section id="logsSection" class="section">

  <div class="section-head">
   <h3>Live Console</h3>
   <span id="logCount">0 entries</span>
  </div>

  <div id="logs" class="logs">
   Loading logs...
  </div>

 </section>


 <footer class="footer">

  <strong>MADE BY MAYANK_KEER</strong><br>
  MADE BY ITS_MK_PLAYS<br>
  MK PANEL • MINECRAFT BOT CONTROL

 </footer>

</main>


<!-- SETTINGS -->

<div id="overlay" class="overlay" onclick="outside(event)">

 <div class="modal">

  <div class="modal-head">

   <h3>Panel Settings</h3>

   <button class="close" onclick="closeSettings()">×</button>

  </div>

  <div class="modal-body">

   <div class="setting">

    <div>
     <div class="setting-name">Auto Reconnect</div>
     <div class="setting-desc">
      Automatically reconnect after disconnect
     </div>
    </div>

    <label class="switch">
     <input id="autoReconnect" type="checkbox">
     <span class="slider"></span>
    </label>

   </div>


   <div class="setting">

    <div>
     <div class="setting-name">Auto Start</div>
     <div class="setting-desc">
      Start bot when panel launches
     </div>
    </div>

    <label class="switch">
     <input id="autoStart" type="checkbox">
     <span class="slider"></span>
    </label>

   </div>


   <div class="setting">

    <div>
     <div class="setting-name">Show Coordinates</div>
     <div class="setting-desc">
      Display bot position
     </div>
    </div>

    <label class="switch">
     <input id="showCoordinates" type="checkbox">
     <span class="slider"></span>
    </label>

   </div>


   <div class="setting">

    <div>
     <div class="setting-name">Interface Sounds</div>
     <div class="setting-desc">
      Enable animated UI sounds
     </div>
    </div>

    <label class="switch">
     <input id="sounds" type="checkbox">
     <span class="slider"></span>
    </label>

   </div>


   <div class="setting">

    <div>
     <div class="setting-name">Refresh Rate</div>
     <div class="setting-desc">
      Live dashboard update speed
     </div>
    </div>

    <select id="refreshRate" class="select">
     <option value="2000">2 Seconds</option>
     <option value="5000">5 Seconds</option>
     <option value="10000">10 Seconds</option>
    </select>

   </div>


   <button class="save" onclick="saveSettings()">
    SAVE SETTINGS
   </button>

  </div>

 </div>

</div>


<div id="toasts" class="toasts"></div>


<script>

let timer=null;
let audio=null;


/* SOUND ENGINE */

function playSound(type="click"){

 try{

  if(
   document.getElementById("sounds") &&
   !document.getElementById("sounds").checked
  ) return;

  audio ??=
   new (
    window.AudioContext ||
    window.webkitAudioContext
   )();

  const osc=audio.createOscillator();
  const gain=audio.createGain();

  osc.connect(gain);
  gain.connect(audio.destination);

  const now=audio.currentTime;

  osc.frequency.value=
   type==="success" ? 720 :
   type==="error" ? 180 :
   440;

  gain.gain.setValueAtTime(.0001,now);

  gain.gain.exponentialRampToValueAtTime(
   .04,now+.01
  );

  gain.gain.exponentialRampToValueAtTime(
   .0001,now+.12
  );

  osc.start(now);
  osc.stop(now+.13);

 }catch{}

}


/* TOAST */

function toast(message,type="success"){

 playSound(type);

 const parent=
  document.getElementById("toasts");

 const el=
  document.createElement("div");

 el.className=
  "toast "+type;

 el.textContent=
  message;

 parent.appendChild(el);

 setTimeout(()=>{

  el.style.opacity="0";
  el.style.transform="translateX(20px)";

  setTimeout(
   ()=>el.remove(),
   250
  );

 },2800);

}


/* FORMAT */

function formatTime(s){

 s=Math.floor(s||0);

 const h=Math.floor(s/3600);
 const m=Math.floor((s%3600)/60);
 const sec=s%60;

 if(h)return h+"h "+m+"m "+sec+"s";
 if(m)return m+"m "+sec+"s";

 return sec+"s";

}


/* STATUS */

async function refreshStatus(){

 try{

  const r=
   await fetch("/health");

  const d=
   await r.json();

  const online=
   d.status==="connected";


  const icon=
   document.getElementById("statusIcon");

  icon.className=
   "status-icon "+
   (online?"online":"");

  icon.textContent=
   online?"✓":"✕";


  document.getElementById("statusTitle")
   .textContent=
   online
    ?"Bot Connected"
    :"Bot Disconnected";


  document.getElementById("statusDesc")
   .textContent=
   online
    ?"Bot is active on the server"
    :"Waiting for connection";


  const badge=
   document.getElementById("badge");

  badge.className=
   "badge "+(online?"online":"");

  badge.textContent=
   online?"ONLINE":"OFFLINE";


  document.getElementById("uptime")
   .textContent=
   formatTime(d.uptime);


  document.getElementById("memory")
   .textContent=
   Math.round(
    d.memoryUsage||0
   )+" MB";


  if(d.coords){

   document.getElementById("coords")
    .textContent=
    Math.floor(d.coords.x)+
    ", "+
    Math.floor(d.coords.y)+
    ", "+
    Math.floor(d.coords.z);

  }else{

   document.getElementById("coords")
    .textContent="—";

  }

 }catch{

  document.getElementById("statusTitle")
   .textContent=
   "Panel Unreachable";

 }

}


/* LOGS */

async function refreshLogs(){

 try{

  const r=
   await fetch("/api/logs");

  const d=
   await r.json();

  const logs=
   Array.isArray(d.logs)
    ?d.logs
    :[];


  document.getElementById("logCount")
   .textContent=
   logs.length+" entries";


  const box=
   document.getElementById("logs");


  if(!logs.length){

   box.innerHTML=
    '<div class="log">No logs available.</div>';

   return;

  }


  box.innerHTML=
   logs.slice(-150)
   .map(x=>
    '<div class="log">'+
    escapeHTML(String(x))+
    '</div>'
   )
   .join("");


  box.scrollTop=
   box.scrollHeight;

 }catch{

  document.getElementById("logs")
   .innerHTML=
   '<div class="log">Log connection failed.</div>';

 }

}


function escapeHTML(s){

 return s
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;")
  .replaceAll("'","&#039;");

}


/* BOT ACTION */

async function botAction(url,message){

 const button=
  event?.currentTarget;

 if(button){

  button.classList.add("loading");

  button.innerHTML=
   '<span class="spinner"></span>'+
   message.toUpperCase();

 }

 playSound();

 toast(message,"success");

 try{

  const r=
   await fetch(url,{
    method:"POST"
   });

  const d=
   await r.json();

  toast(
   d.msg ||
   (d.success
    ?"Action completed"
    :"Action failed"),
   d.success
    ?"su
