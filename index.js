"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalNear } = goals;
const config = require("./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");

// ============================================================
// STATE
// ============================================================
let bot = null;
let afkTimer = null;
let reconnectTimer = null;
let manualStop = false;

const botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
};

// Settings that the dashboard can actually change at runtime.
// These are read by the bot logic below, so toggling them from
// the panel changes real behaviour immediately (nothing here
// touches settings.json).
const runtimeSettings = {
  autoReconnect: true,
  afkMovement: true,
  moveIntervalMs: 15000,
};

const SERVER_HOST = config?.server?.ip || "localhost";
const SERVER_PORT = config?.server?.port || 25565;
const SERVER_VERSION = config?.server?.version || false;
const BOT_USERNAME =
  config?.["bot-account"]?.username || config?.bot?.username || config?.name || "AFK_Bot";

// ============================================================
// BOT LOGIC
// ============================================================
function createBot() {
  manualStop = false;
  addLog("info", `Connecting to ${SERVER_HOST}:${SERVER_PORT} as ${BOT_USERNAME}...`);

  bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: BOT_USERNAME,
    version: SERVER_VERSION,
  });

  bot.loadPlugin(pathfinder);

  bot.once("spawn", () => {
    botState.connected = true;
    botState.reconnectAttempts = 0;
    botState.lastActivity = Date.now();
    addLog("success", "Bot has spawned in the world.");

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    if (runtimeSettings.afkMovement) startAfkLoop();
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    botState.lastActivity = Date.now();
    addLog("chat", `<${username}> ${message}`);
  });

  bot.on("kicked", (reason) => {
    addLog("error", `Bot was kicked: ${reason}`);
  });

  bot.on("error", (err) => {
    botState.errors.push({ message: err.message, time: Date.now() });
    addLog("error", `Bot error: ${err.message}`);
  });

  bot.on("end", () => {
    botState.connected = false;
    stopAfkLoop();
    addLog("warn", "Bot disconnected from the server.");

    if (!manualStop && runtimeSettings.autoReconnect) {
      scheduleReconnect();
    }
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  botState.reconnectAttempts += 1;
  const delay = Math.min(5000 * botState.reconnectAttempts, 60000);
  addLog("info", `Reconnecting in ${Math.round(delay / 1000)}s (attempt ${botState.reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    if (!manualStop && runtimeSettings.autoReconnect) createBot();
  }, delay);
}

function startAfkLoop() {
  stopAfkLoop();
  afkTimer = setInterval(() => {
    if (!bot || !bot.entity) return;
    try {
      const pos = bot.entity.position;
      const dx = Math.floor(Math.random() * 6) - 3;
      const dz = Math.floor(Math.random() * 6) - 3;
      bot.pathfinder.setGoal(new GoalNear(pos.x + dx, pos.y, pos.z + dz, 1));
      bot.setControlState("jump", true);
      setTimeout(() => bot && bot.setControlState("jump", false), 300);
    } catch (e) {
      addLog("error", `AFK movement error: ${e.message}`);
    }
  }, runtimeSettings.moveIntervalMs);
}

function stopAfkLoop() {
  if (afkTimer) {
    clearInterval(afkTimer);
    afkTimer = null;
  }
}

function startBotProcess() {
  if (bot && botState.connected) {
    return { success: false, msg: "Bot is already running." };
  }
  createBot();
  return { success: true };
}

function stopBotProcess() {
  if (!bot) {
    return { success: false, msg: "Bot is not running." };
  }
  manualStop = true;
  clearTimeout(reconnectTimer);
  stopAfkLoop();
  bot.quit("Stopped via dashboard");
  bot = null;
  botState.connected = false;
  addLog("info", "Bot stopped via dashboard.");
  return { success: true };
}

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

function renderPage(title, activeNav, bodyHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<title>${title}</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" media="print" onload="this.media='all'"
href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap">
<style>${SHARED_CSS}</style>
</head>
<body>
  <div class="grid-bg" aria-hidden="true"></div>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">AB</div>
      <div class="brand-text">
        <strong>${config.name || "AFK Bot"}</strong>
        <span>Control Panel</span>
      </div>
    </div>
    <nav class="topnav">
      <a href="/" class="${activeNav === "home" ? "active" : ""}">Dashboard</a>
      <a href="/logs" class="${activeNav === "logs" ? "active" : ""}">Logs</a>
      <a href="/tutorial" class="${activeNav === "guide" ? "active" : ""}">Guide</a>
    </nav>
    <div class="topbar-right">
      <span class="live-dot" id="topbar-dot" aria-hidden="true"></span>
      <button class="icon-btn" id="gearBtn" aria-label="Open settings" onclick="toggleSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </div>
  </header>

  <main class="page">
    ${bodyHtml}
  </main>

  <div class="modal-backdrop" id="settingsBackdrop" onclick="toggleSettings()"></div>
  <div class="modal" id="settingsModal" role="dialog" aria-label="Settings">
    <div class="modal-head">
      <h2>Settings</h2>
      <button class="icon-btn" aria-label="Close settings" onclick="toggleSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <p class="modal-sub">Panel settings apply instantly. Bot-side toggles change live behaviour &mdash; <code>settings.json</code> is never touched.</p>

    <div class="setting-group">
      <div class="setting-group-title">Bot behaviour</div>
      <div class="setting-row">
        <div><div class="label">Auto-reconnect</div><div class="desc">Reconnect automatically after a disconnect</div></div>
        <label class="switch"><input type="checkbox" id="autoReconnect" onchange="pushBotSetting('autoReconnect', this.checked)"><span class="track"></span></label>
      </div>
      <div class="setting-row">
        <div><div class="label">Anti-AFK movement</div><div class="desc">Wander and jump periodically to avoid idle kicks</div></div>
        <label class="switch"><input type="checkbox" id="afkMovement" onchange="pushBotSetting('afkMovement', this.checked)"><span class="track"></span></label>
      </div>
      <div class="setting-row">
        <div><div class="label">Movement interval</div><div class="desc">How often the bot moves</div></div>
        <select class="rate" id="moveInterval" onchange="pushBotSetting('moveIntervalMs', parseInt(this.value,10))">
          <option value="8000">8s</option>
          <option value="15000">15s</option>
          <option value="30000">30s</option>
          <option value="60000">60s</option>
        </select>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-group-title">Panel</div>
      <div class="setting-row">
        <div><div class="label">Sound effects</div><div class="desc">Play a tone on actions and status changes</div></div>
        <label class="switch"><input type="checkbox" id="soundToggle" checked onchange="onSoundToggle(this)"><span class="track"></span></label>
      </div>
      <div class="setting-row">
        <div><div class="label">Refresh rate</div><div class="desc">How often this page polls the bot</div></div>
        <select class="rate" id="rateSelect" onchange="onRateChange(this)">
          <option value="2000">2s</option>
          <option value="5000" selected>5s</option>
          <option value="10000">10s</option>
        </select>
      </div>
    </div>

    <div class="modal-foot">Crafted by <span>MAYANK_KEER</span> &amp; <span>ITS_MK_PLAYS</span></div>
  </div>

  <div id="toastHost"></div>

  <footer class="page-footer">
    <div class="made-by"><span>MADE BY MAYANK_KEER</span><span>MADE BY ITS_MK_PLAYS</span></div>
  </footer>

<script>${SHARED_JS}</script>
</body>
</html>`;
}

const SHARED_CSS = `
:root{
  --bg:#0b0e14; --bg-2:#0e1220;
  --panel:#121826; --panel-2:#161e2e;
  --border:#212a3a; --border-soft:#1a2233;
  --text:#e8ecf4; --text-dim:#8d97ab; --text-faint:#5c6579;
  --indigo:#6d6af6; --indigo-glow:rgba(109,106,246,.35);
  --emerald:#34d399; --emerald-glow:rgba(52,211,153,.32);
  --amber:#f5b942; --red:#f76e6e; --red-glow:rgba(247,110,110,.3);
}
*,*::before,*::after{box-sizing:border-box;}
html{scroll-padding-top:64px;}
body{
  margin:0; font-family:'Inter',-apple-system,sans-serif; color:var(--text);
  background:var(--bg); min-height:100vh; padding-bottom:60px;
}
.grid-bg{
  position:fixed; inset:0; z-index:-1; pointer-events:none;
  background-image:
    linear-gradient(rgba(109,106,246,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(109,106,246,.05) 1px, transparent 1px);
  background-size:42px 42px;
  mask-image:radial-gradient(700px 500px at 30% 0%, black, transparent 75%);
}
.topbar{
  position:sticky; top:0; z-index:30;
  display:flex; align-items:center; gap:18px;
  padding:14px 22px; background:rgba(11,14,20,.85); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--border-soft);
}
.brand{display:flex; align-items:center; gap:10px;}
.brand-mark{
  width:34px; height:34px; border-radius:9px;
  background:linear-gradient(135deg,#3a3fb8,var(--indigo));
  color:#fff; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:13px;
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 6px 16px -6px var(--indigo-glow);
}
.brand-text{display:flex; flex-direction:column; line-height:1.2;}
.brand-text strong{font-family:'Space Grotesk',sans-serif; font-size:14.5px; color:#fff;}
.brand-text span{font-size:11px; color:var(--text-faint);}
.topnav{display:flex; gap:4px; margin-left:8px;}
.topnav a{
  font-size:13px; font-weight:600; color:var(--text-dim); text-decoration:none;
  padding:8px 12px; border-radius:8px; transition:background .2s, color .2s;
}
.topnav a:hover{background:var(--panel-2); color:#fff;}
.topnav a.active{background:var(--panel-2); color:#fff; box-shadow:inset 0 0 0 1px var(--border);}
.topbar-right{margin-left:auto; display:flex; align-items:center; gap:10px;}
.live-dot{width:9px; height:9px; border-radius:50%; background:var(--red); box-shadow:0 0 10px var(--red-glow); transition:background .3s, box-shadow .3s;}
.live-dot.online{background:var(--emerald); box-shadow:0 0 10px var(--emerald-glow); animation:dotpulse 2s ease-in-out infinite;}
@keyframes dotpulse{0%,100%{opacity:1;}50%{opacity:.45;}}
.icon-btn{
  width:36px; height:36px; border-radius:9px; border:1px solid var(--border);
  background:var(--panel-2); color:var(--text-dim); display:flex; align-items:center; justify-content:center;
  cursor:pointer; transition:background .2s, color .2s, transform .5s cubic-bezier(.2,.9,.3,1.2);
}
.icon-btn svg{width:17px; height:17px;}
.icon-btn:hover{background:#1c2438; color:#fff;}
.icon-btn.spin{transform:rotate(90deg);}

.page{max-width:760px; margin:0 auto; padding:34px 22px 10px;}

.rise{opacity:0; transform:translateY(12px); animation:rise .6s cubic-bezier(.16,.9,.3,1) forwards;}
.d1{animation-delay:.02s;} .d2{animation-delay:.09s;} .d3{animation-delay:.16s;} .d4{animation-delay:.23s;}
@keyframes rise{to{opacity:1; transform:translateY(0);}}

.hero{
  display:flex; align-items:center; justify-content:space-between; gap:20px;
  padding:26px 26px; border-radius:16px; margin-bottom:18px;
  background:linear-gradient(135deg, var(--panel), var(--panel-2));
  border:1px solid var(--border); position:relative; overflow:hidden;
}
.hero::before{
  content:""; position:absolute; inset:0; opacity:.6; pointer-events:none;
  background:radial-gradient(260px 140px at 90% -10%, var(--ring,transparent), transparent 70%);
  transition:background .4s ease;
}
.hero.online{--ring:var(--emerald-glow);}
.hero.offline{--ring:var(--red-glow);}
.hero-left{display:flex; align-items:center; gap:16px;}
.status-orb{
  position:relative; width:50px; height:50px; border-radius:14px;
  display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; font-size:19px;
  transition:background .3s, box-shadow .3s;
}
.status-orb.online{background:var(--emerald); box-shadow:0 0 22px var(--emerald-glow);}
.status-orb.offline{background:var(--red); box-shadow:0 0 22px var(--red-glow);}
.status-title{font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:700;}
.status-title.online{color:var(--emerald);}
.status-title.offline{color:var(--red);}
.status-sub{font-size:12.5px; color:var(--text-dim); margin-top:3px;}
.hero-scan{
  height:3px; border-radius:3px; background:var(--border-soft); overflow:hidden; margin-top:16px; position:relative;
}
.hero-scan .bar{position:absolute; inset:0; width:35%; background:linear-gradient(90deg,transparent,var(--indigo),transparent); animation:scan 2.4s linear infinite;}
@keyframes scan{0%{transform:translateX(-100%);}100%{transform:translateX(390%);}}

.stat-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:18px;}
.stat-card{
  background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:16px 18px;
  transition:transform .2s ease, border-color .2s ease;
}
.stat-card:hover{border-color:#2b364a; transform:translateY(-1px);}
.stat-card .stat-label{font-size:11px; letter-spacing:.03em; color:var(--text-faint); font-weight:600; text-transform:uppercase; margin-bottom:8px;}
.stat-card .stat-value{font-family:'JetBrains Mono',monospace; font-size:16.5px; font-weight:500; color:var(--text);}
.stat-card.wide{grid-column:1 / -1;}

.btn-row{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;}
.btn{
  min-height:50px; border-radius:12px; border:none; cursor:pointer; font-family:'Space Grotesk',sans-serif;
  font-size:14px; font-weight:700; color:#fff; transition:transform .15s ease, box-shadow .2s ease;
}
.btn:active{transform:scale(.97);}
.btn-start{background:linear-gradient(135deg,#28a978,var(--emerald)); box-shadow:0 8px 20px -8px var(--emerald-glow);}
.btn-stop{background:linear-gradient(135deg,#d64545,var(--red)); box-shadow:0 8px 20px -8px var(--red-glow);}
.link-row{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
.link-btn{
  min-height:42px; border-radius:12px; border:1px solid var(--border); background:var(--panel-2);
  color:var(--text-dim); font-size:13px; font-weight:600; text-decoration:none;
  display:flex; align-items:center; justify-content:center; transition:background .2s, color .2s;
}
.link-btn:hover{background:#1c2438; color:#fff;}

.page-footer{max-width:760px; margin:26px auto 0; padding:0 22px; text-align:center;}
.made-by{display:flex; flex-direction:column; gap:4px; font-family:'Space Grotesk',sans-serif; font-size:11px; font-weight:600; letter-spacing:.05em;}
.made-by span{background:linear-gradient(90deg,var(--indigo),var(--emerald)); -webkit-background-clip:text; background-clip:text; color:transparent;}

/* settings modal, opened from the top bar now instead of a floating button */
.modal-backdrop{position:fixed; inset:0; background:rgba(4,6,10,.65); backdrop-filter:blur(2px); opacity:0; pointer-events:none; transition:opacity .25s ease; z-index:50;}
.modal-backdrop.open{opacity:1; pointer-events:auto;}
.modal{
  position:fixed; top:50%; left:50%; z-index:51; width:min(420px, 92vw);
  background:var(--panel); border:1px solid var(--border); border-radius:18px; padding:22px 24px;
  transform:translate(-50%,-46%) scale(.96); opacity:0; pointer-events:none;
  transition:transform .3s cubic-bezier(.2,.9,.3,1.1), opacity .25s ease;
  box-shadow:0 30px 70px -20px rgba(0,0,0,.6);
  max-height:82vh; overflow-y:auto;
}
.modal.open{transform:translate(-50%,-50%) scale(1); opacity:1; pointer-events:auto;}
.modal-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;}
.modal-head h2{font-family:'Space Grotesk',sans-serif; font-size:17px; margin:0; color:#fff;}
.modal-sub{font-size:12px; color:var(--text-dim); margin:0 0 16px; line-height:1.5;}
.modal-sub code{background:var(--panel-2); padding:1px 6px; border-radius:5px; font-size:11px;}
.setting-group{margin-bottom:8px;}
.setting-group-title{font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-faint); font-weight:700; margin:14px 0 4px;}
.setting-row{display:flex; align-items:center; justify-content:space-between; gap:14px; padding:12px 0; border-top:1px solid var(--border-soft);}
.setting-row .label{font-size:13.5px; font-weight:600;}
.setting-row .desc{font-size:11px; color:var(--text-faint); margin-top:2px;}
.switch{position:relative; width:44px; height:25px; flex-shrink:0;}
.switch input{opacity:0; width:0; height:0;}
.switch .track{position:absolute; inset:0; background:#2a3142; border-radius:20px; cursor:pointer; transition:background .25s;}
.switch .track::before{content:""; position:absolute; width:19px; height:19px; left:3px; top:3px; background:#fff; border-radius:50%; transition:transform .25s cubic-bezier(.2,.9,.3,1.2);}
.switch input:checked + .track{background:var(--indigo);}
.switch input:checked + .track::before{transform:translateX(19px);}
select.rate{background:var(--panel-2); color:var(--text); border:1px solid var(--border); border-radius:8px; font-size:12.5px; font-family:inherit; padding:6px 9px; cursor:pointer;}
.modal-foot{margin-top:16px; padding-top:14px; border-top:1px solid var(--border-soft); text-align:center; font-size:10.5px; color:var(--text-faint); letter-spacing:.04em;}
.modal-foot span{color:var(--indigo); font-weight:700;}

#toastHost{position:fixed; left:50%; bottom:26px; transform:translateX(-50%); z-index:60; display:flex; flex-direction:column; gap:8px; align-items:center;}
.toast{background:var(--panel-2); border:1px solid var(--border); color:var(--text); padding:10px 16px; border-radius:10px; font-size:13px; opacity:0; transform:translateY(10px); transition:opacity .25s, transform .25s;}
.toast.show{opacity:1; transform:translateY(0);}

/* logs page */
.log-terminal{background:#0a0d14; border:1px solid var(--border); border-radius:14px; overflow:hidden;}
.log-terminal-head{display:flex; align-items:center; gap:8px; padding:12px 16px; background:var(--panel-2); border-bottom:1px solid var(--border);}
.dot{width:10px; height:10px; border-radius:50%;}
.dot-r{background:#ff5f57;} .dot-y{background:#ffbd2e;} .dot-g{background:#28c840;}
.log-terminal-head span{margin-left:6px; font-size:11px; color:var(--text-faint); font-family:'JetBrains Mono',monospace;}
.log-body{padding:16px 18px; max-height:60vh; overflow-y:auto; font-family:'JetBrains Mono',monospace; font-size:12px; line-height:1.8;}
.log-entry{display:block; white-space:pre-wrap; word-break:break-word;}
.log-entry.error{color:var(--red);} .log-entry.warn{color:var(--amber);} .log-entry.success{color:var(--emerald);} .log-entry.chat{color:#8fb8ff;} .log-entry.info{color:var(--text-dim);}
.badge{font-size:11px; font-weight:600; color:var(--text-dim); background:var(--panel-2); border:1px solid var(--border); border-radius:20px; padding:4px 12px;}

/* tutorial page */
.step-card{background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:22px; margin-bottom:14px;}
.step-header{display:flex; align-items:center; gap:12px; margin-bottom:14px;}
.step-number{width:30px; height:30px; border-radius:9px; background:var(--panel-2); border:1px solid var(--border); color:var(--indigo); font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.step-title{font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:700; color:#fff; margin:0;}
.step-card ol{margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:9px;}
.step-card li{font-size:13.5px; color:var(--text-dim); line-height:1.6; padding-left:18px; position:relative;}
.step-card li::before{content:"\\2022"; position:absolute; left:2px; color:var(--indigo);}
.step-card li strong{color:var(--text); font-weight:600;}
.step-card code{background:var(--panel-2); border:1px solid var(--border); padding:2px 7px; border-radius:5px; font-family:'JetBrains Mono',monospace; font-size:11.5px;}

@media (max-width:480px){
  .stat-grid{grid-template-columns:1fr;}
  .topnav{display:none;}
}
@media (prefers-reduced-motion: reduce){
  .rise, .live-dot.online, .hero-scan .bar{animation:none !important;}
  *{transition-duration:.01ms !important;}
}
`;

const SHARED_JS = `
// ---------- sound engine ----------
let audioCtx = null;
let soundOn = localStorage.getItem('afk_sound') !== 'off';
function ensureCtx(){ if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ audioCtx=null; } } return audioCtx; }
function beep(freq, dur, type, peak){
  if(!soundOn) return;
  const ctx = ensureCtx(); if(!ctx) return;
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.type = type||'sine'; osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(peak||0.08, ctx.currentTime+0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+dur);
  osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+dur+0.02);
}
function soundStart(){ beep(523.25,0.14,'triangle'); setTimeout(()=>beep(783.99,0.16,'triangle'),90); }
function soundStop(){ beep(392,0.14,'sawtooth'); setTimeout(()=>beep(261.63,0.18,'sawtooth'),90); }
function soundClick(){ beep(660,0.06,'square',0.05); }
function soundOnline(){ beep(880,0.12,'sine',0.06); }
function soundOffline(){ beep(220,0.16,'sine',0.06); }

// ---------- settings modal ----------
const modal = document.getElementById('settingsModal');
const backdrop = document.getElementById('settingsBackdrop');
const gearBtn = document.getElementById('gearBtn');
let modalOpen = false;
function toggleSettings(){
  modalOpen = !modalOpen;
  modal.classList.toggle('open', modalOpen);
  backdrop.classList.toggle('open', modalOpen);
  gearBtn.classList.toggle('spin', modalOpen);
  soundClick();
  if(modalOpen) loadBotSettings();
}
function onSoundToggle(el){ soundOn = el.checked; localStorage.setItem('afk_sound', soundOn?'on':'off'); if(soundOn) soundClick(); }

let autoRefreshRate = parseInt(localStorage.getItem('afk_rate')||'5000',10);
let refreshTimer = null;
function onRateChange(el){ autoRefreshRate = parseInt(el.value,10); localStorage.setItem('afk_rate', String(autoRefreshRate)); soundClick(); restartTimer(); }
function restartTimer(){ if(refreshTimer) clearInterval(refreshTimer); refreshTimer = setInterval(update, autoRefreshRate); }
document.getElementById('soundToggle') && (document.getElementById('soundToggle').checked = soundOn);
document.getElementById('rateSelect') && (document.getElementById('rateSelect').value = String(autoRefreshRate));

// ---------- server-side settings (actually affect index.js) ----------
async function loadBotSettings(){
  try{
    const r = await fetch('/api/settings');
    const s = await r.json();
    if(document.getElementById('autoReconnect')) document.getElementById('autoReconnect').checked = !!s.autoReconnect;
    if(document.getElementById('afkMovement')) document.getElementById('afkMovement').checked = !!s.afkMovement;
    if(document.getElementById('moveInterval')) document.getElementById('moveInterval').value = String(s.moveIntervalMs);
  }catch(e){ /* dashboard still usable without this */ }
}
async function pushBotSetting(key, value){
  soundClick();
  try{
    const body = {}; body[key] = value;
    const r = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const s = await r.json();
    toast('Updated ' + key.replace(/([A-Z])/g,' $1').toLowerCase());
  }catch(e){ toast('Could not update setting'); }
}

// ---------- toasts ----------
function toast(msg){
  const host = document.getElementById('toastHost'); if(!host) return;
  const el = document.createElement('div'); el.className='toast'; el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=> el.remove(), 250); }, 2200);
}

// ---------- dashboard polling ----------
function formatUptime(s){
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if(h>0) return h+'h '+m+'m '+sec+'s';
  if(m>0) return m+'m '+sec+'s';
  return sec+' seconds';
}
let wasOnline = null;
async function update(){
  const hero = document.getElementById('hero'); if(!hero) return;
  try{
    const r = await fetch('/health'); const data = await r.json();
    const online = data.status === 'connected';
    hero.className = 'hero rise d2 ' + (online ? 'online' : 'offline');
    document.getElementById('status-orb').className = 'status-orb ' + (online ? 'online' : 'offline');
    document.getElementById('status-orb').textContent = online ? '\u2713' : '\u2717';
    document.getElementById('status-title').className = 'status-title ' + (online ? 'online' : 'offline');
    document.getElementById('status-title').textContent = online ? 'Connected' : 'Disconnected';
    document.getElementById('status-sub').textContent = online ? 'Bot is active on the server' : 'Attempting to reconnect';
    document.getElementById('topbar-dot').className = 'live-dot ' + (online ? 'online' : '');
    if(wasOnline !== null && wasOnline !== online){ online ? soundOnline() : soundOffline(); }
    wasOnline = online;
    document.getElementById('uptime-text').textContent = formatUptime(data.uptime);
    document.getElementById('coords-text').textContent = data.coords
      ? 'X ' + Math.floor(data.coords.x) + ', Y ' + Math.floor(data.coords.y) + ', Z ' + Math.floor(data.coords.z)
      : 'Searching\u2026';
    document.getElementById('attempts-text').textContent = data.reconnectAttempts;
  }catch(e){
    document.getElementById('status-title').className = 'status-title offline';
    document.getElementById('status-title').textContent = 'Unreachable';
  }
}
async function startBot(){
  soundStart();
  try{ const r = await fetch('/start',{method:'POST'}); const d = await r.json(); toast(d.success ? 'Bot started' : (d.msg||'Could not start')); }
  catch(e){ toast('Request failed'); }
  update();
}
async function stopBot(){
  soundStop();
  try{ const r = await fetch('/stop',{method:'POST'}); const d = await r.json(); toast(d.success ? 'Bot stopped' : (d.msg||'Could not stop')); }
  catch(e){ toast('Request failed'); }
  update();
}
if(document.getElementById('hero')){ restartTimer(); update(); }
`;

// ============================================================
// ROUTES
// ============================================================
app.get("/", (req, res) => {
  const body = `
    <section class="hero rise d2 offline" id="hero">
      <div class="hero-left">
        <div class="status-orb offline" id="status-orb" aria-hidden="true">&#x2717;</div>
        <div>
          <div class="status-title offline" id="status-title">Connecting&hellip;</div>
          <div class="status-sub" id="status-sub">Establishing connection</div>
        </div>
      </div>
      <span class="badge">${SERVER_HOST}</span>
      <div class="hero-scan" style="position:absolute; left:26px; right:26px; bottom:14px;"><div class="bar"></div></div>
    </section>

    <section class="stat-grid rise d3">
      <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" id="uptime-text">&mdash;</div></div>
      <div class="stat-card"><div class="stat-label">Reconnect attempts</div><div class="stat-value" id="attempts-text">0</div></div>
      <div class="stat-card wide"><div class="stat-label">Coordinates</div><div class="stat-value" id="coords-text">Searching&hellip;</div></div>
    </section>

    <section class="rise d4">
      <div class="btn-row">
        <button class="btn btn-start" onclick="startBot()" aria-label="Start bot">Start bot</button>
        <button class="btn btn-stop" onclick="stopBot()" aria-label="Stop bot">Stop bot</button>
      </div>
      <div class="link-row">
        <a href="/tutorial" class="link-btn">Setup guide</a>
        <a href="/logs" class="link-btn">View logs</a>
      </div>
    </section>
  `;
  res.send(renderPage(`${config.name || "AFK Bot"} Dashboard`, "home", body));
});

app.get("/tutorial", (req, res) => {
  const body = `
    <div class="step-card rise d1">
      <div class="step-header"><div class="step-number">1</div><h2 class="step-title">Configure Aternos</h2></div>
      <ol>
        <li>Go to <strong>Aternos</strong> and open your server.</li>
        <li>Install <strong>Paper/Bukkit</strong> as your server software.</li>
        <li>Enable <strong>Cracked</strong> mode using the green switch.</li>
        <li>Install these plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code></li>
      </ol>
    </div>
    <div class="step-card rise d2">
      <div class="step-header"><div class="step-number">2</div><h2 class="step-title">GitHub setup</h2></div>
      <ol>
        <li>Download this project as a ZIP and extract it.</li>
        <li>Edit <code>settings.json</code> with your server IP and port.</li>
        <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
      </ol>
    </div>
    <div class="step-card rise d3">
      <div class="step-header"><div class="step-number">3</div><h2 class="step-title">Deploy (free 24/7)</h2></div>
      <ol>
        <li>Import your GitHub repo into your host of choice.</li>
        <li>Set the run command to <code>npm start</code>.</li>
        <li>Hit <strong>Run</strong> &mdash; the bot connects automatically.</li>
        <li>The bot pings itself periodically to stay alive.</li>
      </ol>
    </div>
  `;
  res.send(renderPage(`${config.name || "AFK Bot"} - Setup Guide`, "guide", body));
});

app.get("/logs", (req, res) => {
  const logs = getLogs();
  const escapeHTML = (str) =>
    String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const rows = logs.length
    ? logs
        .map((l) => {
          const level = (l.level || "info").toLowerCase();
          const time = l.time ? new Date(l.time).toLocaleTimeString() : "";
          const msg = escapeHTML(l.message || l);
          return `<span class="log-entry ${level}">[${time}] ${msg}</span>`;
        })
        .join("\n")
    : `<span class="log-entry info">No logs yet.</span>`;

  const body = `
    <div class="log-terminal rise d1">
      <div class="log-terminal-head">
        <div class="dot dot-r"></div><div class="dot dot-y"></div><div class="dot dot-g"></div>
        <span>bot.log &middot; ${logs.length} entries</span>
      </div>
      <div class="log-body">${rows}</div>
    </div>
  `;
  res.send(renderPage(`${config.name || "AFK Bot"} - Logs`, "logs", body));
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
  });
});

