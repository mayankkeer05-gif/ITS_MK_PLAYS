"use strict";

// ============================================================
// MK PANEL • MINECRAFT BOT CONTROL
// MADE BY MAYANK_KEER
// MADE BY ITS_MK_PLAYS
// ============================================================

const express = require("express");
const http = require("http");
const mineflayer = require("mineflayer");

let pathfinder;
let Movements;

try {
  const pf = require("mineflayer-pathfinder");
  pathfinder = pf.pathfinder;
  Movements = pf.Movements;
} catch (e) {
  console.log("mineflayer-pathfinder not installed");
}

const { addLog, getLogs } = require("./logger");
const config = require("./settings.json");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || config.port || 3000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// STATE
// ============================================================

let bot = null;
let botStarting = false;
let manuallyStopped = false;
let reconnectTimer = null;

let connectedAt = 0;
let lastError = "";
let lastEvent = "Panel started";

let panelSettings = {
  autoReconnect: true,
  autoStart: false,
  showCoordinates: true,
  sounds: true,
  refreshRate: 5000
};

// ============================================================
// SAFE LOGGER
// ============================================================

function log(message) {
  const text = `[MK PANEL] ${message}`;

  console.log(text);

  try {
    if (typeof addLog === "function") {
      addLog(text);
    }
  } catch {}
}

function getBotUsername() {
  return (
    config.username ||
    config.botUsername ||
    config.bot?.username ||
    config.name ||
    "MK_BOT"
  );
}

function getServerHost() {
  return (
    config.server?.ip ||
    config.server?.host ||
    config.host ||
    config.ip ||
    "localhost"
  );
}

function getServerPort() {
  return Number(
    config.server?.port ||
    config.port ||
    25565
  );
}

function getServerVersion() {
  return (
    config.server?.version ||
    config.version ||
    false
  );
}

// ============================================================
// BOT
// ============================================================

async function startBot() {
  if (botStarting) {
    return;
  }

  if (bot && bot.player) {
    log("Bot is already connected.");
    return;
  }

  botStarting = true;
  manuallyStopped = false;
  lastError = "";
  lastEvent = "Connecting";

  clearTimeout(reconnectTimer);

  const host = getServerHost();
  const port = getServerPort();
  const username = getBotUsername();
  const version = getServerVersion();

  log(`Connecting to ${host}:${port} as ${username}`);

  try {
    const options = {
      host,
      port,
      username,
      auth: config.auth || config.bot?.auth || "offline"
    };

    if (version) {
      options.version = version;
    }

    bot = mineflayer.createBot(options);

    if (pathfinder) {
      bot.loadPlugin(pathfinder);
    }

    bot.on("login", () => {
      lastEvent = "Logged in";
      log("Bot logged into Minecraft.");
    });

    bot.on("spawn", () => {
      botStarting = false;
      connectedAt = Date.now();
      lastEvent = "Connected";
      lastError = "";

      log("Bot connected successfully.");

      try {
        if (pathfinder && Movements) {
          const mcData = require("minecraft-data")(bot.version);
          const movements = new Movements(bot, mcData);

          bot.pathfinder.setMovements(movements);
        }
      } catch (e) {
        log("Pathfinder setup skipped.");
      }
    });

    bot.on("end", () => {
      botStarting = false;

      const wasManual = manuallyStopped;

      bot = null;
      connectedAt = 0;

      lastEvent = "Disconnected";

      log(
        wasManual
          ? "Bot stopped."
          : "Bot disconnected."
      );

      if (
        !wasManual &&
        panelSettings.autoReconnect
      ) {
        scheduleReconnect();
      }
    });

    bot.on("error", (err) => {
      botStarting = false;

      lastError = String(
        err?.message || err
      );

      lastEvent = "Error";

      log(`Bot error: ${lastError}`);
    });

    bot.on("kicked", (reason) => {
      const text =
        typeof reason === "string"
          ? reason
          : JSON.stringify(reason);

      lastError = text;
      lastEvent = "Kicked";

      log(`Bot kicked: ${text}`);
    });

    bot.on("chat", (username, message) => {
      log(`<${username}> ${message}`);
    });

    bot.on("death", () => {
      lastEvent = "Bot died";
      log("Bot died.");
    });

    bot.on("health", () => {
      // Keep event available without spamming logs.
    });

  } catch (err) {
    botStarting = false;
    bot = null;

    lastError = String(
      err?.message || err
    );

    lastEvent = "Start failed";

    log(`Start failed: ${lastError}`);
  }
}

