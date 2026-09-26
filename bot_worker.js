"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const config = require(process.env.SETTINGS_FILE || "./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
// ============================================================
// SETTINGS PANEL - read/write settings.json safely
// FIX: mutate the shared `config` object in place (never reassign it)
// so every part of the bot that already reads `config.xxx` sees
// updated values immediately, without needing a process restart.
// ============================================================
const SETTINGS_PATH = path.resolve(process.env.SETTINGS_FILE || path.join(__dirname, "settings.json"));

function isPlainObject(val) {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

// Deep-merges `updates` into `target` in place. Existing keys not present
// in `updates` are left untouched, so a partial payload never wipes out
// the rest of the settings file.
function deepMergeInto(target, updates) {
  for (const key of Object.keys(updates)) {
    const updateVal = updates[key];
    if (isPlainObject(updateVal) && isPlainObject(target[key])) {
      deepMergeInto(target[key], updateVal);
    } else {
      target[key] = updateVal;
    }
  }
  return target;
}

function saveSettingsToDisk() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (e) {
    addLog(`[Settings] Failed to write settings.json: ${e.message}`);
    return false;
  }
}

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
};

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(14px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulseRing {
            0%   { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.45); }
            70%  { box-shadow: 0 0 0 10px rgba(63, 185, 80, 0); }
            100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
          }
          @keyframes pulseRingOffline {
            0%   { box-shadow: 0 0 0 0 rgba(248, 81, 73, 0.4); }
            70%  { box-shadow: 0 0 0 10px rgba(248, 81, 73, 0); }
            100% { box-shadow: 0 0 0 0 rgba(248, 81, 73, 0); }
          }
          @keyframes popIn {
            0%   { transform: scale(0.8); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background:
              radial-gradient(circle at 15% 0%, rgba(35, 134, 54, 0.12), transparent 45%),
              radial-gradient(circle at 85% 100%, rgba(88, 166, 255, 0.10), transparent 45%),
              #0d1117;
            color: #e6edf3;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
          }

          main {
            width: 100%;
            max-width: 400px;
            animation: fadeSlideUp 0.5s ease both;
          }

          header { margin-bottom: 28px; animation: fadeSlideUp 0.5s ease both; }
          header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
            background: linear-gradient(90deg, #f0f6fc, #58a6ff 70%);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          header p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
            line-height: 1.5;
          }

          .status-section {
            border-radius: 14px;
            padding: 20px 24px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 16px;
            transition: background 0.35s ease, border-color 0.35s ease, transform 0.2s ease;
            animation: fadeSlideUp 0.5s ease 0.05s both;
          }
          .status-section:hover { transform: translateY(-2px); }
          .status-section.online  { background: #0d2218; border: 2px solid #238636; }
          .status-section.offline { background: #200d0d; border: 2px solid #da3633; }

          .status-icon {
            width: 44px; height: 44px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; flex-shrink: 0;
            transition: background 0.35s ease, transform 0.3s ease;
            animation: popIn 0.35s ease both;
          }
          .status-icon.online  { background: #238636; animation: popIn 0.35s ease both, pulseRing 2s infinite; }
          .status-icon.offline { background: #da3633; animation: popIn 0.35s ease both, pulseRingOffline 2s infinite; }

          .status-label { font-size: 18px; font-weight: 700; line-height: 1.2; transition: color 0.3s; }
          .status-label.online  { color: #3fb950; }
          .status-label.offline { color: #f85149; }
          .status-detail { font-size: 13px; color: #8b949e; margin-top: 3px; }

          dl { margin: 0; }
          .stat-card {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 10px;
            padding: 16px 20px;
            margin-bottom: 10px;
            transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
            animation: fadeSlideUp 0.5s ease both;
          }
          .stat-card:nth-of-type(1) { animation-delay: 0.1s; }
          .stat-card:nth-of-type(2) { animation-delay: 0.16s; }
          .stat-card:nth-of-type(3) { animation-delay: 0.22s; }
          .stat-card:hover {
            transform: translateY(-2px);
            border-color: #30363d;
            background: #1c2129;
          }
          dt { font-size: 12px; color: #8b949e; font-weight: 600; margin-bottom: 4px; }
          dd { margin: 0; font-size: 17px; font-weight: 600; color: #e6edf3; line-height: 1.3; transition: color 0.2s ease; }
          .stat-detail { margin: 4px 0 0; font-size: 11px; color: #6e7681; }

          .controls { margin-top: 8px; animation: fadeSlideUp 0.5s ease 0.28s both; }
          .btn-grid { display: grid; gap: 10px; margin-bottom: 10px; }
          .btn-grid-2 { grid-template-columns: 1fr 1fr; }

          .btn-primary {
            position: relative;
            overflow: hidden;
            min-height: 52px; border-radius: 10px;
            font-size: 15px; font-weight: 700;
            cursor: pointer; letter-spacing: 0.3px;
            transition: opacity 0.15s ease, filter 0.2s ease, transform 0.12s ease, box-shadow 0.2s ease;
            font-family: inherit;
          }
          .btn-primary:hover  { filter: brightness(1.15); transform: translateY(-1px); }
          .btn-primary:active { opacity: 0.85; transform: scale(0.96); }
          .btn-start { border: 2px solid #238636; background: #0d2218; color: #3fb950; }
          .btn-start:hover { box-shadow: 0 0 14px rgba(35, 134, 54, 0.35); }
          .btn-stop  { border: 2px solid #da3633; background: #200d0d; color: #f85149; }
          .btn-stop:hover { box-shadow: 0 0 14px rgba(218, 54, 51, 0.35); }

          .btn-secondary {
            min-height: 44px; border-radius: 10px;
            border: 1px solid #21262d; background: #161b22; color: #8b949e;
            font-size: 13px; font-weight: 500;
            text-decoration: none;
            display: flex; align-items: center; justify-content: center;
            font-family: inherit; cursor: pointer;
            transition: background 0.2s ease, color 0.2s ease, transform 0.12s ease;
          }
          .btn-secondary:hover  { background: #21262d; color: #c9d1d9; transform: translateY(-1px); }
          .btn-secondary:active { transform: scale(0.96); }

          /* Ripple effect for click feedback */
          .ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.35);
            transform: scale(0);
            animation: rippleAnim 0.5s ease-out;
            pointer-events: none;
          }
          @keyframes rippleAnim {
            to { transform: scale(3); opacity: 0; }
          }

          footer { margin-top: 20px; text-align: center; animation: fadeSlideUp 0.5s ease 0.32s both; }
          footer p { font-size: 12px; color: #484f58; margin: 0; }

          .credit-cycle {
            position: relative;
            height: 18px;
            margin-top: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .credit-text {
            position: absolute;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            white-space: nowrap;
            opacity: 0;
            background: linear-gradient(90deg, #58a6ff, #3fb950);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: creditCycle 6s ease-in-out infinite;
          }
          .credit-text.credit-1 { animation-delay: 0s; }
          .credit-text.credit-2 { animation-delay: 3s; }
          @keyframes creditCycle {
            0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
            8%   { opacity: 1; transform: translateY(0) scale(1); }
            42%  { opacity: 1; transform: translateY(0) scale(1); }
            50%  { opacity: 0; transform: translateY(-8px) scale(0.92); }
            100% { opacity: 0; transform: translateY(8px) scale(0.92); }
          }
        </style>
      </head>
      <body>
        <main role="main" aria-label="AFK Bot Dashboard">

          <header>
            <h1>AFK Bot Dashboard</h1>
            <p>Minecraft server bot &middot; Live status</p>
          </header>

          <section
            id="status-section"
            role="status"
            aria-live="polite"
            aria-label="Bot connection status"
            class="status-section offline"
          >
            <div id="status-icon" aria-hidden="true" class="status-icon offline">&#x2717;</div>
            <div>
              <div id="status-label" class="status-label offline">Connecting…</div>
              <div id="status-detail" class="status-detail">Establishing connection</div>
            </div>
          </section>

          <section aria-label="Bot statistics">
            <dl>
              <div class="stat-card">
                <dt>Uptime</dt>
                <dd id="uptime-text">—</dd>
                <p class="stat-detail">Time since last connection</p>
              </div>
              <div class="stat-card">
                <dt>Coordinates</dt>
                <dd id="coords-text">Searching…</dd>
                <p class="stat-detail">Bot's current in-game position</p>
              </div>
              <div class="stat-card">
                <dt>Server address</dt>
                <dd id="server-address-text">${config.server.ip}:${config.server.port}</dd>
                <p class="stat-detail">Minecraft server hostname &amp; port</p>
              </div>
              <div class="stat-card">
                <dt>Bot account</dt>
                <dd id="account-text">${config["bot-account"].username}</dd>
                <p class="stat-detail" id="version-detail">Minecraft version: ${config.server.version || "auto"}</p>
              </div>
              <div class="stat-card">
                <dt>Reconnect attempts</dt>
                <dd id="reconnects-text">0</dd>
                <p class="stat-detail">Since the process started</p>
              </div>
              <div class="stat-card">
                <dt>Memory usage</dt>
                <dd id="memory-text">—</dd>
                <p class="stat-detail">Node.js heap used right now</p>
              </div>
            </dl>
          </section>

          <section class="controls" aria-label="Bot controls">
            <div class="btn-grid btn-grid-2">
              <button id="start-btn" class="btn-primary btn-start" onclick="startBot(event)" aria-label="Start bot">Start bot</button>
              <button id="stop-btn" class="btn-primary btn-stop" onclick="stopBot(event)" aria-label="Stop bot">Stop bot</button>
            </div>
            <div class="btn-grid btn-grid-2">
              <button id="restart-btn" class="btn-secondary" onclick="restartBot(event)" aria-label="Restart bot">Restart bot</button>
              <button id="health-btn" class="btn-secondary" onclick="showHealth(event)" aria-label="Show bot health">Health</button>
            </div>
            <div style="margin-top:14px;padding:16px;border:1px solid #21262d;border-radius:12px;background:#161b22;">
              <h3 style="margin:0 0 10px;font-size:15px;">💬 Minecraft Chat</h3>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <input id="chat-input" type="text" placeholder="Message to Minecraft chat..." style="flex:1;min-width:200px;padding:11px 12px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;">
                <button class="btn-primary" onclick="sendChat(event)">Send</button>
              </div>
            </div>
            <div style="margin-top:12px;padding:16px;border:1px solid #21262d;border-radius:12px;background:#161b22;">
              <h3 style="margin:0 0 10px;font-size:15px;">⌨️ Minecraft Command</h3>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <input id="command-input" type="text" placeholder="e.g. /list or /tp Player 0 100 0" style="flex:1;min-width:200px;padding:11px 12px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;">
                <button class="btn-primary" onclick="sendCommand(event)">Run</button>
              </div>
            </div>
            <div id="control-output" style="margin-top:12px;padding:12px;border-radius:8px;background:#0d1117;border:1px solid #21262d;display:none;white-space:pre-wrap;font-size:13px;"></div>
            <div class="btn-grid btn-grid-2" style="margin-top:14px;">
              <a href="/tutorial" class="btn-secondary" onclick="playClickSound()" aria-label="View setup guide">Setup guide</a>
              <a href="/logs" class="btn-secondary" onclick="playClickSound()" aria-label="View bot logs">View logs</a>
            </div>
            <div class="btn-grid">
              <a href="/settings" class="btn-secondary" onclick="playClickSound()" aria-label="Open bot settings panel">&#9881;&#65039; Bot Settings</a>
            </div>
          </section>

          <footer>
            <p>Status updates every 5 seconds</p>
            <div class="credit-cycle">
              <span class="credit-text credit-1">MADE BY MAYANK_KEER.</span>
              <span class="credit-text credit-2">MADE BY ITS_MK_PLAYS.</span>
            </div>
          </footer>

        </main>

        <script>
          function formatUptime(s) {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
            if (m > 0) return m + 'm ' + sec + 's';
            return sec + ' seconds';
          }

          async function update() {
            try {
              const r = await fetch('/health');
              const data = await r.json();
              const online = data.status === 'connected';

              const section = document.getElementById('status-section');
              const icon    = document.getElementById('status-icon');
              const label   = document.getElementById('status-label');
              const detail  = document.getElementById('status-detail');

              section.className = 'status-section ' + (online ? 'online' : 'offline');
              icon.className    = 'status-icon '    + (online ? 'online' : 'offline');
              icon.textContent  = online ? '✓' : '✗';
              label.className   = 'status-label '   + (online ? 'online' : 'offline');
              label.textContent = online ? 'Connected' : 'Disconnected';
              detail.textContent = online ? 'Bot is active on the server' : 'Attempting to reconnect';

              document.getElementById('uptime-text').textContent = formatUptime(data.uptime);

              if (data.coords) {
                const x = Math.floor(data.coords.x);
                const y = Math.floor(data.coords.y);
                const z = Math.floor(data.coords.z);
                document.getElementById('coords-text').textContent = 'X ' + x + ', Y ' + y + ', Z ' + z;
              } else {
                document.getElementById('coords-text').textContent = 'Searching…';
              }

              // FIX: fill the extra stat cards from the extended /health payload
              if (data.serverIp) {
                document.getElementById('server-address-text').textContent = data.serverIp + ':' + data.serverPort;
              }
              if (data.botUsername) {
                document.getElementById('account-text').textContent = data.botUsername;
              }
              const versionDetail = document.getElementById('version-detail');
              if (versionDetail) {
                versionDetail.textContent = 'Minecraft version: ' + (data.mcVersion || data.serverVersion || 'auto');
              }
              document.getElementById('reconnects-text').textContent = data.reconnectAttempts;
              if (typeof data.memoryUsage === 'number') {
                document.getElementById('memory-text').textContent = data.memoryUsage.toFixed(1) + ' MB';
              }
            } catch (e) {
              const label = document.getElementById('status-label');
              label.className = 'status-label offline';
              label.textContent = 'Unreachable';
            }
          }

          // ---- Click sound (generated in-browser, no audio file needed) ----
          let audioCtx = null;
          function playClickSound() {
            try {
              audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(660, audioCtx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 0.09);
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.12);
            } catch (e) { /* audio not supported - fail silently */ }
          }

          // ---- Ripple animation on button click ----
          function spawnRipple(evt) {
            const btn = evt.currentTarget;
            const rect = btn.getBoundingClientRect();
            const ripple = document.createElement('span');
            const size = Math.max(rect.width, rect.height);
            ripple.className = 'ripple';
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (evt.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (evt.clientY - rect.top - size / 2) + 'px';
            btn.appendChild(ripple);
            setTimeout(() => ripple.remove(), 500);
          }

          async function startBot(evt) {
            if (evt) { spawnRipple(evt); }
            playClickSound();
            const r = await fetch('/start', { method: 'POST' });
            const data = await r.json();
            alert(data.success ? 'Bot started!' : data.msg);
            update();
          }

          async function stopBot(evt) {
            if (evt) { spawnRipple(evt); }
            playClickSound();
            const r = await fetch('/stop', { method: 'POST' });
            const data = await r.json();
            alert(data.success ? 'Bot stopped!' : data.msg);
            update();
          }

          async function restartBot(evt) {
            if (evt) { spawnRipple(evt); }
            playClickSound();
            const r = await fetch('/api/restart', { method: 'POST' });
            const data = await r.json();
            showControlOutput(data.msg || (data.success ? 'Restarted.' : 'Restart failed.'), data.success);
            setTimeout(update, 1000);
          }

          async function showHealth(evt) {
            if (evt) { spawnRipple(evt); }
            playClickSound();
            try {
              const r = await fetch('/health');
              const data = await r.json();
              showControlOutput(
                'Status: ' + data.status + '\n' +
                'Uptime: ' + formatUptime(data.uptime || 0) + '\n' +
                'Position: ' + (data.coords ? JSON.stringify(data.coords) : 'Unavailable') + '\n' +
                'Reconnects: ' + (data.reconnectAttempts ?? 0) + '\n' +
                'Memory: ' + (typeof data.memoryUsage === 'number' ? data.memoryUsage.toFixed(1) + ' MB' : '—'),
                data.status === 'connected'
              );
            } catch (e) {
              showControlOutput('Health check failed: ' + e.message, false);
            }
          }

          function showControlOutput(msg, ok) {
            const el = document.getElementById('control-output');
            el.style.display = 'block';
            el.style.color = ok ? '#3fb950' : '#f85149';
            el.textContent = msg;
          }

          async function sendChat(evt) {
            if (evt) { spawnRipple(evt); }
            playClickSound();
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (!message) return;
            try {
              const r = await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: message })
              });
              const data = await r.json();
              showControlOutput(data.msg || (data.success ? 'Message sent.' : 'Failed.'), !!data.success);
              if (data.success) input.value = '';
            } catch (e) { showControlOutput('Network error: ' + e.message, false); }
          }

          async function sendCommand(evt) {
            if (evt) { spawnRipple(evt); }
            playClickSound();
            const input = document.getElementById('command-input');
            let command = input.value.trim();
            if (!command) return;
            if (!command.startsWith('/')) command = '/' + command;
            try {
              const r = await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command })
              });
              const data = await r.json();
              showControlOutput(data.msg || (data.success ? 'Command sent.' : 'Failed.'), !!data.success);
              if (data.success) input.value = '';
            } catch (e) { showControlOutput('Network error: ' + e.message, false); }
          }

          document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(e); });
          document.getElementById('command-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendCommand(e); });

          setInterval(update, 5000);
          update();
        </script>
      </body>
    </html>
  `);
});
app.get("/tutorial", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Setup Guide</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(14px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background:
              radial-gradient(circle at 15% 0%, rgba(35, 134, 54, 0.12), transparent 45%),
              radial-gradient(circle at 85% 100%, rgba(88, 166, 255, 0.10), transparent 45%),
              #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px;
          }

          main {
            width: 100%;
            max-width: 560px;
            margin: 0 auto;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            margin-bottom: 32px;
            transition: color 0.2s ease, background 0.2s ease, transform 0.12s ease;
            animation: fadeSlideUp 0.4s ease both;
          }
          .back-btn:hover  { background: #21262d; color: #c9d1d9; transform: translateX(-2px); }
          .back-btn:active { transform: scale(0.96); }

          header { margin-bottom: 32px; animation: fadeSlideUp 0.45s ease 0.05s both; }
          header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
            background: linear-gradient(90deg, #f0f6fc, #58a6ff 70%);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          header p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
            line-height: 1.5;
          }

          .step-card {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 16px;
            transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
            animation: fadeSlideUp 0.5s ease both;
          }
          .step-card:nth-of-type(1) { animation-delay: 0.1s; }
          .step-card:nth-of-type(2) { animation-delay: 0.16s; }
          .step-card:nth-of-type(3) { animation-delay: 0.22s; }
          .step-card:hover {
            transform: translateY(-2px);
            border-color: #30363d;
            background: #1c2129;
          }

          .step-header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 18px;
          }

          .step-number {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #0d2218;
            border: 2px solid #238636;
            color: #3fb950;
            font-size: 14px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .step-title {
            font-size: 16px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
          }

          ol {
            margin: 0;
            padding: 0;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          li {
            font-size: 14px;
            color: #8b949e;
            line-height: 1.6;
            padding-left: 20px;
            position: relative;
          }

          li::before {
            content: "·";
            position: absolute;
            left: 6px;
            color: #3fb950;
            font-weight: 700;
          }

          li strong { color: #e6edf3; font-weight: 600; }

          code {
            background: #21262d;
            border: 1px solid #30363d;
            padding: 2px 7px;
            border-radius: 5px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 12px;
            color: #e6edf3;
          }

          a { color: #58a6ff; text-decoration: none; }
          a:hover { text-decoration: underline; }

          footer {
            margin-top: 32px;
            text-align: center;
            animation: fadeSlideUp 0.5s ease 0.3s both;
          }
          footer p { font-size: 12px; color: #484f58; margin: 0; }

          .credit-cycle {
            position: relative;
            height: 18px;
            margin-top: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .credit-text {
            position: absolute;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            white-space: nowrap;
            opacity: 0;
            background: linear-gradient(90deg, #58a6ff, #3fb950);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: creditCycle 6s ease-in-out infinite;
          }
          .credit-text.credit-1 { animation-delay: 0s; }
          .credit-text.credit-2 { animation-delay: 3s; }
          @keyframes creditCycle {
            0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
            8%   { opacity: 1; transform: translateY(0) scale(1); }
            42%  { opacity: 1; transform: translateY(0) scale(1); }
            50%  { opacity: 0; transform: translateY(-8px) scale(0.92); }
            100% { opacity: 0; transform: translateY(8px) scale(0.92); }
          }
        </style>
      </head>
      <body>
        <main>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <a href="/" class="back-btn" onclick="playClickSound()">&#8592; Back to Dashboard</a>
            <a href="/settings" class="back-btn" onclick="playClickSound()">&#9881;&#65039; Bot Settings</a>
          </div>

          <header>
            <h1>Setup Guide</h1>
            <p>Get your AFK bot running in under 15 minutes</p>
          </header>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">1</div>
              <h2 class="step-title">Configure Aternos</h2>
            </div>
            <ol>
              <li>Go to <strong>Aternos</strong> and open your server.</li>
              <li>Install <strong>Paper/Bukkit</strong> as your server software.</li>
              <li>Enable <strong>Cracked</strong> mode using the green switch.</li>
              <li>Install these plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code></li>
            </ol>
          </div>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">2</div>
              <h2 class="step-title">GitHub Setup</h2>
            </div>
            <ol>
              <li>Download this project as a ZIP and extract it.</li>
              <li>Edit <code>settings.json</code> with your server IP and port.</li>
              <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
            </ol>
          </div>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">3</div>
              <h2 class="step-title">Deploy on Replit (Free 24/7)</h2>
            </div>
            <ol>
              <li>Import your GitHub repo into <strong>Replit</strong>.</li>
              <li>Set the run command to <code>npm start</code>.</li>
              <li>Hit <strong>Run</strong> — the bot connects automatically.</li>
              <li>The bot pings itself every 10 minutes to stay alive.</li>
            </ol>
          </div>

          <footer>
            <p>AFK Bot Dashboard &middot; ${config.name}</p>
            <div class="credit-cycle">
              <span class="credit-text credit-1">MADE BY MAYANK_KEER.</span>
              <span class="credit-text credit-2">MADE BY ITS_MK_PLAYS.</span>
            </div>
          </footer>
        </main>

        <script>
          // Click sound (generated in-browser, no audio file needed)
          let audioCtx = null;
          function playClickSound() {
            try {
              audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(660, audioCtx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 0.09);
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.12);
            } catch (e) { /* audio not supported - fail silently */ }
          }
        </script>
      </body>
    </html>
  `);
});

app.get("/settings", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Settings</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(14px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes popIn {
            0%   { transform: scale(0.8); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background:
              radial-gradient(circle at 15% 0%, rgba(35, 134, 54, 0.12), transparent 45%),
              radial-gradient(circle at 85% 100%, rgba(88, 166, 255, 0.10), transparent 45%),
              #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px 60px;
          }

          main { width: 100%; max-width: 720px; margin: 0 auto; }

          .top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 28px;
            flex-wrap: wrap;
            animation: fadeSlideUp 0.4s ease both;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            transition: color 0.2s ease, background 0.2s ease, transform 0.12s ease;
          }
          .back-btn:hover  { background: #21262d; color: #c9d1d9; transform: translateX(-2px); }
          .back-btn:active { transform: scale(0.96); }

          .top-actions { display: flex; gap: 10px; }

          header { margin-bottom: 24px; animation: fadeSlideUp 0.45s ease 0.05s both; }
          header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
            background: linear-gradient(90deg, #f0f6fc, #58a6ff 70%);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          header p { font-size: 14px; color: #8b949e; margin: 6px 0 0; line-height: 1.5; }

          .notice {
            background: #1c2129;
            border: 1px solid #30363d;
            border-left: 3px solid #58a6ff;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 12.5px;
            color: #8b949e;
            margin-bottom: 20px;
            animation: fadeSlideUp 0.45s ease 0.08s both;
          }
          .notice strong { color: #c9d1d9; }

          .settings-section {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 12px;
            padding: 20px 24px;
            margin-bottom: 16px;
            animation: fadeSlideUp 0.5s ease both;
            transition: border-color 0.2s ease;
          }
          .settings-section:hover { border-color: #30363d; }
          .settings-section h2 {
            font-size: 15px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0 0 3px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .settings-section .section-desc {
            font-size: 12px;
            color: #8b949e;
            margin: 0 0 14px;
          }

          .field-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 11px 0;
            border-bottom: 1px solid #21262d;
          }
          .field-row:last-child { border-bottom: none; }
          .field-row.column { flex-direction: column; align-items: stretch; }

          .field-label-wrap { flex: 1; min-width: 0; }
          .field-label { font-size: 13px; color: #c9d1d9; font-weight: 500; display: block; }
          .field-hint { font-size: 11px; color: #6e7681; margin-top: 2px; }

          .field-input {
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 8px 12px;
            color: #e6edf3;
            font-size: 13px;
            font-family: inherit;
            width: 190px;
            max-width: 55%;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }
          .field-input:focus { outline: none; border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
          .field-row.column .field-input { width: 100%; max-width: 100%; margin-top: 8px; }
          textarea.field-input {
            resize: vertical;
            min-height: 70px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 12px;
          }

          .field-with-btn { display: flex; gap: 8px; align-items: center; width: 190px; max-width: 55%; }
          .field-row.column .field-with-btn { width: 100%; max-width: 100%; margin-top: 8px; }
          .field-with-btn .field-input { width: 100%; max-width: 100%; }

          .mini-btn {
            flex-shrink: 0;
            font-size: 11px;
            font-weight: 600;
            color: #8b949e;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 6px;
            padding: 8px 10px;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.2s ease, color 0.2s ease;
          }
          .mini-btn:hover { background: #21262d; color: #c9d1d9; }

          /* Toggle switch */
          .toggle { position: relative; display: inline-block; width: 42px; height: 23px; flex-shrink: 0; }
          .toggle input { opacity: 0; width: 0; height: 0; }
          .toggle-slider {
            position: absolute; inset: 0; cursor: pointer;
            background: #21262d; border: 1px solid #30363d;
            border-radius: 24px;
            transition: background 0.2s ease, border-color 0.2s ease;
          }
          .toggle-slider::before {
            content: ""; position: absolute;
            height: 15px; width: 15px; left: 3px; top: 50%;
            transform: translateY(-50%);
            background: #8b949e; border-radius: 50%;
            transition: transform 0.2s ease, background 0.2s ease;
          }
          .toggle input:checked + .toggle-slider { background: #0d2218; border-color: #238636; }
          .toggle input:checked + .toggle-slider::before { transform: translate(19px, -50%); background: #3fb950; }

          .action-bar {
            position: sticky;
            bottom: 16px;
            display: flex;
            gap: 10px;
            align-items: center;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 12px;
            padding: 14px 18px;
            margin-top: 20px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.5);
            animation: fadeSlideUp 0.5s ease both;
            flex-wrap: wrap;
          }

          .btn-primary {
            position: relative;
            overflow: hidden;
            min-height: 44px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            letter-spacing: 0.3px;
            padding: 0 20px;
            transition: opacity 0.15s ease, filter 0.2s ease, transform 0.12s ease, box-shadow 0.2s ease;
            font-family: inherit;
          }
          .btn-primary:hover  { filter: brightness(1.15); transform: translateY(-1px); }
          .btn-primary:active { opacity: 0.85; transform: scale(0.96); }
          .btn-save    { border: 2px solid #238636; background: #0d2218; color: #3fb950; }
          .btn-save:hover { box-shadow: 0 0 14px rgba(35, 134, 54, 0.35); }
          .btn-restart { border: 2px solid #58a6ff; background: #0d1c2e; color: #58a6ff; }
          .btn-restart:hover { box-shadow: 0 0 14px rgba(88, 166, 255, 0.3); }

          .ripple {
            position: absolute; border-radius: 50%;
            background: rgba(255,255,255,0.35);
            transform: scale(0);
            animation: rippleAnim 0.5s ease-out;
            pointer-events: none;
          }
          @keyframes rippleAnim { to { transform: scale(3); opacity: 0; } }

          #save-status {
            font-size: 12.5px;
            font-weight: 600;
            opacity: 0;
            transition: opacity 0.3s ease;
          }
          #save-status.ok  { color: #3fb950; }
          #save-status.err { color: #f85149; }

          .credit-cycle {
            position: relative; height: 18px; margin-top: 30px;
            display: flex; align-items: center; justify-content: center;
          }
          .credit-text {
            position: absolute; font-size: 11px; font-weight: 700;
            letter-spacing: 0.5px; white-space: nowrap; opacity: 0;
            background: linear-gradient(90deg, #58a6ff, #3fb950);
            -webkit-background-clip: text; background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: creditCycle 6s ease-in-out infinite;
          }
          .credit-text.credit-1 { animation-delay: 0s; }
          .credit-text.credit-2 { animation-delay: 3s; }
          @keyframes creditCycle {
            0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
            8%   { opacity: 1; transform: translateY(0) scale(1); }
            42%  { opacity: 1; transform: translateY(0) scale(1); }
            50%  { opacity: 0; transform: translateY(-8px) scale(0.92); }
            100% { opacity: 0; transform: translateY(8px) scale(0.92); }
          }
        </style>
      </head>
      <body>
        <main>
          <div class="top-row">
            <a href="/" class="back-btn" onclick="playClickSound()">&#8592; Back to Dashboard</a>
            <div class="top-actions">
              <a href="/logs" class="back-btn" onclick="playClickSound()">View logs</a>
            </div>
          </div>

          <header>
            <h1>Bot Settings</h1>
            <p>Full control panel &middot; edit settings.json without touching code</p>
          </header>

          <div class="notice">
            <strong>Note:</strong> Server, account and version changes need a bot
            <strong>restart</strong> to take effect. Movement/module/chat changes apply
            on the next reconnect. Click <strong>Save Settings</strong> first, then
            <strong>Restart Bot</strong> if needed.
          </div>

          <div class="settings-section">
            <h2>&#9881;&#65039; General</h2>
            <p class="section-desc">Basic identity for this bot instance.</p>
            <div class="field-row">
              <div class="field-label-wrap">
                <span class="field-label">Bot name</span>
                <div class="field-hint">Shown in dashboard title &amp; Discord embeds</div>
              </div>
              <input id="f-name" class="field-input" type="text">
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128100; Account</h2>
            <p class="section-desc">Minecraft account the bot logs in with.</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Username</span></div>
              <input id="f-username" class="field-input" type="text">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Password</span></div>
              <div class="field-with-btn">
                <input id="f-password" class="field-input" type="password">
                <button type="button" class="mini-btn" onclick="togglePassword('f-password', this)">Show</button>
              </div>
            </div>
            <div class="field-row">
              <div class="field-label-wrap">
                <span class="field-label">Auth type</span>
                <div class="field-hint">offline / mojang / microsoft</div>
              </div>
              <input id="f-authtype" class="field-input" type="text">
            </div>
          </div>

          <div class="settings-section">
            <h2>&#127760; Server</h2>
            <p class="section-desc">Where the bot connects.</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Server IP / hostname</span></div>
              <input id="f-ip" class="field-input" type="text" placeholder="play.example.com">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Port</span></div>
              <input id="f-port" class="field-input" type="number" min="1" max="65535">
            </div>
            <div class="field-row">
              <div class="field-label-wrap">
                <span class="field-label">Minecraft version</span>
                <div class="field-hint">Leave blank to auto-detect</div>
              </div>
              <input id="f-version" class="field-input" type="text" placeholder="1.21.11">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Try creative mode</span></div>
              <label class="toggle"><input id="f-creative" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128205; Spawn position</h2>
            <p class="section-desc">Where the bot walks to after joining.</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Enabled</span></div>
              <label class="toggle"><input id="f-pos-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">X / Y / Z</span></div>
              <div class="field-with-btn">
                <input id="f-pos-x" class="field-input" type="number" style="width:33%">
                <input id="f-pos-y" class="field-input" type="number" style="width:33%">
                <input id="f-pos-z" class="field-input" type="number" style="width:33%">
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128274; Auto-auth</h2>
            <p class="section-desc">For cracked servers using an auth plugin (e.g. AuthMe).</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Enabled</span></div>
              <label class="toggle"><input id="f-autoauth-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Login password</span></div>
              <div class="field-with-btn">
                <input id="f-autoauth-password" class="field-input" type="password">
                <button type="button" class="mini-btn" onclick="togglePassword('f-autoauth-password', this)">Show</button>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#9200; Anti-AFK &amp; reconnect</h2>
            <p class="section-desc">Keep the bot from being kicked, and recover from drops.</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Anti-AFK enabled</span></div>
              <label class="toggle"><input id="f-antiafk-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Sneak while idle</span></div>
              <label class="toggle"><input id="f-antiafk-sneak" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Auto-reconnect</span></div>
              <label class="toggle"><input id="f-reconnect-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap">
                <span class="field-label">Reconnect delay (ms)</span>
                <div class="field-hint">Base delay before retrying</div>
              </div>
              <input id="f-reconnect-delay" class="field-input" type="number" min="0">
            </div>
            <div class="field-row">
              <div class="field-label-wrap">
                <span class="field-label">Max reconnect delay (ms)</span>
              </div>
              <input id="f-reconnect-maxdelay" class="field-input" type="number" min="0">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Log to console</span></div>
              <label class="toggle"><input id="f-chatlog" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128694; Movement</h2>
            <p class="section-desc">Circle walking, looking around and random jumps.</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Movement enabled</span></div>
              <label class="toggle"><input id="f-move-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Circle-walk enabled</span></div>
              <label class="toggle"><input id="f-circle-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Circle radius</span></div>
              <input id="f-circle-radius" class="field-input" type="number" min="1">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Circle speed (ms/step)</span></div>
              <input id="f-circle-speed" class="field-input" type="number" min="100">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Look-around enabled</span></div>
              <label class="toggle"><input id="f-look-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Look-around interval (ms)</span></div>
              <input id="f-look-interval" class="field-input" type="number" min="500">
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Random jump enabled</span></div>
              <label class="toggle"><input id="f-jump-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Random jump interval (ms)</span></div>
              <input id="f-jump-interval" class="field-input" type="number" min="1000">
            </div>
          </div>

          <div class="settings-section">
            <h2>&#129513; Modules</h2>
            <p class="section-desc">Turn bot behaviors on or off.</p>
            <div class="field-row">
              <div class="field-label-wrap">
                <span class="field-label">Avoid mobs</span>
                <div class="field-hint">Disabled automatically while Combat is on</div>
              </div>
              <label class="toggle"><input id="f-mod-avoidmobs" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Combat</span></div>
              <label class="toggle"><input id="f-mod-combat" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Beds</span></div>
              <label class="toggle"><input id="f-mod-beds" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Chat responder</span></div>
              <label class="toggle"><input id="f-mod-chat" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Console commands</span></div>
              <label class="toggle"><input id="f-mod-console" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#9876;&#65039; Combat &amp; survival</h2>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Attack hostile mobs</span></div>
              <label class="toggle"><input id="f-combat-attack" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Auto-eat when hungry</span></div>
              <label class="toggle"><input id="f-combat-autoeat" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128719; Beds</h2>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Pick up bed at day</span></div>
              <label class="toggle"><input id="f-beds-pickup" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Place bed &amp; sleep at night</span></div>
              <label class="toggle"><input id="f-beds-place" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128172; Chat</h2>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Respond to greetings / !tp</span></div>
              <label class="toggle"><input id="f-chat-respond" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Auto chat messages</span></div>
              <label class="toggle"><input id="f-chatmsg-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Repeat messages</span></div>
              <label class="toggle"><input id="f-chatmsg-repeat" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Repeat delay (ms)</span></div>
              <input id="f-chatmsg-delay" class="field-input" type="number" min="1000">
            </div>
            <div class="field-row column">
              <div class="field-label-wrap">
                <span class="field-label">Messages</span>
                <div class="field-hint">One message per line</div>
              </div>
              <textarea id="f-chatmsg-messages" class="field-input"></textarea>
            </div>
          </div>

          <div class="settings-section">
            <h2>&#128225; Discord webhook</h2>
            <p class="section-desc">Send bot events to a Discord channel.</p>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Enabled</span></div>
              <label class="toggle"><input id="f-discord-enabled" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row column">
              <div class="field-label-wrap"><span class="field-label">Webhook URL</span></div>
              <div class="field-with-btn">
                <input id="f-discord-webhook" class="field-input" type="password" placeholder="https://discord.com/api/webhooks/...">
                <button type="button" class="mini-btn" onclick="togglePassword('f-discord-webhook', this)">Show</button>
              </div>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Notify on connect</span></div>
              <label class="toggle"><input id="f-discord-connect" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Notify on disconnect</span></div>
              <label class="toggle"><input id="f-discord-disconnect" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
            <div class="field-row">
              <div class="field-label-wrap"><span class="field-label">Notify on chat messages</span></div>
              <label class="toggle"><input id="f-discord-chat" type="checkbox"><span class="toggle-slider"></span></label>
            </div>
          </div>

          <div class="action-bar">
            <button id="btn-save" class="btn-primary btn-save" onclick="saveSettings(event)">&#128190; Save Settings</button>
            <button id="btn-restart" class="btn-primary btn-restart" onclick="restartBot(event)">&#128260; Restart Bot</button>
            <span id="save-status"></span>
          </div>

          <div class="credit-cycle">
            <span class="credit-text credit-1">MADE BY MAYANK_KEER.</span>
            <span class="credit-text credit-2">MADE BY ITS_MK_PLAYS.</span>
          </div>
        </main>

        <script>
          // ---- Click sound (generated in-browser, no audio file needed) ----
          var audioCtx = null;
          function playClickSound() {
            try {
              audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
              var osc = audioCtx.createOscillator();
              var gain = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(660, audioCtx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 0.09);
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.12);
            } catch (e) { /* audio not supported */ }
          }

          function spawnRipple(btn, evt) {
            try {
              var rect = btn.getBoundingClientRect();
              var ripple = document.createElement('span');
              var size = Math.max(rect.width, rect.height);
              ripple.className = 'ripple';
              ripple.style.width = ripple.style.height = size + 'px';
              var x = (evt && evt.clientX != null) ? evt.clientX - rect.left - size / 2 : rect.width / 2 - size / 2;
              var y = (evt && evt.clientY != null) ? evt.clientY - rect.top - size / 2 : rect.height / 2 - size / 2;
              ripple.style.left = x + 'px';
              ripple.style.top = y + 'px';
              btn.appendChild(ripple);
              setTimeout(function() { ripple.remove(); }, 500);
            } catch (e) { /* no-op */ }
          }

          function togglePassword(id, btn) {
            var el = document.getElementById(id);
            if (el.type === 'password') {
              el.type = 'text';
              btn.textContent = 'Hide';
            } else {
              el.type = 'password';
              btn.textContent = 'Show';
            }
            playClickSound();
          }

          // ---- Field map: connects each input id to its place in settings.json ----
          var FIELD_MAP = [
            { id: 'f-name', path: ['name'], type: 'text' },
            { id: 'f-username', path: ['bot-account', 'username'], type: 'text' },
            { id: 'f-password', path: ['bot-account', 'password'], type: 'text' },
            { id: 'f-authtype', path: ['bot-account', 'type'], type: 'text' },
            { id: 'f-ip', path: ['server', 'ip'], type: 'text' },
            { id: 'f-port', path: ['server', 'port'], type: 'number' },
            { id: 'f-version', path: ['server', 'version'], type: 'text' },
            { id: 'f-creative', path: ['server', 'try-creative'], type: 'checkbox' },
            { id: 'f-pos-enabled', path: ['position', 'enabled'], type: 'checkbox' },
            { id: 'f-pos-x', path: ['position', 'x'], type: 'number' },
            { id: 'f-pos-y', path: ['position', 'y'], type: 'number' },
            { id: 'f-pos-z', path: ['position', 'z'], type: 'number' },
            { id: 'f-autoauth-enabled', path: ['utils', 'auto-auth', 'enabled'], type: 'checkbox' },
            { id: 'f-autoauth-password', path: ['utils', 'auto-auth', 'password'], type: 'text' },
            { id: 'f-antiafk-enabled', path: ['utils', 'anti-afk', 'enabled'], type: 'checkbox' },
            { id: 'f-antiafk-sneak', path: ['utils', 'anti-afk', 'sneak'], type: 'checkbox' },
            { id: 'f-chatmsg-enabled', path: ['utils', 'chat-messages', 'enabled'], type: 'checkbox' },
            { id: 'f-chatmsg-repeat', path: ['utils', 'chat-messages', 'repeat'], type: 'checkbox' },
            { id: 'f-chatmsg-delay', path: ['utils', 'chat-messages', 'repeat-delay'], type: 'number' },
            { id: 'f-chatmsg-messages', path: ['utils', 'chat-messages', 'messages'], type: 'lines' },
            { id: 'f-chatlog', path: ['utils', 'chat-log'], type: 'checkbox' },
            { id: 'f-reconnect-enabled', path: ['utils', 'auto-reconnect'], type: 'checkbox' },
            { id: 'f-reconnect-delay', path: ['utils', 'auto-reconnect-delay'], type: 'number' },
            { id: 'f-reconnect-maxdelay', path: ['utils', 'max-reconnect-delay'], type: 'number' },
            { id: 'f-move-enabled', path: ['movement', 'enabled'], type: 'checkbox' },
            { id: 'f-circle-enabled', path: ['movement', 'circle-walk', 'enabled'], type: 'checkbox' },
            { id: 'f-circle-radius', path: ['movement', 'circle-walk', 'radius'], type: 'number' },
            { id: 'f-circle-speed', path: ['movement', 'circle-walk', 'speed'], type: 'number' },
            { id: 'f-look-enabled', path: ['movement', 'look-around', 'enabled'], type: 'checkbox' },
            { id: 'f-look-interval', path: ['movement', 'look-around', 'interval'], type: 'number' },
            { id: 'f-jump-enabled', path: ['movement', 'random-jump', 'enabled'], type: 'checkbox' },
            { id: 'f-jump-interval', path: ['movement', 'random-jump', 'interval'], type: 'number' },
            { id: 'f-mod-avoidmobs', path: ['modules', 'avoidMobs'], type: 'checkbox' },
            { id: 'f-mod-combat', path: ['modules', 'combat'], type: 'checkbox' },
            { id: 'f-mod-beds', path: ['modules', 'beds'], type: 'checkbox' },
            { id: 'f-mod-chat', path: ['modules', 'chat'], type: 'checkbox' },
            { id: 'f-mod-console', path: ['modules', 'console-commands'], type: 'checkbox' },
            { id: 'f-combat-attack', path: ['combat', 'attack-mobs'], type: 'checkbox' },
            { id: 'f-combat-autoeat', path: ['combat', 'auto-eat'], type: 'checkbox' },
            { id: 'f-beds-pickup', path: ['beds', 'pick-up-day'], type: 'checkbox' },
            { id: 'f-beds-place', path: ['beds', 'place-night'], type: 'checkbox' },
            { id: 'f-chat-respond', path: ['chat', 'respond'], type: 'checkbox' },
            { id: 'f-discord-enabled', path: ['discord', 'enabled'], type: 'checkbox' },
            { id: 'f-discord-webhook', path: ['discord', 'webhookUrl'], type: 'text' },
            { id: 'f-discord-connect', path: ['discord', 'events', 'connect'], type: 'checkbox' },
            { id: 'f-discord-disconnect', path: ['discord', 'events', 'disconnect'], type: 'checkbox' },
            { id: 'f-discord-chat', path: ['discord', 'events', 'chat'], type: 'checkbox' }
          ];

          function getPath(obj, parts) {
            var cur = obj;
            for (var i = 0; i < parts.length; i++) {
              if (cur == null) return undefined;
              cur = cur[parts[i]];
            }
            return cur;
          }

          function setPath(obj, parts, value) {
            var cur = obj;
            for (var i = 0; i < parts.length - 1; i++) {
              var key = parts[i];
              if (typeof cur[key] !== 'object' || cur[key] === null || Array.isArray(cur[key])) {
                cur[key] = {};
              }
              cur = cur[key];
            }
            cur[parts[parts.length - 1]] = value;
          }

          function populateForm(settings) {
            FIELD_MAP.forEach(function(f) {
              var el = document.getElementById(f.id);
              if (!el) return;
              var val = getPath(settings, f.path);
              if (f.type === 'checkbox') {
                el.checked = !!val;
              } else if (f.type === 'lines') {
                el.value = Array.isArray(val) ? val.join('\\n') : '';
              } else {
                el.value = (val === undefined || val === null) ? '' : val;
              }
            });
          }

          function collectSettings() {
            var out = {};
            FIELD_MAP.forEach(function(f) {
              var el = document.getElementById(f.id);
              if (!el) return;
              var val;
              if (f.type === 'checkbox') {
                val = el.checked;
              } else if (f.type === 'number') {
                val = el.value === '' ? 0 : Number(el.value);
              } else if (f.type === 'lines') {
                val = el.value.split('\\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
              } else {
                val = el.value;
              }
              setPath(out, f.path, val);
            });
            return out;
          }

          function showStatus(msg, ok) {
            var el = document.getElementById('save-status');
            el.textContent = msg;
            el.className = ok ? 'ok' : 'err';
            el.style.opacity = '1';
            clearTimeout(showStatus._t);
            showStatus._t = setTimeout(function() { el.style.opacity = '0'; }, 4500);
          }

          async function loadSettings() {
            try {
              var r = await fetch('/api/settings');
              var data = await r.json();
              if (data.success) populateForm(data.settings);
              else showStatus('Could not load current settings.', false);
            } catch (e) {
              showStatus('Network error loading settings.', false);
            }
          }

          async function saveSettings(evt) {
            if (evt) spawnRipple(document.getElementById('btn-save'), evt);
            playClickSound();
            var payload = collectSettings();
            try {
              var r = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              var data = await r.json();
              showStatus(data.msg || (data.success ? 'Saved!' : 'Failed to save.'), !!data.success);
            } catch (e) {
              showStatus('Network error while saving.', false);
            }
          }

          async function restartBot(evt) {
            if (evt) spawnRipple(document.getElementById('btn-restart'), evt);
            playClickSound();
            showStatus('Restarting bot...', true);
            try {
              var r = await fetch('/api/restart', { method: 'POST' });
              var data = await r.json();
              showStatus(data.msg || 'Restart triggered.', !!data.success);
            } catch (e) {
              showStatus('Network error while restarting.', false);
            }
          }

          loadSettings();
        </script>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
    // FIX: additional info for the dashboard/settings panel (additive only)
    botName: config.name,
    botUsername: config["bot-account"] ? config["bot-account"].username : "",
    serverIp: config.server.ip,
    serverPort: config.server.port,
    serverVersion: config.server.version,
    mcVersion: bot ? bot.version : null,
    errorCount: botState.errors.length,
    discordEnabled: !!(config.discord && config.discord.enabled),
    health: bot && bot.health != null ? bot.health : null,
    food: bot && bot.food != null ? bot.food : null,
  });
});

app.get("/ping", (req, res) => res.send("pong"));

app.get("/logs", (req, res) => {
  const logs = getLogs();

  const escapeHTML = (str) =>
    str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );

  const logCount = logs.length;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Logs</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(14px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background:
              radial-gradient(circle at 15% 0%, rgba(35, 134, 54, 0.12), transparent 45%),
              radial-gradient(circle at 85% 100%, rgba(88, 166, 255, 0.10), transparent 45%),
              #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px;
          }

          main {
            width: 100%;
            max-width: 760px;
            margin: 0 auto;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            margin-bottom: 32px;
            transition: color 0.2s ease, background 0.2s ease, transform 0.12s ease;
            animation: fadeSlideUp 0.4s ease both;
          }
          .back-btn:hover  { background: #21262d; color: #c9d1d9; transform: translateX(-2px); }
          .back-btn:active { transform: scale(0.96); }

          .page-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            margin-bottom: 20px;
            gap: 12px;
            flex-wrap: wrap;
            animation: fadeSlideUp 0.45s ease 0.05s both;
          }

          .page-header-left h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
            background: linear-gradient(90deg, #f0f6fc, #58a6ff 70%);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .page-header-left p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
          }

          .badge {
            font-size: 12px;
            font-weight: 600;
            color: #8b949e;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 20px;
            padding: 4px 12px;
            white-space: nowrap;
            transition: transform 0.2s ease, border-color 0.2s ease;
          }
          .badge:hover { transform: translateY(-1px); border-color: #30363d; }

          .log-card {
            background: #0d1117;
            border: 1px solid #21262d;
            border-radius: 12px;
            overflow: hidden;
            animation: fadeSlideUp 0.5s ease 0.1s both;
            transition: border-color 0.2s ease;
          }
          .log-card:hover { border-color: #30363d; }

          .log-card-header {
            background: #161b22;
            border-bottom: 1px solid #21262d;
            padding: 12px 18px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red   { background: #ff5f57; }
          .dot-yellow{ background: #ffbd2e; }
          .dot-green { background: #28c840; }

          .log-card-title {
            font-size: 12px;
            font-weight: 500;
            color: #484f58;
            margin-left: 4px;
          }

          .log-body {
            padding: 16px 18px;
            max-height: 560px;
            overflow-y: auto;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            line-height: 1.7;
          }

          .log-entry { display: block; padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
          .log-entry.error   { color: #ff7b72; }
          .log-entry.warn    { color: #e3b341; }
          .log-entry.success { color: #3fb950; }
          .log-entry.control { color: #58a6ff; }
          .log-entry.default { color: #8b949e; }

          .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #484f58;
            font-size: 13px;
          }

          .refresh-bar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            margin-top: 12px;
            font-size: 12px;
            color: #484f58;
          }
          .refresh-dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            background: #3fb950;
            animation: pulse 2s infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }

          .console-row {
            display: flex;
            align-items: center;
            border-top: 1px solid #21262d;
            background: #0d1117;
            padding: 10px 18px;
            gap: 10px;
          }

          .console-prompt {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 13px;
            color: #3fb950;
            font-weight: 700;
            flex-shrink: 0;
            user-select: none;
          }

          .console-input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            color: #e6edf3;
            caret-color: #3fb950;
          }

          .console-input::placeholder { color: #484f58; }

          .console-send {
            background: #0d2218;
            border: 1px solid #238636;
            color: #3fb950;
            font-size: 12px;
            font-weight: 600;
            padding: 5px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.2s ease, transform 0.12s ease, box-shadow 0.2s ease;
            flex-shrink: 0;
            position: relative;
            overflow: hidden;
          }
          .console-send:hover  { background: #122d1a; box-shadow: 0 0 12px rgba(35, 134, 54, 0.3); }
          .console-send:active { transform: scale(0.94); }
          .console-send:disabled { opacity: 0.5; cursor: default; }

          .log-entry { animation: fadeSlideUp 0.25s ease both; }

          /* Ripple effect for click feedback */
          .ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.35);
            transform: scale(0);
            animation: rippleAnim 0.5s ease-out;
            pointer-events: none;
          }
          @keyframes rippleAnim {
            to { transform: scale(3); opacity: 0; }
          }

          .console-wrap {
            position: relative;
          }

          .cmd-suggestions {
            display: none;
            position: absolute;
            bottom: calc(100% + 6px);
            left: 0; right: 0;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 10;
          }

          .cmd-suggestions.visible { display: block; }

          .cmd-item {
            display: flex;
            align-items: baseline;
            gap: 12px;
            padding: 9px 16px;
            cursor: pointer;
            transition: background 0.12s;
            border-bottom: 1px solid #21262d;
          }
          .cmd-item:last-child { border-bottom: none; }
          .cmd-item:hover, .cmd-item.active {
            background: #21262d;
          }

          .cmd-name {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            font-weight: 700;
            color: #3fb950;
            flex-shrink: 0;
            min-width: 90px;
          }

          .cmd-desc {
            font-size: 12px;
            color: #6e7681;
          }

          footer { margin-top: 32px; text-align: center; animation: fadeSlideUp 0.5s ease 0.3s both; }
          footer p { font-size: 12px; color: #484f58; margin: 0; }

          .credit-cycle {
            position: relative;
            height: 18px;
            margin-top: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .credit-text {
            position: absolute;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            white-space: nowrap;
            opacity: 0;
            background: linear-gradient(90deg, #58a6ff, #3fb950);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: creditCycle 6s ease-in-out infinite;
          }
          .credit-text.credit-1 { animation-delay: 0s; }
          .credit-text.credit-2 { animation-delay: 3s; }
          @keyframes creditCycle {
            0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
            8%   { opacity: 1; transform: translateY(0) scale(1); }
            42%  { opacity: 1; transform: translateY(0) scale(1); }
            50%  { opacity: 0; transform: translateY(-8px) scale(0.92); }
            100% { opacity: 0; transform: translateY(8px) scale(0.92); }
          }
        </style>
      </head>
      <body>
        <main>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <a href="/" class="back-btn" onclick="playClickSound()">&#8592; Back to Dashboard</a>
            <a href="/settings" class="back-btn" onclick="playClickSound()">&#9881;&#65039; Bot Settings</a>
          </div>

          <div class="page-header">
            <div class="page-header-left">
              <h1>Bot Logs</h1>
              <p>Live output from the AFK bot</p>
            </div>
            <span class="badge">${logCount} ${logCount === 1 ? "entry" : "entries"}</span>
          </div>

          <div class="log-card">
            <div class="log-card-header">
              <span class="dot dot-red"></span>
              <span class="dot dot-yellow"></span>
              <span class="dot dot-green"></span>
              <span class="log-card-title">bot.log</span>
            </div>
            <div class="log-body" id="log-body">
              ${logCount === 0
                ? `<div class="empty-state">No log entries yet. Start the bot to see output.</div>`
                : logs.map((l) => {
                    const escaped = escapeHTML(l);
                    const lower = l.toLowerCase();
                    let cls = "default";
                    if (lower.includes("error") || lower.includes("fail")) cls = "error";
                    else if (lower.includes("warn")) cls = "warn";
                    else if (lower.includes("[control]")) cls = "control";
                    else if (lower.includes("connect") || lower.includes("join") || lower.includes("spawn")) cls = "success";
                    return `<span class="log-entry ${cls}">${escaped}</span>`;
                  }).join("")
              }
            </div>
            <div class="console-wrap">
              <div class="cmd-suggestions" id="cmd-suggestions"></div>
              <div class="console-row">
                <span class="console-prompt">&gt;</span>
                <input
                  id="console-input"
                  class="console-input"
                  type="text"
                  placeholder="Type / for commands, or any message…"
                  autocomplete="off"
                  spellcheck="false"
                >
                <button id="console-send" class="console-send">Send</button>
              </div>
            </div>
          </div>

          <div class="refresh-bar">
            <span class="refresh-dot"></span>
            <span id="refresh-label">Auto-refreshing every 5 seconds</span>
          </div>

          <footer>
            <p>AFK Bot Dashboard &middot; ${config.name}</p>
            <div class="credit-cycle">
              <span class="credit-text credit-1">MADE BY MAYANK_KEER.</span>
              <span class="credit-text credit-2">MADE BY ITS_MK_PLAYS.</span>
            </div>
          </footer>
        </main>

        <script>
          // Click sound (generated in-browser, no audio file needed)
          let audioCtx = null;
          function playClickSound() {
            try {
              audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(660, audioCtx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 0.09);
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.12);
            } catch (e) { /* audio not supported - fail silently */ }
          }

          function spawnRipple(btn, evt) {
            try {
              var rect = btn.getBoundingClientRect();
              var ripple = document.createElement('span');
              var size = Math.max(rect.width, rect.height);
              ripple.className = 'ripple';
              ripple.style.width = ripple.style.height = size + 'px';
              var x = (evt && evt.clientX != null) ? evt.clientX - rect.left - size / 2 : rect.width / 2 - size / 2;
              var y = (evt && evt.clientY != null) ? evt.clientY - rect.top - size / 2 : rect.height / 2 - size / 2;
              ripple.style.left = x + 'px';
              ripple.style.top = y + 'px';
              btn.appendChild(ripple);
              setTimeout(function() { ripple.remove(); }, 500);
            } catch (e) { /* no-op */ }
          }

          (function() {
            var logBody  = document.getElementById('log-body');
            var input    = document.getElementById('console-input');
            var sendBtn  = document.getElementById('console-send');
            var label    = document.getElementById('refresh-label');
            var sugBox   = document.getElementById('cmd-suggestions');
            var refreshTimer = null;
            var typing = false;
            var activeIdx = -1;

            var COMMANDS = [
              { name: '/help',   desc: 'Show all available commands' },
              { name: '/pos',    desc: "Show bot's current coordinates" },
              { name: '/status', desc: 'Show connection status & uptime' },
              { name: '/list',   desc: 'List players on the server' },
              { name: '/say',    desc: 'Send a chat message in-game' },
            ];

            function scrollBottom() {
              if (logBody) logBody.scrollTop = logBody.scrollHeight;
            }

            function scheduleRefresh() {
              clearTimeout(refreshTimer);
              if (!typing) {
                refreshTimer = setTimeout(function() { location.reload(); }, 5000);
              }
            }

            function appendLocalEntry(text, cls) {
              var span = document.createElement('span');
              span.className = 'log-entry ' + (cls || 'control');
              span.textContent = text;
              logBody.appendChild(span);
              scrollBottom();
            }

            function hideSuggestions() {
              sugBox.classList.remove('visible');
              sugBox.innerHTML = '';
              activeIdx = -1;
            }

            function setActive(idx) {
              var items = sugBox.querySelectorAll('.cmd-item');
              items.forEach(function(el, i) {
                el.classList.toggle('active', i === idx);
              });
              activeIdx = idx;
            }

            function showSuggestions(val) {
              var query = val.toLowerCase();
              var matches = COMMANDS.filter(function(c) {
                return c.name.startsWith(query);
              });

              if (!matches.length) { hideSuggestions(); return; }

              sugBox.innerHTML = matches.map(function(c, i) {
                return '<div class="cmd-item" data-cmd="' + c.name + '">' +
                  '<span class="cmd-name">' + c.name + '</span>' +
                  '<span class="cmd-desc">' + c.desc + '</span>' +
                '</div>';
              }).join('');

              sugBox.querySelectorAll('.cmd-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                  e.preventDefault();
                  playClickSound();
                  input.value = el.dataset.cmd + ' ';
                  hideSuggestions();
                  input.focus();
                });
              });

              activeIdx = -1;
              sugBox.classList.add('visible');
            }

            input.addEventListener('input', function() {
              var val = input.value;
              if (val.startsWith('/')) {
                showSuggestions(val);
              } else {
                hideSuggestions();
              }
            });

            input.addEventListener('keydown', function(e) {
              var items = sugBox.querySelectorAll('.cmd-item');
              if (sugBox.classList.contains('visible') && items.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive(Math.min(activeIdx + 1, items.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(Math.max(activeIdx - 1, 0));
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) {
                  e.preventDefault();
                  var chosen = items[activeIdx >= 0 ? activeIdx : 0];
                  input.value = chosen.dataset.cmd + ' ';
                  hideSuggestions();
                  return;
                }
                if (e.key === 'Escape') {
                  hideSuggestions();
                  return;
                }
              }
              if (e.key === 'Enter') sendCommand();
            });

            function sendCommand() {
              var cmd = input.value.trim();
              if (!cmd) return;
              hideSuggestions();
              input.value = '';
              sendBtn.disabled = true;
              appendLocalEntry('> ' + cmd, 'control');

              fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
              })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.msg) {
                  data.msg.split('\\n').forEach(function(line) {
                    appendLocalEntry(line, data.success ? 'default' : 'error');
                  });
                }
              })
              .catch(function() {
                appendLocalEntry('Failed to send command.', 'error');
              })
              .finally(function() {
                sendBtn.disabled = false;
                input.focus();
                scheduleRefresh();
              });
            }

            sendBtn.addEventListener('click', function(e) {
              playClickSound();
              spawnRipple(sendBtn, e);
              sendCommand();
            });

            input.addEventListener('focus', function() {
              typing = true;
              clearTimeout(refreshTimer);
              label.textContent = 'Auto-refresh paused while typing';
            });
            input.addEventListener('blur', function() {
              setTimeout(function() {
                hideSuggestions();
                typing = false;
                label.textContent = 'Auto-refreshing every 5 seconds';
                scheduleRefresh();
              }, 150);
            });

            scrollBottom();
            scheduleRefresh();
          })();
        </script>
      </body>
    </html>
  `);
});

let botRunning = true;

// ============================================================
// AUTHENTICATED CONTROL API
// Browser dashboard remains same-origin; Discord uses PANEL_TOKEN.
// Set PANEL_TOKEN in Railway Variables. Never hard-code it.
// ============================================================
const PANEL_TOKEN = process.env.PANEL_TOKEN || "";

function authorizedControlRequest(req) {
  if (!PANEL_TOKEN) return false;
  const supplied = req.get("x-panel-token");
  if (supplied && supplied.length === PANEL_TOKEN.length) {
    let ok = true;
    for (let i = 0; i < PANEL_TOKEN.length; i++) {
      if (supplied.charCodeAt(i) !== PANEL_TOKEN.charCodeAt(i)) ok = false;
    }
    return ok;
  }

  // Allow the existing dashboard itself to keep working.
  const origin = req.get("origin");
  const host = req.get("host");
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch (_) {}
  }
  return false;
}

function requireControlAuth(req, res, next) {
  if (!authorizedControlRequest(req)) {
    return res.status(401).json({ success: false, msg: "Unauthorized. Use the dashboard or X-Panel-Token." });
  }
  next();
}

app.post("/start", requireControlAuth, (req, res) => {
  if (botRunning) return res.json({ success: false, msg: "Already running" });

  botRunning = true;
  createBot();
  addLog("[Control] Bot started");

  res.json({ success: true });
});

app.post("/stop", requireControlAuth, (req, res) => {
  if (!botRunning) return res.json({ success: false, msg: "Already stopped" });

  botRunning = false;

  if (bot) {
    bot.end();
    bot = null;
  }

  clearAllIntervals();
  addLog("[Control] Bot stopped");

  res.json({ success: true });
});

app.post("/command", requireControlAuth, express.json(), (req, res) => {
  const cmd = (req.body.command || "").trim();
  if (!cmd) return res.json({ success: false, msg: "Empty command." });

  addLog(`[Console] > ${cmd}`);

  if (cmd === "/help") {
    const lines = [
      "Available commands:",
      "  /help          - Show this help message",
      "  /pos           - Show bot's current coordinates",
      "  /status        - Show bot connection status",
      "  /list          - Ask server for player list",
      "  /say <message> - Send a chat message in-game",
      "  /<anything>    - Send any Minecraft command directly",
      "  <text>         - Send plain chat (no slash needed)",
    ];
    lines.forEach((l) => addLog(`[Console] ${l}`));
    return res.json({ success: true, msg: lines.join("\n") });
  }

  if (cmd === "/pos" || cmd === "/coords") {
    const pos = bot && bot.entity ? bot.entity.position : null;
    const msg = pos
      ? `Position: X=${Math.floor(pos.x)}  Y=${Math.floor(pos.y)}  Z=${Math.floor(pos.z)}`
      : "Position unavailable (bot not spawned).";
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/status") {
    const status = botState.connected ? "Connected" : "Disconnected";
    const uptime = Math.floor((Date.now() - botState.startTime) / 1000);
    const msg = `Status: ${status} | Uptime: ${uptime}s | Reconnects: ${botState.reconnectAttempts}`;
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (!bot || typeof bot.chat !== "function") {
    const msg = bot
      ? "Bot is still connecting — try again in a moment."
      : "Bot is not running.";
    addLog(`[Console] ${msg}`);
    return res.json({ success: false, msg });
  }

  try {
    bot.chat(cmd);
    addLog(`[Console] Sent to server: ${cmd}`);
    return res.json({ success: true, msg: `Sent: ${cmd}` });
  } catch (err) {
    addLog(`[Console] Error: ${err.message}`);
    return res.json({ success: false, msg: err.message });
  }
});

// ============================================================
// SETTINGS PANEL API - view & update settings.json, restart bot
// ============================================================
app.get("/api/settings", requireControlAuth, (req, res) => {
  res.json({ success: true, settings: config });
});

app.post("/api/settings", requireControlAuth, express.json(), (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.json({ success: false, msg: "Invalid settings payload." });
    }

    deepMergeInto(config, updates);
    const saved = saveSettingsToDisk();

    addLog("[Settings] Settings updated from control panel");
    if (config.utils && config.utils["chat-log"] !== false) {
      addLog(
        `[Settings] Server target now: ${config.server.ip}:${config.server.port}`,
      );
    }

    res.json({
      success: saved,
      msg: saved
        ? "Settings saved to settings.json."
        : "Applied in memory, but failed to write settings.json to disk.",
    });
  } catch (e) {
    addLog(`[Settings] Error updating settings: ${e.message}`);
    res.json({ success: false, msg: e.message });
  }
});

app.post("/api/restart", requireControlAuth, (req, res) => {
  addLog("[Control] Restart requested (applying latest settings)");

  botRunning = true;
  clearBotTimeouts();
  clearAllIntervals();

  if (bot) {
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      /* ignore */
    }
    bot = null;
  }

  botState.connected = false;

  // Small delay so the old connection fully closes before reconnecting
  setTimeout(() => {
    createBot();
  }, 800);

  res.json({ success: true, msg: "Bot restarting with the latest settings..." });
});

// ============================================================
//                    END OF WEB TOOLS
//============================================================

// FIX: handle port conflict gracefully - try next port if taken
const server = app.listen(PORT, "0.0.0.0", () => {
  addLog(`[Server] HTTP server started on port ${server.address().port} `);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const fallbackPort = PORT + 1;
    addLog(`[Server] Port ${PORT} in use - trying port ${fallbackPort} `);
    server.listen(fallbackPort, "0.0.0.0");
  } else {
    addLog(`[Server] HTTP server error: ${err.message} `);
  }
});

// FIX: only one definition of formatUptime
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s} s`;
}

// ============================================================
// SELF-PING - Prevent Render from sleeping
// FIX: only ping if RENDER_EXTERNAL_URL is set (skip useless localhost ping)
// ============================================================
const SELF_PING_INTERVAL = 10 * 60 * 1000;

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    addLog(
      "[KeepAlive] No RENDER_EXTERNAL_URL set - self-ping disabled (running locally)",
    );
    return;
  }
  setInterval(() => {
    const protocol = renderUrl.startsWith("https") ? https : http;
    protocol
      .get(`${renderUrl}/ping`, (res) => {
        // Silent success
      })
      .on("error", (err) => {
        addLog(`[KeepAlive] Self-ping failed: ${err.message}`);
      });
  }, SELF_PING_INTERVAL);
  addLog("[KeepAlive] Self-ping system started (every 10 min)");
}

startSelfPing();

// ============================================================
// MEMORY MONITORING
// ============================================================
setInterval(
  () => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    addLog(`[Memory] Heap: ${heapMB} MB`);
  },
  5 * 60 * 1000,
);

// ============================================================
// BOT CREATION WITH RECONNECTION LOGIC
// ============================================================
// ============================================================
// RECONNECTION & TIMEOUT MANAGEMENT
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;

function clearBotTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
}

// FIX: Discord rate limiting - track last send time
let lastDiscordSend = 0;
const DISCORD_RATE_LIMIT_MS = 5000; // min 5s between webhook calls

function clearAllIntervals() {
  addLog(`[Cleanup] Clearing ${activeIntervals.length} intervals`);
  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  if (botState.wasThrottled) {
    botState.wasThrottled = false;
    const throttleDelay = 60000 + Math.floor(Math.random() * 60000);
    addLog(
      `[Bot] Throttle detected - using extended delay: ${throttleDelay / 1000}s`,
    );
    return throttleDelay;
  }

  // FIX: read auto-reconnect-delay from settings as base delay
  const baseDelay = config.utils["auto-reconnect-delay"] || 3000;
  const maxDelay = config.utils["max-reconnect-delay"] || 30000;
  const delay = Math.min(
    baseDelay * Math.pow(2, botState.reconnectAttempts),
    maxDelay,
  );
  const jitter = Math.floor(Math.random() * 2000);
  return delay + jitter;
}

function createBot() {
  if (isReconnecting) {
    addLog("[Bot] Already reconnecting, skipping...");
    return;
  }

  // Cleanup previous bot properly to avoid ghost bots
  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      addLog("[Cleanup] Error ending previous bot:", e.message);
    }
    bot = null;
  }

  addLog(`[Bot] Creating bot instance...`);
  addLog(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  try {
    // FIX: use version:false to auto-detect server version so the bot can join any server.
    // If the user explicitly sets a version in settings.json it is still respected.
    const botVersion =
      config.server.version && config.server.version.trim() !== ""
        ? config.server.version
        : false;
    bot = mineflayer.createBot({
      username: config["bot-account"].username,
      password: config["bot-account"].password || undefined,
      auth: config["bot-account"].type,
      host: config.server.ip,
      port: config.server.port,
      version: botVersion,
      hideErrors: false,
      checkTimeoutInterval: 600000,
    });

    bot.loadPlugin(pathfinder);

    // FIX: connection timeout - end the old bot before reconnecting to avoid ghost bots
    clearBotTimeouts();
    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected) {
        addLog("[Bot] Connection timeout - no spawn received");
        try {
          bot.removeAllListeners();
          bot.end();
        } catch (e) {
          /* ignore */
        }
        bot = null;
        scheduleReconnect();
      }
    }, 150000); // 150s - Aternos servers can take 90-120s to finish spawning a player

    // FIX: guard against spawn firing twice (can happen on some servers)
    let spawnHandled = false;

    bot.once("spawn", () => {
      if (spawnHandled) return;
      spawnHandled = true;

      clearBotTimeouts();
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;

      addLog(
        `[Bot] [+] Successfully spawned on server! (Version: ${bot.version})`,
      );
      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.connect
      ) {
        sendDiscordWebhook(
          `[+] **Connected** to \`${config.server.ip}\``,
          0x4ade80,
        );
      }

      // FIX: use bot.version (auto-detected) instead of config value so minecraft-data always matches
      const mcData = require("minecraft-data")(bot.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      defaultMove.liquidCost = 1000;
      defaultMove.fallDamageCost = 1000;

      initializeModules(bot, mcData, defaultMove);

      // Attempt creative mode (only works if bot has OP and enabled in settings)
      setTimeout(() => {
        if (bot && botState.connected && config.server["try-creative"]) {
          bot.chat("/gamemode creative");
          addLog("[INFO] Attempted to set creative mode (requires OP)");
        }
      }, 3000);

      bot.on("messagestr", (message) => {
        if (
          message.includes("commands.gamemode.success.self") ||
          message.includes("Set own game mode to Creative Mode")
        ) {
          addLog("[INFO] Bot is now in Creative Mode.");
        }
      });
    });

    // FIX: 'kicked' fires before 'end'. Remove the scheduleReconnect from 'kicked'
    // so that 'end' is the single source of reconnect truth, preventing double-trigger.
    bot.on("kicked", (reason) => {
      // FIX: stringify reason if it's an object to make it readable in logs
      const kickReason =
        typeof reason === "object" ? JSON.stringify(reason) : reason;
      addLog(`[Bot] Kicked: ${kickReason}`);
      botState.connected = false;
      botState.errors.push({
        type: "kicked",
        reason: kickReason,
        time: Date.now(),
      });
      clearAllIntervals();

      const reasonStr = String(kickReason).toLowerCase();
      if (
        reasonStr.includes("throttl") ||
        reasonStr.includes("wait before reconnect") ||
        reasonStr.includes("too fast")
      ) {
        addLog(
          "[Bot] Throttle kick detected - will use extended reconnect delay",
        );
        botState.wasThrottled = true;
      }

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(`[!] **Kicked**: ${kickReason}`, 0xff0000);
      }
      // NOTE: do NOT call scheduleReconnect() here - 'end' will fire right after 'kicked' and handle it
    });

    // FIX: 'end' is the single reconnect trigger
    bot.on("end", (reason) => {
      addLog(`[Bot] Disconnected: ${reason || "Unknown reason"}`);
      botState.connected = false;
      clearAllIntervals();
      spawnHandled = false; // reset for next connection

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(
          `[-] **Disconnected**: ${reason || "Unknown"}`,
          0xf87171,
        );
      }

      // ALWAYS reconnect — bot must never leave the server
      scheduleReconnect();
    });

    bot.on("error", (err) => {
      const msg = err.message || "";
      addLog(`[Bot] Error: ${msg}`);
      botState.errors.push({ type: "error", message: msg, time: Date.now() });
      // Don't reconnect on error - let 'end' event handle it
    });
  } catch (err) {
    addLog(`[Bot] Failed to create bot: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearBotTimeouts();

  // FIX: don't stack reconnect if already waiting
  if (isReconnecting) {
    addLog("[Bot] Reconnect already scheduled, skipping duplicate.");
    return;
  }

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  addLog(
    `[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`,
  );

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  addLog("[Modules] Initializing all modules...");

  // ---------- AUTO AUTH (REACTIVE) ----------
  if (config.utils["auto-auth"] && config.utils["auto-auth"].enabled) {
    const password = config.utils["auto-auth"].password;
    let authHandled = false;

    const tryAuth = (type) => {
      if (authHandled || !bot || !botState.connected) return;
      authHandled = true;
      if (type === "register") {
        bot.chat(`/register ${password} ${password}`);
        addLog("[Auth] Detected register prompt - sent /register");
      } else {
        bot.chat(`/login ${password}`);
        addLog("[Auth] Detected login prompt - sent /login");
      }
    };

    bot.on("messagestr", (message) => {
      if (authHandled) return;
      const msg = message.toLowerCase();
      if (
        msg.includes("/register") ||
        msg.includes("register ") ||
        msg.includes("지정된 비밀번호")
      ) {
        tryAuth("register");
      } else if (
        msg.includes("/login") ||
        msg.includes("login ") ||
        msg.includes("로그인")
      ) {
        tryAuth("login");
      }
    });

    // Failsafe: if no prompt after 10s, try login anyway
    setTimeout(() => {
      if (!authHandled && bot && botState.connected) {
        addLog(
          "[Auth] No prompt detected after 10s, sending /login as failsafe",
        );
        bot.chat(`/login ${password}`);
        authHandled = true;
      }
    }, 10000);
  }

  // ---------- CHAT MESSAGES ----------
  if (config.utils["chat-messages"] && config.utils["chat-messages"].enabled) {
    const messages = config.utils["chat-messages"].messages;
    if (config.utils["chat-messages"].repeat) {
      let i = 0;
      addInterval(() => {
        if (bot && botState.connected) {
          bot.chat(messages[i]);
          botState.lastActivity = Date.now();
          i = (i + 1) % messages.length;
        }
      }, config.utils["chat-messages"]["repeat-delay"] * 1000);
    } else {
      messages.forEach((msg, idx) => {
        setTimeout(() => {
          if (bot && botState.connected) bot.chat(msg);
        }, idx * 1000);
      });
    }
  }

  // ---------- MOVE TO POSITION ----------
  // FIX: only use position goal if circle-walk is NOT enabled (they fight over pathfinder)
  if (
    config.position &&
    config.position.enabled &&
    !(
      config.movement &&
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    )
  ) {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(
      new GoalBlock(config.position.x, config.position.y, config.position.z),
    );
    addLog("[Position] Navigating to configured position...");
  }

  // ---------- ANTI-AFK ----------
  if (config.utils["anti-afk"] && config.utils["anti-afk"].enabled) {
    // Arm swinging
    addInterval(
      () => {
        if (!bot || !botState.connected) return;
        try {
          bot.swingArm();
        } catch (e) {}
      },
      10000 + Math.floor(Math.random() * 50000),
    );

    // Hotbar cycling
    addInterval(
      () => {
        if (!bot || !botState.connected) return;
        try {
          const slot = Math.floor(Math.random() * 9);
          bot.setQuickBarSlot(slot);
        } catch (e) {}
      },
      30000 + Math.floor(Math.random() * 90000),
    );

    // Teabagging
    addInterval(
      () => {
        if (
          !bot ||
          !botState.connected ||
          typeof bot.setControlState !== "function"
        )
          return;
        if (Math.random() > 0.9) {
          let count = 2 + Math.floor(Math.random() * 4);
          const doTeabag = () => {
            if (count <= 0 || !bot || typeof bot.setControlState !== "function")
              return;
            try {
              bot.setControlState("sneak", true);
              setTimeout(() => {
                if (bot && typeof bot.setControlState === "function")
                  bot.setControlState("sneak", false);
                count--;
                setTimeout(doTeabag, 150);
              }, 150);
            } catch (e) {}
          };
          doTeabag();
        }
      },
      120000 + Math.floor(Math.random() * 180000),
    );

    // FIX: micro-walk only when circle-walk is NOT running, to avoid interrupting pathfinder
    if (
      !(
        config.movement &&
        config.movement["circle-walk"] &&
        config.movement["circle-walk"].enabled
      )
    ) {
      addInterval(
        () => {
          if (
            !bot ||
            !botState.connected ||
            typeof bot.setControlState !== "function"
          )
            return;
          try {
            const yaw = Math.random() * Math.PI * 2;
            bot.look(yaw, 0, true);
            bot.setControlState("forward", true);
            setTimeout(
              () => {
                if (bot && typeof bot.setControlState === "function")
                  bot.setControlState("forward", false);
              },
              500 + Math.floor(Math.random() * 1500),
            );
            botState.lastActivity = Date.now();
          } catch (e) {
            addLog("[AntiAFK] Walk error:", e.message);
          }
        },
        120000 + Math.floor(Math.random() * 360000),
      );
    }

    if (config.utils["anti-afk"].sneak) {
      try {
        if (typeof bot.setControlState === "function")
          bot.setControlState("sneak", true);
      } catch (e) {}
    }
  }

  // ---------- MOVEMENT MODULES ----------
  // FIX: check top-level movement.enabled flag
  if (config.movement && config.movement.enabled !== false) {
    // FIX: circle-walk and random-jump both jump - only run one jumping mechanism
    // random-jump is skipped if anti-afk jump is handled elsewhere; we only use random-jump here
    if (
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    ) {
      startCircleWalk(bot, defaultMove);
    }
    // FIX: only run random-jump if circle-walk is NOT running (circle-walk also keeps bot moving)
    if (
      config.movement["random-jump"] &&
      config.movement["random-jump"].enabled &&
      !(
        config.movement["circle-walk"] && config.movement["circle-walk"].enabled
      )
    ) {
      startRandomJump(bot);
    }
    if (
      config.movement["look-around"] &&
      config.movement["look-around"].enabled
    ) {
      startLookAround(bot);
    }
  }

  // ---------- CUSTOM MODULES ----------
  // FIX: avoidMobs AND combatModule conflict - if combat is enabled, don't run avoidMobs at the same time
  if (config.modules.avoidMobs && !config.modules.combat) {
    avoidMobs(bot);
  }
  if (config.modules.combat) {
    combatModule(bot, mcData);
  }
  if (config.modules.beds) {
    bedModule(bot, mcData);
  }
  if (config.modules.chat) {
    chatModule(bot);
  }

  addLog("[Modules] All modules initialized!");
}

// ============================================================
// MOVEMENT HELPERS
// ============================================================
function startCircleWalk(bot, defaultMove) {
  const radius = config.movement["circle-walk"].radius;
  let angle = 0;
  let lastPathTime = 0;

  addInterval(() => {
    if (!bot || !botState.connected) return;
    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;
    try {
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(
        new GoalBlock(
          Math.floor(x),
          Math.floor(bot.entity.position.y),
          Math.floor(z),
        ),
      );
      angle += Math.PI / 4;
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[CircleWalk] Error:", e.message);
    }
  }, config.movement["circle-walk"].speed);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      bot.setControlState("jump", true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === "function")
          bot.setControlState("jump", false);
      }, 300);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[RandomJump] Error:", e.message);
    }
  }, config.movement["random-jump"].interval);
}

function startLookAround(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() * Math.PI) / 2 - Math.PI / 4;
      bot.look(yaw, pitch, false);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[LookAround] Error:", e.message);
    }
  }, config.movement["look-around"].interval);
}

// ============================================================
// CUSTOM MODULES
// ============================================================

// Avoid mobs/players
// FIX: e.username only exists on players; use e.name for mobs - now handled properly
function avoidMobs(bot) {
  const safeDistance = 5;
  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      const entities = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" ||
          (e.type === "player" && e.username !== bot.username),
      );
      for (const e of entities) {
        if (!e.position) continue;
        const distance = bot.entity.position.distanceTo(e.position);
        if (distance < safeDistance) {
          bot.setControlState("back", true);
          setTimeout(() => {
            if (bot && typeof bot.setControlState === "function")
              bot.setControlState("back", false);
          }, 500);
          break;
        }
      }
    } catch (e) {
      addLog("[AvoidMobs] Error:", e.message);
    }
  }, 2000);
}

// Combat module
// FIX: attack cooldown for 1.9+ (600ms minimum between attacks)
// FIX: lock onto a target for multiple ticks instead of randomly switching every tick
// FIX: autoEat - use i.foodPoints directly (mineflayer item property) instead of broken mcData lookup
function combatModule(bot, mcData) {
  let lastAttackTime = 0;
  let lockedTarget = null;
  let lockedTargetExpiry = 0;

  // FIX: use physicsTick (not the deprecated physicTick)
  bot.on("physicsTick", () => {
    if (!bot || !botState.connected) return;
    if (!config.combat["attack-mobs"]) return;

    const now = Date.now();
    // FIX: 1.9+ attack cooldown - respect at least 600ms between swings
    if (now - lastAttackTime < 620) return;

    try {
      // FIX: only pick a new target if current one is gone or lock expired
      if (
        lockedTarget &&
        now < lockedTargetExpiry &&
        bot.entities[lockedTarget.id] &&
        lockedTarget.position
      ) {
        const dist = bot.entity.position.distanceTo(lockedTarget.position);
        if (dist < 4) {
          bot.attack(lockedTarget);
          lastAttackTime = now;
          return;
        } else {
          lockedTarget = null;
        }
      }

      // Pick a new target
      const mobs = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" &&
          e.position &&
          bot.entity.position.distanceTo(e.position) < 4,
      );
      if (mobs.length > 0) {
        lockedTarget = mobs[0];
        lockedTargetExpiry = now + 3000; // stick to same mob for 3 seconds
        bot.attack(lockedTarget);
        lastAttackTime = now;
      }
    } catch (e) {
      addLog("[Combat] Error:", e.message);
    }
  });

  // FIX: autoEat - check foodPoints property on the item directly (works reliably)
  bot.on("health", () => {
    if (!config.combat["auto-eat"]) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory
          .items()
          .find((i) => i.foodPoints && i.foodPoints > 0);
        if (food) {
          bot
            .equip(food, "hand")
            .then(() => bot.consume())
            .catch((e) => addLog("[AutoEat] Error:", e.message));
        }
      }
    } catch (e) {
      addLog("[AutoEat] Error:", e.message);
    }
  });
}

// Bed module
// FIX: bot.isSleeping can be stale; use a local isTryingToSleep guard to prevent double-sleep errors
// FIX: place-night was false in default settings - documentation note added
function bedModule(bot, mcData) {
  let isTryingToSleep = false;

  addInterval(async () => {
    if (!bot || !botState.connected) return;
    if (!config.beds["place-night"]) return; // FIX: check flag (was always skipping before)

    try {
      const isNight =
        bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;

      // FIX: use local guard instead of stale bot.isSleeping
      if (isNight && !isTryingToSleep) {
        const bedBlock = bot.findBlock({
          matching: (block) => block.name.includes("bed"),
          maxDistance: 8,
        });

        if (bedBlock) {
          isTryingToSleep = true;
          try {
            await bot.sleep(bedBlock);
            addLog("[Bed] Sleeping...");
          } catch (e) {
            // Can't sleep - maybe not night enough or monsters nearby
          } finally {
            isTryingToSleep = false;
          }
        }
      }
    } catch (e) {
      isTryingToSleep = false;
      addLog("[Bed] Error:", e.message);
    }
  }, 10000);
}

// Chat module
// FIX: wire up discord.events.chat flag
function chatModule(bot) {
  bot.on("chat", (username, message) => {
    if (!bot || username === bot.username) return;

    try {
      // FIX: send chat events to Discord if enabled
      if (
        config.discord &&
        config.discord.enabled &&
        config.discord.events &&
        config.discord.events.chat
      ) {
        sendDiscordWebhook(`💬 **${username}**: ${message}`, 0x7289da);
      }

      if (config.chat && config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
          bot.chat(`Hello, ${username}!`);
        }
        if (message.startsWith("!tp ")) {
          const target = message.split(" ")[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      addLog("[Chat] Error:", e.message);
    }
  });
}

// ============================================================
// CONSOLE COMMANDS
// ============================================================
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  if (!bot || !botState.connected) {
    addLog("[Console] Bot not connected");
    return;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("say ")) {
    bot.chat(trimmed.slice(4));
  } else if (trimmed.startsWith("cmd ")) {
    bot.chat("/" + trimmed.slice(4));
  } else if (trimmed === "status") {
    addLog(
      `Connected: ${botState.connected}, Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`,
    );
  } else {
    bot.chat(trimmed);
  }
});

// ============================================================
// DISCORD WEBHOOK INTEGRATION
// FIX: use Buffer.byteLength for Content-Length (handles non-ASCII usernames correctly)
// FIX: rate limiting to avoid spam when bot is flapping
// ============================================================
function sendDiscordWebhook(content, color = 0x0099ff) {
  if (
    !config.discord ||
    !config.discord.enabled ||
    !config.discord.webhookUrl ||
    config.discord.webhookUrl.includes("YOUR_DISCORD")
  )
    return;

  // FIX: Discord rate limiting - skip if sent too recently
  const now = Date.now();
  if (now - lastDiscordSend < DISCORD_RATE_LIMIT_MS) {
    addLog("[Discord] Rate limited - skipping webhook");
    return;
  }
  lastDiscordSend = now;

  const protocol = config.discord.webhookUrl.startsWith("https") ? https : http;
  const urlParts = new URL(config.discord.webhookUrl);

  const payload = JSON.stringify({
    username: config.name,
    embeds: [
      {
        description: content,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: "Slobos AFK Bot" },
      },
    ],
  });

  const options = {
    hostname: urlParts.hostname,
    port: 443,
    path: urlParts.pathname + urlParts.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // FIX: use Buffer.byteLength instead of payload.length - handles non-ASCII (e.g. usernames with accents/emoji)
      "Content-Length": Buffer.byteLength(payload, "utf8"),
    },
  };

  const req = protocol.request(options, (res) => {
    // Silent success
  });

  req.on("error", (e) => {
    addLog(`[Discord] Error sending webhook: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// ============================================================
// DISCORD CONTROL PANEL
// Env:
// DISCORD_TOKEN   = Discord bot token
// PANEL_URL       = Railway public URL, e.g. https://your-app.up.railway.app
// PANEL_TOKEN     = strong random secret, same value sent to protected panel routes
// DISCORD_ALLOWED_USER_IDS = comma-separated Discord user IDs
// ============================================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const PANEL_URL = (process.env.PANEL_URL || "").replace(/\/+$/, "");
const ALLOWED_DISCORD_USER_IDS = new Set(
  (process.env.DISCORD_ALLOWED_USER_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

async function panelRequest(pathname, options = {}) {
  if (!PANEL_URL) throw new Error("PANEL_URL is not configured.");
  if (!PANEL_TOKEN) throw new Error("PANEL_TOKEN is not configured.");

  const response = await fetch(`${PANEL_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Panel-Token": PANEL_TOKEN,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { success: false, msg: text }; }

  if (!response.ok) throw new Error(data.msg || `Panel HTTP ${response.status}`);
  return data;
}

function discordAllowed(interaction) {
  return ALLOWED_DISCORD_USER_IDS.size > 0 &&
    ALLOWED_DISCORD_USER_IDS.has(interaction.user.id);
}

function discordControlEmbed(title, description, color = 0x5865F2) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

function discordControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mk_start").setLabel("🟢 Start").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mk_stop").setLabel("🔴 Stop").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("mk_restart").setLabel("🔄 Restart").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mk_status").setLabel("📊 Status").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("mk_health").setLabel("❤️ Health").setStyle(ButtonStyle.Secondary),
  );
}

async function discordPanelMessage() {
  const health = await panelRequest("/health");
  const connected = health.status === "connected";
  return {
    embeds: [
      discordControlEmbed(
        `${config.name} • Minecraft Control`,
        [
          `Status: ${connected ? "🟢 Connected" : "🔴 Disconnected"}`,
          `Server: \`${health.serverIp}:${health.serverPort}\``,
          `Bot: \`${health.botUsername || "unknown"}\``,
          health.coords
            ? `Position: \`${Math.floor(health.coords.x)}, ${Math.floor(health.coords.y)}, ${Math.floor(health.coords.z)}\``
            : "Position: unavailable",
        ].join("\n"),
        connected ? 0x57F287 : 0xED4245,
      ),
    ],
    components: [discordControlRow()],
  };
}

async function startDiscordControl() {
  if (!DISCORD_TOKEN) {
    addLog("[Discord] DISCORD_TOKEN not configured; control layer disabled.");
    return;
  }
  if (!PANEL_URL || !PANEL_TOKEN) {
    addLog("[Discord] PANEL_URL/PANEL_TOKEN missing; control layer disabled.");
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("ready", async () => {
    addLog(`[Discord] Control bot logged in as ${client.user.tag}`);

    const commands = [
      new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Open the Minecraft control panel"),
      new SlashCommandBuilder()
        .setName("say")
        .setDescription("Send a Minecraft chat message")
        .addStringOption((o) => o.setName("message").setDescription("Message to send").setRequired(true)),
      new SlashCommandBuilder()
        .setName("cmd")
        .setDescription("Run a Minecraft command")
        .addStringOption((o) => o.setName("command").setDescription("Minecraft command").setRequired(true)),
    ].map((c) => c.toJSON());

    try {
      const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      addLog("[Discord] Slash commands registered: /panel /say /cmd");
    } catch (err) {
      addLog(`[Discord] Slash command registration failed: ${err.message}`);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    if (!discordAllowed(interaction)) {
      return interaction.reply({
        content: "⛔ You are not allowed to control this bot.",
        ephemeral: true,
      });
    }

    try {
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        if (name === "panel") {
          return interaction.reply({ ...await discordPanelMessage(), ephemeral: true });
        }

        if (name === "say") {
          const message = interaction.options.getString("message", true).trim();
          const data = await panelRequest("/command", {
            method: "POST",
            body: JSON.stringify({ command: message }),
          });
          return interaction.reply({ content: data.msg || "Sent.", ephemeral: true });
        }

        if (name === "cmd") {
          const command = interaction.options.getString("command", true).trim();
          const data = await panelRequest("/command", {
            method: "POST",
            body: JSON.stringify({ command: command.startsWith("/") ? command : `/${command}` }),
          });
          return interaction.reply({ content: data.msg || "Command sent.", ephemeral: true });
        }
      }

      const id = interaction.customId;
      await interaction.deferReply({ ephemeral: true });

      if (id === "mk_start") {
        const data = await panelRequest("/start", { method: "POST" });
        return interaction.editReply(data.success ? "🟢 Bot started." : `ℹ️ ${data.msg}`);
      }
      if (id === "mk_stop") {
        const data = await panelRequest("/stop", { method: "POST" });
        return interaction.editReply(data.success ? "🔴 Bot stopped." : `ℹ️ ${data.msg}`);
      }
      if (id === "mk_restart") {
        const data = await panelRequest("/api/restart", { method: "POST" });
        return interaction.editReply(data.msg || "🔄 Restart requested.");
      }
      if (id === "mk_status" || id === "mk_health") {
        const h = await panelRequest("/health");
        const extra = id === "mk_health"
          ? `\nHealth: ${h.health ?? "n/a"} | Food: ${h.food ?? "n/a"} | Errors: ${h.errorCount ?? 0}`
          : "";
        return interaction.editReply(
          `📊 Status: **${h.status}**\nUptime: ${formatUptime(h.uptime)}\nReconnects: ${h.reconnectAttempts}${extra}`,
        );
      }
    } catch (err) {
      addLog(`[Discord] Control error: ${err.message}`);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(`❌ ${err.message}`);
      }
      return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
    }
  });

  try {
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    addLog(`[Discord] Login failed: ${err.message}`);
  }
}

if (!process.env.BOT_WORKER) startDiscordControl();

// ============================================================
// CRASH RECOVERY - IMMORTAL MODE
// FIX: guard against uncaughtException stacking reconnects when isReconnecting is already true
// ============================================================
process.on("uncaughtException", (err) => {
  const msg = err.message || "Unknown";
  addLog(`[FATAL] Uncaught Exception: ${msg}`);
  botState.errors.push({ type: "uncaught", message: msg, time: Date.now() });

  // Cap errors array to prevent memory leak over long uptimes
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("PartialReadError") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("timed out") ||
    msg.includes("write after end") ||
    msg.includes("This socket has been ended");

  if (isNetworkError) {
    addLog("[FATAL] Known network/protocol error - recovering gracefully...");
  }

  // ALWAYS recover — bot must never stay disconnected
  clearAllIntervals();
  botState.connected = false;

  // FIX: reset isReconnecting if it was stuck, then schedule reconnect
  if (isReconnecting) {
    addLog(
      "[FATAL] isReconnecting was stuck - resetting before crash recovery",
    );
    isReconnecting = false;
    // BUG FIX: was referencing non-existent 'reconnectTimeout' — correct name is 'reconnectTimeoutId'
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  setTimeout(
    () => {
      scheduleReconnect();
    },
    isNetworkError ? 5000 : 10000,
  );
});

process.on("unhandledRejection", (reason) => {
  const msg = String(reason);
  addLog(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: "rejection", message: msg, time: Date.now() });
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("timed out") ||
    msg.includes("PartialReadError");

  if (isNetworkError && !isReconnecting) {
    addLog("[FATAL] Network rejection — triggering reconnect...");
    clearAllIntervals();
    botState.connected = false;
    if (bot) {
      try { bot.end(); } catch (_) {}
      bot = null;
    }
    scheduleReconnect();
  }
});

process.on("SIGTERM", () => {
  addLog("[System] SIGTERM received — ignoring, bot will stay alive.");
});

process.on("SIGINT", () => {
  addLog("[System] SIGINT received — ignoring, bot will stay alive.");
});

// =============================
//===============================
// START THE BOT
// ============================================================
addLog("=".repeat(50));
addLog("  Minecraft AFK Bot v2.5 - Bug-Fixed Edition");
addLog("=".repeat(50));
addLog(`Server: ${config.server.ip}:${config.server.port}`);
addLog(`Version: ${config.server.version}`);
addLog(
  `Auto-Reconnect: ${config.utils["auto-reconnect"] ? "Enabled" : "Disabled"}`,
);
addLog("=".repeat(50));

if (!process.env.BOT_WORKER || process.env.BOT_WORKER === "1") createBot();