app.get("/ping", (req, res) => res.send("pong"));

app.post("/start", (req, res) => res.json(startBotProcess()));
app.post("/stop", (req, res) => res.json(stopBotProcess()));

app.get("/api/settings", (req, res) => res.json(runtimeSettings));

app.post("/api/settings", (req, res) => {
  const { autoReconnect, afkMovement, moveIntervalMs } = req.body || {};

  if (typeof autoReconnect === "boolean") runtimeSettings.autoReconnect = autoReconnect;

  if (typeof afkMovement === "boolean") {
    runtimeSettings.afkMovement = afkMovement;
    if (bot && botState.connected) {
      afkMovement ? startAfkLoop() : stopAfkLoop();
    }
  }

  if (typeof moveIntervalMs === "number" && moveIntervalMs >= 2000) {
    runtimeSettings.moveIntervalMs = moveIntervalMs;
    if (bot && botState.connected && runtimeSettings.afkMovement) startAfkLoop();
  }

  addLog("info", `Settings updated: ${JSON.stringify(runtimeSettings)}`);
  res.json(runtimeSettings);
});

// ============================================================
// SELF-PING KEEPALIVE (optional, uses http/https as available)
// ============================================================
setInterval(() => {
  const url = `http://localhost:${PORT}/ping`;
  http.get(url, () => {}).on("error", () => {});
}, 10 * 60 * 1000);

// ============================================================
// BOOT
// ============================================================
app.listen(PORT, () => {
  addLog("info", `Dashboard listening on port ${PORT}`);
  startBotProcess();
});