async function stopBot() {
  manuallyStopped = true;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (!bot) {
    botStarting = false;
    connectedAt = 0;
    lastEvent = "Stopped";
    log("Bot is already stopped.");
    return;
  }

  const currentBot = bot;

  bot = null;
  botStarting = false;
  connectedAt = 0;
  lastEvent = "Stopped";

  try {
    currentBot.quit("MK Panel stopped");
  } catch {
    try {
      currentBot.end();
    } catch {}
  }

  log("Bot stopped from panel.");
}

async function restartBot() {
  log("Restarting bot...");

  manuallyStopped = true;

  await stopBot();

  await new Promise(resolve =>
    setTimeout(resolve, 1200)
  );

  await startBot();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  log("Auto reconnect scheduled in 10 seconds.");

  reconnectTimer = setTimeout(() => {
    if (
      !manuallyStopped &&
      panelSettings.autoReconnect
    ) {
      startBot();
    }
  }, 10000);
}

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
  const online =
    !!bot &&
    !!bot.player;

  let coords = null;

  if (
    online &&
    panelSettings.showCoordinates &&
    bot.entity?.position
  ) {
    coords = {
      x: Number(bot.entity.position.x),
      y: Number(bot.entity.position.y),
      z: Number(bot.entity.position.z)
    };
  }

  const memory =
    process.memoryUsage().heapUsed /
    1024 /
    1024;

  const uptime =
    connectedAt
      ? Math.floor(
          (Date.now() - connectedAt) / 1000
        )
      : 0;

  res.json({
    status: online
      ? "connected"
      : "disconnected",

    uptime,

    memoryUsage:
      Number(memory.toFixed(2)),

    coords,

    username: getBotUsername(),

    server: {
      host: getServerHost(),
      port: getServerPort()
    },

    event: lastEvent,

    error: lastError
  });
});

// ============================================================
// PING
// ============================================================

app.get("/ping", (req, res) => {
  res.json({
    success: true,
    message: "MK Panel is online",
    time: new Date().toISOString()
  });
});

// ============================================================
// LOG API
// ============================================================

app.get("/api/logs", (req, res) => {
  try {
    const logs =
      typeof getLogs === "function"
        ? getLogs()
        : [];

    res.json({
      logs: Array.isArray(logs)
        ? logs
        : []
    });

  } catch (err) {
    res.json({
      logs: []
    });
  }
});

// ============================================================
// SETTINGS API
// NOTE: settings.json is NEVER modified
// ============================================================

app.get("/api/settings", (req, res) => {
  res.json(panelSettings);
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};

  if (
    typeof body.autoReconnect === "boolean"
  ) {
    panelSettings.autoReconnect =
      body.autoReconnect;
  }

  if (
    typeof body.autoStart === "boolean"
  ) {
    panelSettings.autoStart =
      body.autoStart;
  }

  if (
    typeof body.showCoordinates === "boolean"
  ) {
    panelSettings.showCoordinates =
      body.showCoordinates;
  }

  if (
    typeof body.sounds === "boolean"
  ) {
    panelSettings.sounds =
      body.sounds;
  }

  if (
    Number.isFinite(
      Number(body.refreshRate)
    )
  ) {
    panelSettings.refreshRate =
      Math.max(
        1000,
        Math.min(
          30000,
          Number(body.refreshRate)
        )
      );
  }

  res.json({
    success: true,
    msg: "Settings saved"
  });
});

// ============================================================
// BOT CONTROLS
// ============================================================

app.post("/start", async (req, res) => {
  try {
    await startBot();

    res.json({
      success: true,
      msg: "Bot start requested"
    });

  } catch (err) {
    res.json({
      success: false,
      msg: err.message
    });
  }
});

app.post("/stop", async (req, res) => {
  try {
    await stopBot();

    res.json({
      success: true,
      msg: "Bot stopped"
    });

  } catch (err) {
    res.json({
      success: false,
      msg: err.message
    });
  }
});

app.post("/restart", async (req, res) => {
  try {
    await restartBot();

    res.json({
      success: true,
      msg: "Bot restarted"
    });

  } catch (err) {
    res.json({
      success: false,
      msg: err.message
    });
  }
});

// ============================================================
// TUTORIAL
// ============================================================

app.get("/tutorial", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport"
 content="width=device-width,initial-scale=1">
<title>MK Panel Tutorial</title>

<style>
body{
 margin:0;
 min-height:100vh;
 display:flex;
 align-items:center;
 justify-content:center;
 background:#05070b;
 color:#fff;
 font-family:Arial,sans-serif;
}
.box{
 width:min(600px,90%);
 padding:30px;
 border:1px solid #202a36;
 border-radius:20px;
 background:#0b1017;
 box-shadow:0 30px 80px #000;
}
h1{
 margin-top:0;
}
p{
 color:#8995a5;
 line-height:1.7;
}
a{
 color:#45df8b;
}
</style>
</head>

<body>
<div class="box">
<h1>MK PANEL</h1>

<p>
Use the dashboard to start, stop and restart
your Minecraft bot.
</p>

<p>
Live Logs shows the latest bot activity.
</p>

<p>
Settings controls panel options without changing
your Minecraft settings.json.
</p>

<a href="/">← Back to Panel</a>

</div>
</body>
</html>
`);
});

// ============================================================
// PROFESSIONAL PANEL
// ============================================================

app.get("/", (req, res) => {

  const title =
    String(
      config.name ||
      "Minecraft Bot"
    )
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const serverName =
    `${getServerHost()}:${getServerPort()}`
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  res.send(`
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
 name="viewport"
 content="width=device-width,initial-scale=1"
>

<title>${title} • MK Panel</title>

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
 radial-gradient(
  circle at 10% 10%,
  rgba(88,110,255,.14),
  transparent 28%
 ),
 radial-gradient(
  circle at 90% 90%,
  rgba(35,230,135,.08),
  transparent 30%
 ),
 var(--bg);
 color:var(--text);
 font-family:
 Inter,
 Arial,
 sans-serif;
}

/* animated background */

body::before,
body::after{
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

body::before{
 background:#5c78ff;
 top:-120px;
 left:-100px;
 animation:float1 9s ease-in-out infinite;
}

body::after{
 background:#24df83;
 right:-100px;
 bottom:-130px;
 animation:float2 11s ease-in-out infinite;
}

@keyframes float1{
 50%{
  transform:
   translate(80px,70px);
 }
}

@keyframes float2{
 50%{
  transform:
   translate(-70px,-60px);
 }
}

/* SIDEBAR */

.sidebar{
 position:fixed;
 top:0;
 bottom:0;
 left:0;
 width:245px;
 padding:25px 15px;
 background:
 rgba(7,11,17,.88);
 border-right:
 1px solid var(--border);
 backdrop-filter:blur(20px);
 z-index:50;
}

.logo{
 padding:
 5px 12px 30px;
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
 font-size:18px;
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
 linear-gradient(
  120deg,
  rgba(55,229,138,.08),
  transparent 60%
 ),
 var(--panel);
 animation:appear .5s ease;
}

.status::after{
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
 to{
  transform:rotate(360deg);
 }
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
 transition:.3s;
}

.status-icon.online{
 background:#0b291b;
 color:var(--green);
 animation:pulse 2s infinite;
}

@keyframes pulse{
 0%,100%{
  box-shadow:
   0 0 0 0 transparent;
 }
 50%{
  box-shadow:
   0 0 0 9px
   rgba(56,229,138,.07);
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
 grid-template-columns:
 repeat(4,1fr);
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

.card:nth-child(2){
 animation-delay:.05s;
}

.card:nth-child(3){
 animation-delay:.1s;
}

.card:nth-child(4){
 animation-delay:.15s;
}

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
 box-shadow:
  0 15px 40px rgba(0,0,0,.25);
}

.card::before{
 content:"";
 position:absolute;
 top:0;
 left:-100%;
 width:60%;
 height:1px;
 background:
 linear-gradient(
  90deg,
  transparent,
  #6f91ff,
  transparent
 );
 animation:scan 4s linear infinite;
}

@keyframes scan{
 to{
  left:150%;
 }
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
 white-space:nowrap;
 overflow:hidden;
 text-overflow:ellipsis;
}

.sub{
 margin-top:5px;
 color:#4d5968;
 font-size:9px;
}

/* CONTROLS */

.controls{
 display:grid;
 grid-template-columns:
 repeat(3,1fr);
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

.control::after{
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

.control:hover::after{
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
 to{
  transform:rotate(360deg);
 }
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
 height:330px;
 overflow:auto;
 padding:15px;
 border:1px solid var(--border);
 border-radius:14px;
 background:#06090e;
 color:#8995a5;
 font-family:
 Consolas,
 monospace;
 font-size:11px;
 line-height:1.75;
}

.logs::-webkit-scrollbar{
 width:7px;
}

.logs::-webkit-scrollbar-thumb{
 background:#263241;
 border-radius:20px;
}

.log{
 padding:2px 0;
 border-bottom:
 1px solid
 rgba(255,255,255,.025);
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
 width:min(
  490px,
  calc(100% - 28px)
 );
 border:1px solid #293544;
 border-radius:18px;
 background:#0c121a;
 box-shadow:
  0 30px 100px
  rgba(0,0,0,.65);
 animation:modalIn .22s ease;
 overflow:hidden;
}

@keyframes modalIn{
 from{
  opacity:0;
  transform:
   translateY(20px)
   scale(.96);
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
 border-bottom:
 1px solid var(--border);
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
 border-bottom:
 1px solid #19222d;
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
 inset:0
