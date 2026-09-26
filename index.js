"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const config = require("./settings.json");
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
const SETTINGS_PATH = path.join(__dirname, "settings.json");

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
        <title>${config.name} — Control Panel</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }
          :root {
            --bg: #0d1117; --panel: #161b22; --panel2: #1c2129;
            --border: #21262d; --border-hover: #30363d;
            --text: #e6edf3; --muted: #8b949e; --muted2: #6e7681;
            --accent: #58a6ff; --accent-dim: #0d1c2e;
            --green: #3fb950; --green-dark: #238636; --green-bg: #0d2218;
            --red: #f85149; --red-dark: #da3633; --red-bg: #200d0d;
            --yellow: #e3b341;
          }
          @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes popIn { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
          @keyframes pulseRing { 0% { box-shadow: 0 0 0 0 rgba(63,185,80,0.45); } 70% { box-shadow: 0 0 0 10px rgba(63,185,80,0); } 100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); } }
          @keyframes pulseRingOffline { 0% { box-shadow: 0 0 0 0 rgba(248,81,73,0.4); } 70% { box-shadow: 0 0 0 10px rgba(248,81,73,0); } 100% { box-shadow: 0 0 0 0 rgba(248,81,73,0); } }
          @keyframes rippleAnim { to { transform: scale(3); opacity: 0; } }
          @keyframes orbFloat1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(30px,-20px); } }
          @keyframes orbFloat2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-25px,25px); } }
          @keyframes slideInRight { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
          @keyframes slideOutRight { to { opacity: 0; transform: translateX(24px); } }
          @keyframes spin { to { transform: rotate(360deg); } }

          html, body { background: var(--bg); }
          body {
            font-family: 'Inter', -apple-system, sans-serif;
            color: var(--text);
            margin: 0;
            padding: 20px 16px 60px;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
          }
          body::before, body::after {
            content: ""; position: fixed; width: 480px; height: 480px; border-radius: 50%;
            filter: blur(90px); z-index: -1; pointer-events: none;
          }
          body::before { top: -140px; left: -120px; background: rgba(35,134,54,0.16); animation: orbFloat1 16s ease-in-out infinite; }
          body::after { bottom: -160px; right: -120px; background: rgba(88,166,255,0.14); animation: orbFloat2 18s ease-in-out infinite; }

          main, .topbar, .action-row, .tabs { width: 100%; max-width: 760px; margin: 0 auto; }

          .topbar {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; margin-bottom: 18px; flex-wrap: wrap;
            animation: fadeSlideUp 0.5s ease both;
          }
          .topbar-left { display: flex; align-items: center; gap: 14px; }
          .bot-avatar {
            width: 46px; height: 46px; border-radius: 12px;
            background: linear-gradient(135deg, #1c2129, #0d1117);
            border: 1px solid var(--border);
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; flex-shrink: 0;
          }
          .topbar h1 {
            font-size: 22px; font-weight: 800; margin: 0; line-height: 1.2;
            background: linear-gradient(90deg, #f0f6fc, #58a6ff 75%);
            -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          }
          .topbar-sub { font-size: 12.5px; color: var(--muted); margin-top: 3px; }

          .status-pill {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 700;
            border: 1.5px solid var(--border); background: var(--panel);
            transition: background 0.3s ease, border-color 0.3s ease, color 0.3s ease;
          }
          .status-pill.online { border-color: var(--green-dark); background: var(--green-bg); color: var(--green); }
          .status-pill.offline { border-color: var(--red-dark); background: var(--red-bg); color: var(--red); }
          .status-dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; animation: pulseRing 2s infinite; }
          .status-pill.offline .status-dot { animation: pulseRingOffline 2s infinite; }

          .action-row {
            display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
            margin-bottom: 18px; animation: fadeSlideUp 0.5s ease 0.05s both;
          }
          .action-btn {
            position: relative; overflow: hidden;
            min-height: 50px; border-radius: 12px; font-size: 14px; font-weight: 700;
            cursor: pointer; font-family: inherit; letter-spacing: 0.2px;
            transition: filter 0.2s ease, transform 0.12s ease, box-shadow 0.2s ease, opacity 0.15s ease;
          }
          .action-btn:hover { filter: brightness(1.15); transform: translateY(-2px); }
          .action-btn:active { transform: scale(0.96); opacity: 0.85; }
          .action-start { border: 2px solid var(--green-dark); background: var(--green-bg); color: var(--green); }
          .action-start:hover { box-shadow: 0 0 16px rgba(35,134,54,0.35); }
          .action-stop { border: 2px solid var(--red-dark); background: var(--red-bg); color: var(--red); }
          .action-stop:hover { box-shadow: 0 0 16px rgba(218,54,51,0.35); }
          .action-restart { border: 2px solid var(--accent); background: var(--accent-dim); color: var(--accent); }
          .action-restart:hover { box-shadow: 0 0 16px rgba(88,166,255,0.35); }

          .tabs {
            display: flex; gap: 6px; background: var(--panel); border: 1px solid var(--border);
            border-radius: 12px; padding: 5px; margin-bottom: 18px;
            animation: fadeSlideUp 0.5s ease 0.1s both;
          }
          .tab-btn {
            flex: 1; padding: 10px 8px; border-radius: 9px; border: none;
            background: transparent; color: var(--muted); font-family: inherit;
            font-size: 13px; font-weight: 600; cursor: pointer;
            transition: background 0.2s ease, color 0.2s ease;
          }
          .tab-btn:hover { color: var(--text); }
          .tab-btn.active { background: var(--panel2); color: var(--accent); box-shadow: inset 0 0 0 1px var(--border-hover); }

          .tab-panel { display: none; }
          .tab-panel.active { display: block; animation: fadeSlideUp 0.35s ease both; }

          .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
          .stat-card {
            background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
            padding: 14px 16px; transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
            animation: fadeSlideUp 0.45s ease both;
          }
          .stat-card:hover { transform: translateY(-2px); border-color: var(--border-hover); background: var(--panel2); }
          .stat-card.wide { grid-column: 1 / -1; }
          .stat-dt { font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
          .stat-dd { font-size: 16px; font-weight: 700; color: var(--text); line-height: 1.3; word-break: break-word; }
          .stat-detail { margin: 4px 0 0; font-size: 11px; color: var(--muted2); }

          .settings-section {
            background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
            margin-bottom: 12px; transition: border-color 0.2s ease; overflow: hidden;
          }
          .settings-section:hover { border-color: var(--border-hover); }
          .settings-section > summary {
            list-style: none; cursor: pointer; padding: 16px 20px;
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            font-size: 14.5px; font-weight: 700; color: var(--text);
          }
          .settings-section > summary::-webkit-details-marker { display: none; }
          .settings-section > summary::after { content: "+"; color: var(--muted); font-size: 18px; font-weight: 400; transition: transform 0.2s ease; }
          .settings-section[open] > summary::after { transform: rotate(45deg); }
          .settings-section .section-desc { font-size: 12px; color: var(--muted); margin: -6px 20px 10px; }
          .settings-section .section-body { padding: 0 20px 16px; }

          .field-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--border); }
          .field-row:last-child { border-bottom: none; }
          .field-row.column { flex-direction: column; align-items: stretch; }
          .field-label-wrap { flex: 1; min-width: 0; }
          .field-label { font-size: 13px; color: #c9d1d9; font-weight: 500; display: block; }
          .field-hint { font-size: 11px; color: var(--muted2); margin-top: 2px; }
          .field-input {
            background: var(--bg); border: 1px solid var(--border-hover); border-radius: 8px;
            padding: 8px 12px; color: var(--text); font-size: 13px; font-family: inherit;
            width: 190px; max-width: 55%; transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }
          .field-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
          .field-row.column .field-input { width: 100%; max-width: 100%; margin-top: 8px; }
          textarea.field-input { resize: vertical; min-height: 70px; font-family: 'SF Mono','Fira Code',monospace; font-size: 12px; }
          .field-with-btn { display: flex; gap: 8px; align-items: center; width: 190px; max-width: 55%; }
          .field-row.column .field-with-btn { width: 100%; max-width: 100%; margin-top: 8px; }
          .field-with-btn .field-input { width: 100%; max-width: 100%; }
          .mini-btn {
            flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--muted);
            background: var(--bg); border: 1px solid var(--border-hover); border-radius: 6px;
            padding: 8px 10px; cursor: pointer; font-family: inherit; transition: background 0.2s ease, color 0.2s ease;
          }
          .mini-btn:hover { background: var(--panel2); color: var(--text); }

          .toggle { position: relative; display: inline-block; width: 42px; height: 23px; flex-shrink: 0; }
          .toggle input { opacity: 0; width: 0; height: 0; }
          .toggle-slider { position: absolute; inset: 0; cursor: pointer; background: var(--border); border: 1px solid var(--border-hover); border-radius: 24px; transition: background 0.2s ease, border-color 0.2s ease; }
          .toggle-slider::before { content: ""; position: absolute; height: 15px; width: 15px; left: 3px; top: 50%; transform: translateY(-50%); background: var(--muted); border-radius: 50%; transition: transform 0.2s ease, background 0.2s ease; }
          .toggle input:checked + .toggle-slider { background: var(--green-bg); border-color: var(--green-dark); }
          .toggle input:checked + .toggle-slider::before { transform: translate(19px,-50%); background: var(--green); }

          .action-bar {
            position: sticky; bottom: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
            background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
            padding: 14px 18px; margin-top: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
          }
          .btn-primary { position: relative; overflow: hidden; min-height: 44px; border-radius: 10px; font-size: 13.5px; font-weight: 700; cursor: pointer; padding: 0 18px; font-family: inherit; transition: filter 0.2s ease, transform 0.12s ease, box-shadow 0.2s ease, opacity 0.15s ease; }
          .btn-primary:hover { filter: brightness(1.15); transform: translateY(-1px); }
          .btn-primary:active { opacity: 0.85; transform: scale(0.96); }
          .btn-save { border: 2px solid var(--green-dark); background: var(--green-bg); color: var(--green); }
          .btn-save:hover { box-shadow: 0 0 14px rgba(35,134,54,0.35); }
          .btn-saverestart { border: 2px solid var(--accent); background: var(--accent-dim); color: var(--accent); }
          .btn-saverestart:hover { box-shadow: 0 0 14px rgba(88,166,255,0.3); }
          .btn-download { border: 2px solid var(--border-hover); background: var(--panel2); color: var(--text); }
          .btn-secondary { min-height: 40px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel); color: var(--muted); font-size: 12.5px; font-weight: 600; padding: 0 16px; cursor: pointer; font-family: inherit; transition: background 0.2s ease, color 0.2s ease; }
          .btn-secondary:hover { background: var(--panel2); color: var(--text); }
          #save-status { font-size: 12.5px; font-weight: 600; opacity: 0; transition: opacity 0.3s ease; }
          #save-status.ok { color: var(--green); }
          #save-status.err { color: var(--red); }

          .ripple { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.35); transform: scale(0); animation: rippleAnim 0.5s ease-out; pointer-events: none; }

          .log-card { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
          .log-card-header { background: var(--panel); border-bottom: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; gap: 8px; }
          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red { background: #ff5f57; } .dot-yellow { background: #ffbd2e; } .dot-green { background: #28c840; }
          .log-card-title { font-size: 12px; font-weight: 500; color: var(--muted2); margin-left: 4px; }
          .log-body { padding: 14px 16px; height: 320px; overflow-y: auto; font-family: 'SF Mono','Fira Code',monospace; font-size: 12.5px; line-height: 1.7; }
          .log-entry { display: block; padding: 1px 0; white-space: pre-wrap; word-break: break-all; animation: fadeIn 0.2s ease both; }
          .log-entry.error { color: #ff7b72; } .log-entry.warn { color: var(--yellow); } .log-entry.success { color: var(--green); }
          .log-entry.control { color: var(--accent); } .log-entry.default { color: var(--muted); }
          .empty-state { text-align: center; padding: 40px 20px; color: var(--muted2); font-size: 13px; }
          .console-wrap { position: relative; }
          .console-row { display: flex; align-items: center; border-top: 1px solid var(--border); background: var(--bg); padding: 10px 14px; gap: 10px; }
          .console-prompt { font-family: 'SF Mono','Fira Code',monospace; font-size: 13px; color: var(--green); font-weight: 700; flex-shrink: 0; user-select: none; }
          .console-input { flex: 1; background: transparent; border: none; outline: none; font-family: 'SF Mono','Fira Code',monospace; font-size: 12.5px; color: var(--text); caret-color: var(--green); }
          .console-input::placeholder { color: var(--muted2); }
          .console-send { background: var(--green-bg); border: 1px solid var(--green-dark); color: var(--green); font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; flex-shrink: 0; position: relative; overflow: hidden; transition: background 0.2s ease, transform 0.12s ease; }
          .console-send:hover { background: #122d1a; } .console-send:active { transform: scale(0.94); }
          .cmd-suggestions { display: none; position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; background: var(--panel); border: 1px solid var(--border-hover); border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 10; }
          .cmd-suggestions.visible { display: block; }
          .cmd-item { display: flex; align-items: baseline; gap: 12px; padding: 9px 16px; cursor: pointer; border-bottom: 1px solid var(--border); }
          .cmd-item:last-child { border-bottom: none; }
          .cmd-item:hover, .cmd-item.active { background: var(--panel2); }
          .cmd-name { font-family: 'SF Mono','Fira Code',monospace; font-size: 12.5px; font-weight: 700; color: var(--green); min-width: 90px; }
          .cmd-desc { font-size: 12px; color: var(--muted2); }
          .refresh-bar { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 10px; font-size: 12px; color: var(--muted2); }
          .refresh-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); animation: fadeIn 2s infinite alternate; }

          .raw-notice { background: var(--panel2); border: 1px solid var(--border-hover); border-left: 3px solid var(--yellow); border-radius: 8px; padding: 12px 16px; font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
          .raw-notice strong { color: #c9d1d9; }
          #raw-editor { width: 100%; min-height: 380px; background: var(--bg); border: 1px solid var(--border-hover); border-radius: 10px; padding: 14px; color: var(--text); font-family: 'SF Mono','Fira Code',monospace; font-size: 12.5px; line-height: 1.6; resize: vertical; }
          #raw-editor:focus { outline: none; border-color: var(--accent); }
          .raw-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
          input[type=file].hidden-file { display: none; }

          .toast-stack { position: fixed; bottom: 18px; right: 18px; display: flex; flex-direction: column; gap: 10px; z-index: 999; max-width: calc(100vw - 32px); }
          .toast { min-width: 220px; max-width: 320px; padding: 12px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; color: var(--text); background: var(--panel); border: 1px solid var(--border-hover); box-shadow: 0 8px 24px rgba(0,0,0,0.5); animation: slideInRight 0.3s ease both; }
          .toast.ok { border-left: 3px solid var(--green); }
          .toast.err { border-left: 3px solid var(--red); }
          .toast.info { border-left: 3px solid var(--accent); }
          .toast.closing { animation: slideOutRight 0.25s ease forwards; }

          .modal-overlay { position: fixed; inset: 0; background: rgba(1,4,9,0.7); display: none; align-items: center; justify-content: center; z-index: 1000; padding: 20px; animation: fadeIn 0.2s ease both; }
          .modal-overlay.visible { display: flex; }
          .modal-box { background: var(--panel); border: 1px solid var(--border-hover); border-radius: 14px; padding: 22px; max-width: 360px; width: 100%; animation: popIn 0.25s ease both; }
          .modal-box h3 { margin: 0 0 8px; font-size: 16px; color: var(--text); }
          .modal-box p { margin: 0 0 18px; font-size: 13px; color: var(--muted); line-height: 1.5; }
          .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

          footer { margin-top: 26px; text-align: center; }
          .credit-cycle { position: relative; height: 18px; margin-top: 12px; display: flex; align-items: center; justify-content: center; }
          .credit-text { position: absolute; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; white-space: nowrap; opacity: 0; background: linear-gradient(90deg, var(--accent), var(--green)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: creditCycle 6s ease-in-out infinite; }
          .credit-text.credit-1 { animation-delay: 0s; } .credit-text.credit-2 { animation-delay: 3s; }
          @keyframes creditCycle { 0% { opacity: 0; transform: translateY(8px) scale(0.92); } 8% { opacity: 1; transform: translateY(0) scale(1); } 42% { opacity: 1; transform: translateY(0) scale(1); } 50% { opacity: 0; transform: translateY(-8px) scale(0.92); } 100% { opacity: 0; transform: translateY(8px) scale(0.92); } }
          footer p { font-size: 12px; color: #484f58; margin: 0; }

          @media (min-width: 640px) { .stat-grid { grid-template-columns: 1fr 1fr 1fr; } }
        </style>
      </head>
      <body>
        <div id="toast-stack" class="toast-stack"></div>
        <div id="modal-overlay" class="modal-overlay">
          <div class="modal-box">
            <h3 id="modal-title">Are you sure?</h3>
            <p id="modal-message">This action cannot be undone.</p>
            <div class="modal-actions">
              <button class="btn-secondary" onclick="closeModal()">Cancel</button>
              <button id="modal-confirm-btn" class="btn-primary action-stop">Confirm</button>
            </div>
          </div>
        </div>

        <div class="topbar">
          <div class="topbar-left">
            <div class="bot-avatar">&#129302;</div>
            <div>
              <h1>${config.name}</h1>
              <div class="topbar-sub">Minecraft AFK bot &middot; full control panel</div>
            </div>
          </div>
          <div id="status-pill" class="status-pill offline">
            <span id="status-dot" class="status-dot"></span>
            <span id="status-pill-text">Connecting&hellip;</span>
          </div>
        </div>

        <div class="action-row">
          <button id="start-btn" class="action-btn action-start" onclick="startBot(event)">&#9654; Start</button>
          <button id="stop-btn" class="action-btn action-stop" onclick="confirmStop(event)">&#9632; Stop</button>
          <button id="restart-btn" class="action-btn action-restart" onclick="confirmRestart(event)">&#8635; Restart</button>
        </div>

        <nav class="tabs">
          <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview', this, event)">Overview</button>
          <button class="tab-btn" data-tab="settings" onclick="switchTab('settings', this, event)">Settings</button>
          <button class="tab-btn" data-tab="console" onclick="switchTab('console', this, event)">Console</button>
          <button class="tab-btn" data-tab="raw" onclick="switchTab('raw', this, event)">Raw JSON</button>
        </nav>

        <main>
          <section id="tab-overview" class="tab-panel active">
            <div class="stat-grid">
              <div class="stat-card wide">
                <div class="stat-dt">Uptime</div>
                <div class="stat-dd" id="uptime-text">&mdash;</div>
                <p class="stat-detail">Time since the process last connected</p>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Coordinates</div>
                <div class="stat-dd" id="coords-text">Searching&hellip;</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Health / Food</div>
                <div class="stat-dd" id="health-text">&mdash;</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Server address</div>
                <div class="stat-dd" id="server-address-text">${config.server.ip}:${config.server.port}</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Bot account</div>
                <div class="stat-dd" id="account-text">${config["bot-account"].username}</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">MC version</div>
                <div class="stat-dd" id="version-text">${config.server.version || "auto"}</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Reconnect attempts</div>
                <div class="stat-dd" id="reconnects-text">0</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Memory usage</div>
                <div class="stat-dd" id="memory-text">&mdash;</div>
              </div>
              <div class="stat-card">
                <div class="stat-dt">Errors logged</div>
                <div class="stat-dd" id="errors-text">0</div>
              </div>
            </div>
            <div class="raw-actions">
              <a href="/logs" class="btn-secondary" onclick="playClick()">View classic logs page</a>
              <a href="/tutorial" class="btn-secondary" onclick="playClick()">Setup guide</a>
            </div>
          </section>

          <section id="tab-settings" class="tab-panel">
            <div class="raw-notice">
              <strong>Note:</strong> Server, account and version changes need a <strong>restart</strong> to
              take effect. Save first, then restart if needed.
            </div>

            <details class="settings-section" open>
              <summary>&#9881;&#65039; General</summary>
              <div class="section-body">
                <div class="field-row">
                  <div class="field-label-wrap"><span class="field-label">Bot name</span><div class="field-hint">Shown in the panel title &amp; Discord embeds</div></div>
                  <input id="f-name" class="field-input" type="text">
                </div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128100; Account</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Username</span></div><input id="f-username" class="field-input" type="text"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Password</span></div>
                  <div class="field-with-btn"><input id="f-password" class="field-input" type="password"><button type="button" class="mini-btn" onclick="togglePassword('f-password', this)">Show</button></div>
                </div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Auth type</span><div class="field-hint">offline / mojang / microsoft</div></div><input id="f-authtype" class="field-input" type="text"></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#127760; Server</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Server IP / hostname</span></div><input id="f-ip" class="field-input" type="text" placeholder="play.example.com"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Port</span></div><input id="f-port" class="field-input" type="number" min="1" max="65535"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Minecraft version</span><div class="field-hint">Leave blank to auto-detect</div></div><input id="f-version" class="field-input" type="text" placeholder="1.21.11"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Try creative mode</span></div><label class="toggle"><input id="f-creative" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128205; Spawn position</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Enabled</span></div><label class="toggle"><input id="f-pos-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">X / Y / Z</span></div>
                  <div class="field-with-btn">
                    <input id="f-pos-x" class="field-input" type="number" style="width:33%">
                    <input id="f-pos-y" class="field-input" type="number" style="width:33%">
                    <input id="f-pos-z" class="field-input" type="number" style="width:33%">
                  </div>
                </div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128274; Auto-auth</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Enabled</span></div><label class="toggle"><input id="f-autoauth-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Login password</span></div>
                  <div class="field-with-btn"><input id="f-autoauth-password" class="field-input" type="password"><button type="button" class="mini-btn" onclick="togglePassword('f-autoauth-password', this)">Show</button></div>
                </div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#9200; Anti-AFK &amp; reconnect</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Anti-AFK enabled</span></div><label class="toggle"><input id="f-antiafk-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Sneak while idle</span></div><label class="toggle"><input id="f-antiafk-sneak" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Auto-reconnect</span></div><label class="toggle"><input id="f-reconnect-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Reconnect delay (ms)</span></div><input id="f-reconnect-delay" class="field-input" type="number" min="0"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Max reconnect delay (ms)</span></div><input id="f-reconnect-maxdelay" class="field-input" type="number" min="0"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Log to console</span></div><label class="toggle"><input id="f-chatlog" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128694; Movement</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Movement enabled</span></div><label class="toggle"><input id="f-move-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Circle-walk enabled</span></div><label class="toggle"><input id="f-circle-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Circle radius</span></div><input id="f-circle-radius" class="field-input" type="number" min="1"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Circle speed (ms/step)</span></div><input id="f-circle-speed" class="field-input" type="number" min="100"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Look-around enabled</span></div><label class="toggle"><input id="f-look-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Look-around interval (ms)</span></div><input id="f-look-interval" class="field-input" type="number" min="500"></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Random jump enabled</span></div><label class="toggle"><input id="f-jump-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Random jump interval (ms)</span></div><input id="f-jump-interval" class="field-input" type="number" min="1000"></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#129513; Modules</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Avoid mobs</span></div><label class="toggle"><input id="f-mod-avoidmobs" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Combat module</span></div><label class="toggle"><input id="f-mod-combat" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Beds module</span></div><label class="toggle"><input id="f-mod-beds" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Chat responder</span></div><label class="toggle"><input id="f-mod-chat" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Console commands</span></div><label class="toggle"><input id="f-mod-console" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#9876;&#65039; Combat &amp; survival</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Attack hostile mobs</span></div><label class="toggle"><input id="f-combat-attack" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Auto-eat when hungry</span></div><label class="toggle"><input id="f-combat-autoeat" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128719; Beds</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Pick up bed at day</span></div><label class="toggle"><input id="f-beds-pickup" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Place bed &amp; sleep at night</span></div><label class="toggle"><input id="f-beds-place" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128172; Chat</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Respond to greetings / !tp</span></div><label class="toggle"><input id="f-chat-respond" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Auto chat messages</span></div><label class="toggle"><input id="f-chatmsg-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Repeat messages</span></div><label class="toggle"><input id="f-chatmsg-repeat" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Repeat delay (ms)</span></div><input id="f-chatmsg-delay" class="field-input" type="number" min="1000"></div>
                <div class="field-row column"><div class="field-label-wrap"><span class="field-label">Messages</span><div class="field-hint">One message per line</div></div><textarea id="f-chatmsg-messages" class="field-input"></textarea></div>
              </div>
            </details>

            <details class="settings-section">
              <summary>&#128225; Discord webhook</summary>
              <div class="section-body">
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Enabled</span></div><label class="toggle"><input id="f-discord-enabled" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row column"><div class="field-label-wrap"><span class="field-label">Webhook URL</span></div>
                  <div class="field-with-btn"><input id="f-discord-webhook" class="field-input" type="password" placeholder="https://discord.com/api/webhooks/..."><button type="button" class="mini-btn" onclick="togglePassword('f-discord-webhook', this)">Show</button></div>
                </div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Notify on connect</span></div><label class="toggle"><input id="f-discord-connect" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Notify on disconnect</span></div><label class="toggle"><input id="f-discord-disconnect" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
                <div class="field-row"><div class="field-label-wrap"><span class="field-label">Notify on chat messages</span></div><label class="toggle"><input id="f-discord-chat" type="checkbox" onchange="playToggle()"><span class="toggle-slider"></span></label></div>
              </div>
            </details>

            <div class="action-bar">
              <button id="btn-save" class="btn-primary btn-save" onclick="saveSettings(event, false)">&#128190; Save Settings</button>
              <button id="btn-saverestart" class="btn-primary btn-saverestart" onclick="saveSettings(event, true)">&#128190;&#8635; Save &amp; Restart</button>
              <span id="save-status"></span>
            </div>
          </section>

          <section id="tab-console" class="tab-panel">
            <div class="log-card">
              <div class="log-card-header"><span class="dot dot-red"></span><span class="dot dot-yellow"></span><span class="dot dot-green"></span><span class="log-card-title">bot.log</span></div>
              <div class="log-body" id="log-body"><div class="empty-state">Loading logs&hellip;</div></div>
              <div class="console-wrap">
                <div class="cmd-suggestions" id="cmd-suggestions"></div>
                <div class="console-row">
                  <span class="console-prompt">&gt;</span>
                  <input id="console-input" class="console-input" type="text" placeholder="Type / for commands, or any message&hellip;" autocomplete="off" spellcheck="false">
                  <button id="console-send" class="console-send">Send</button>
                </div>
              </div>
            </div>
            <div class="refresh-bar"><span class="refresh-dot"></span><span id="refresh-label">Auto-refreshing every 4 seconds</span></div>
          </section>

          <section id="tab-raw" class="tab-panel">
            <div class="raw-notice">
              <strong>Full file control:</strong> this edits the entire <code>settings.json</code> object directly.
              Saving here <strong>replaces the whole file</strong> (not a merge) &mdash; a backup of the previous
              version is kept as <code>settings.backup.json</code> automatically.
            </div>
            <textarea id="raw-editor" spellcheck="false"></textarea>
            <div class="raw-actions">
              <button class="btn-secondary" onclick="formatRaw()">&#10024; Format</button>
              <button class="btn-secondary" onclick="reloadRaw()">&#8635; Reload from server</button>
              <button class="btn-secondary btn-download" onclick="downloadRaw()">&#11015;&#65039; Download settings.json</button>
              <label class="btn-secondary" style="cursor:pointer;">&#11014;&#65039; Upload file<input type="file" accept="application/json" class="hidden-file" onchange="uploadRaw(event)"></label>
              <button id="btn-save-raw" class="btn-primary btn-save" onclick="saveRaw(event)">&#128190; Save Raw JSON</button>
            </div>
          </section>
        </main>

        <footer>
          <p>Status updates every 5 seconds</p>
          <div class="credit-cycle">
            <span class="credit-text credit-1">MADE BY MAYANK_KEER.</span>
            <span class="credit-text credit-2">MADE BY ITS_MK_PLAYS.</span>
          </div>
        </footer>

        <script>
          // ============================================================
          // Sound effects (generated in-browser, no audio files needed)
          // ============================================================
          var audioCtx = null;
          function ctx() { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
          function tone(freq1, freq2, dur, vol, type) {
            try {
              var c = ctx();
              var osc = c.createOscillator();
              var gain = c.createGain();
              osc.type = type || 'sine';
              osc.frequency.setValueAtTime(freq1, c.currentTime);
              osc.frequency.exponentialRampToValueAtTime(freq2, c.currentTime + dur);
              gain.gain.setValueAtTime(vol, c.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
              osc.connect(gain);
              gain.connect(c.destination);
              osc.start();
              osc.stop(c.currentTime + dur);
            } catch (e) { /* audio not supported */ }
          }
          function playClick() { tone(660, 320, 0.1, 0.12, 'sine'); }
          function playToggle() { tone(500, 700, 0.06, 0.08, 'sine'); }
          function playSuccess() {
            try {
              var c = ctx();
              [523.25, 783.99].forEach(function(f, i) {
                var osc = c.createOscillator(); var gain = c.createGain();
                osc.type = 'sine'; osc.frequency.value = f;
                var t = c.currentTime + i * 0.09;
                gain.gain.setValueAtTime(0.001, t);
                gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
                osc.connect(gain); gain.connect(c.destination);
                osc.start(t); osc.stop(t + 0.2);
              });
            } catch (e) { /* no-op */ }
          }
          function playError() { tone(220, 110, 0.22, 0.14, 'sawtooth'); }

          // ============================================================
          // Ripple + toast + modal helpers
          // ============================================================
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

          function showToast(msg, type) {
            var stack = document.getElementById('toast-stack');
            var t = document.createElement('div');
            t.className = 'toast ' + (type || 'info');
            t.textContent = msg;
            stack.appendChild(t);
            if (type === 'ok') playSuccess(); else if (type === 'err') playError();
            setTimeout(function() {
              t.classList.add('closing');
              setTimeout(function() { t.remove(); }, 250);
            }, 4000);
          }

          var modalConfirmCb = null;
          function openModal(title, message, onConfirm) {
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').textContent = message;
            modalConfirmCb = onConfirm;
            document.getElementById('modal-overlay').classList.add('visible');
          }
          function closeModal() {
            document.getElementById('modal-overlay').classList.remove('visible');
            modalConfirmCb = null;
          }
          document.getElementById('modal-confirm-btn').addEventListener('click', function() {
            playClick();
            var cb = modalConfirmCb;
            closeModal();
            if (cb) cb();
          });
          document.getElementById('modal-overlay').addEventListener('click', function(e) {
            if (e.target === this) closeModal();
          });

          function togglePassword(id, btn) {
            var el = document.getElementById(id);
            if (el.type === 'password') { el.type = 'text'; btn.textContent = 'Hide'; }
            else { el.type = 'password'; btn.textContent = 'Show'; }
            playClick();
          }

          // ============================================================
          // Tabs
          // ============================================================
          function switchTab(name, btn, evt) {
            playClick();
            document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
            btn.classList.add('active');
            document.getElementById('tab-' + name).classList.add('active');
            if (name === 'settings' && !window.__settingsLoaded) loadSettings();
            if (name === 'console' && !window.__consoleStarted) startConsole();
            if (name === 'raw' && !window.__rawLoaded) reloadRaw();
          }

          // ============================================================
          // Start / Stop / Restart
          // ============================================================
          async function startBot(evt) {
            if (evt) spawnRipple(document.getElementById('start-btn'), evt);
            playClick();
            try {
              var r = await fetch('/start', { method: 'POST' });
              var data = await r.json();
              showToast(data.success ? 'Bot started!' : (data.msg || 'Already running'), data.success ? 'ok' : 'info');
            } catch (e) { showToast('Network error starting bot.', 'err'); }
            updateStatus();
          }

          function confirmStop(evt) {
            if (evt) spawnRipple(document.getElementById('stop-btn'), evt);
            playClick();
            openModal('Stop the bot?', 'This disconnects the bot from the server until you start it again.', doStop);
          }
          async function doStop() {
            try {
              var r = await fetch('/stop', { method: 'POST' });
              var data = await r.json();
              showToast(data.success ? 'Bot stopped.' : (data.msg || 'Already stopped'), data.success ? 'ok' : 'info');
            } catch (e) { showToast('Network error stopping bot.', 'err'); }
            updateStatus();
          }

          function confirmRestart(evt) {
            if (evt) spawnRipple(document.getElementById('restart-btn'), evt);
            playClick();
            openModal('Restart the bot?', 'The bot will disconnect and reconnect with the latest saved settings.', doRestart);
          }
          async function doRestart() {
            try {
              var r = await fetch('/api/restart', { method: 'POST' });
              var data = await r.json();
              showToast(data.msg || 'Restarting...', !!data.success ? 'ok' : 'err');
            } catch (e) { showToast('Network error restarting bot.', 'err'); }
            updateStatus();
          }

          // ============================================================
          // Overview status polling
          // ============================================================
          function formatUptime(s) {
            var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
            if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
            if (m > 0) return m + 'm ' + sec + 's';
            return sec + ' seconds';
          }

          async function updateStatus() {
            try {
              var r = await fetch('/health');
              var data = await r.json();
              var online = data.status === 'connected';

              var pill = document.getElementById('status-pill');
              var text = document.getElementById('status-pill-text');
              pill.className = 'status-pill ' + (online ? 'online' : 'offline');
              text.textContent = online ? 'Connected' : 'Disconnected';

              document.getElementById('uptime-text').textContent = formatUptime(data.uptime);
              if (data.coords) {
                var x = Math.floor(data.coords.x), y = Math.floor(data.coords.y), z = Math.floor(data.coords.z);
                document.getElementById('coords-text').textContent = 'X ' + x + ', Y ' + y + ', Z ' + z;
              } else {
                document.getElementById('coords-text').textContent = 'Searching\\u2026';
              }
              var healthEl = document.getElementById('health-text');
              if (data.health != null || data.food != null) {
                healthEl.textContent = (data.health != null ? Math.round(data.health) : '?') + ' HP / ' + (data.food != null ? Math.round(data.food) : '?') + ' food';
              } else {
                healthEl.textContent = '\\u2014';
              }
              if (data.serverIp) document.getElementById('server-address-text').textContent = data.serverIp + ':' + data.serverPort;
              if (data.botUsername) document.getElementById('account-text').textContent = data.botUsername;
              document.getElementById('version-text').textContent = data.mcVersion || data.serverVersion || 'auto';
              document.getElementById('reconnects-text').textContent = data.reconnectAttempts;
              document.getElementById('errors-text').textContent = data.errorCount || 0;
              if (typeof data.memoryUsage === 'number') document.getElementById('memory-text').textContent = data.memoryUsage.toFixed(1) + ' MB';
            } catch (e) {
              document.getElementById('status-pill').className = 'status-pill offline';
              document.getElementById('status-pill-text').textContent = 'Unreachable';
            }
          }
          setInterval(updateStatus, 5000);
          updateStatus();

          // ============================================================
          // Settings tab (field-map driven, same schema as settings.json)
          // ============================================================
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
            for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = cur[parts[i]]; }
            return cur;
          }
          function setPath(obj, parts, value) {
            var cur = obj;
            for (var i = 0; i < parts.length - 1; i++) {
              var key = parts[i];
              if (typeof cur[key] !== 'object' || cur[key] === null || Array.isArray(cur[key])) cur[key] = {};
              cur = cur[key];
            }
            cur[parts[parts.length - 1]] = value;
          }
          function populateForm(settings) {
            FIELD_MAP.forEach(function(f) {
              var el = document.getElementById(f.id);
              if (!el) return;
              var val = getPath(settings, f.path);
              if (f.type === 'checkbox') el.checked = !!val;
              else if (f.type === 'lines') el.value = Array.isArray(val) ? val.join('\\n') : '';
              else el.value = (val === undefined || val === null) ? '' : val;
            });
          }
          function collectSettings() {
            var out = {};
            FIELD_MAP.forEach(function(f) {
              var el = document.getElementById(f.id);
              if (!el) return;
              var val;
              if (f.type === 'checkbox') val = el.checked;
              else if (f.type === 'number') val = el.value === '' ? 0 : Number(el.value);
              else if (f.type === 'lines') val = el.value.split('\\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
              else val = el.value;
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
            window.__settingsLoaded = true;
            try {
              var r = await fetch('/api/settings');
              var data = await r.json();
              if (data.success) populateForm(data.settings);
              else showToast('Could not load current settings.', 'err');
            } catch (e) { showToast('Network error loading settings.', 'err'); }
          }
          async function saveSettings(evt, thenRestart) {
            if (evt) spawnRipple(evt.currentTarget, evt);
            playClick();
            var payload = collectSettings();
            try {
              var r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
              var data = await r.json();
              showStatus(data.msg || (data.success ? 'Saved!' : 'Failed to save.'), !!data.success);
              showToast(data.success ? 'Settings saved.' : (data.msg || 'Save failed.'), data.success ? 'ok' : 'err');
              if (data.success && thenRestart) doRestart();
            } catch (e) { showStatus('Network error while saving.', false); showToast('Network error while saving.', 'err'); }
          }

          // ============================================================
          // Console tab
          // ============================================================
          var COMMANDS = [
            { name: '/help', desc: 'Show all available commands' },
            { name: '/pos', desc: "Show bot's current coordinates" },
            { name: '/status', desc: 'Show connection status & uptime' },
            { name: '/list', desc: 'List players on the server' },
            { name: '/say', desc: 'Send a chat message in-game' }
          ];

          function renderLogs(logs) {
            var body = document.getElementById('log-body');
            var atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
            if (!logs || !logs.length) { body.innerHTML = '<div class="empty-state">No log entries yet. Start the bot to see output.</div>'; return; }
            body.innerHTML = logs.map(function(l) {
              var lower = l.toLowerCase();
              var cls = 'default';
              if (lower.indexOf('error') !== -1 || lower.indexOf('fail') !== -1) cls = 'error';
              else if (lower.indexOf('warn') !== -1) cls = 'warn';
              else if (lower.indexOf('[control]') !== -1) cls = 'control';
              else if (lower.indexOf('connect') !== -1 || lower.indexOf('join') !== -1 || lower.indexOf('spawn') !== -1) cls = 'success';
              var div = document.createElement('div');
              div.textContent = l;
              return '<span class="log-entry ' + cls + '">' + div.innerHTML + '</span>';
            }).join('');
            if (atBottom) body.scrollTop = body.scrollHeight;
          }

          function startConsole() {
            window.__consoleStarted = true;
            var input = document.getElementById('console-input');
            var sendBtn = document.getElementById('console-send');
            var sugBox = document.getElementById('cmd-suggestions');
            var label = document.getElementById('refresh-label');
            var typing = false;
            var activeIdx = -1;
            var pollTimer = null;

            async function poll() {
              try {
                var r = await fetch('/api/logs');
                var data = await r.json();
                if (!typing) renderLogs(data.logs || []);
              } catch (e) { /* ignore transient errors */ }
              pollTimer = setTimeout(poll, 4000);
            }
            poll();

            function hideSuggestions() { sugBox.classList.remove('visible'); sugBox.innerHTML = ''; activeIdx = -1; }
            function setActive(idx) {
              var items = sugBox.querySelectorAll('.cmd-item');
              items.forEach(function(el, i) { el.classList.toggle('active', i === idx); });
              activeIdx = idx;
            }
            function showSuggestions(val) {
              var query = val.toLowerCase();
              var matches = COMMANDS.filter(function(c) { return c.name.indexOf(query) === 0; });
              if (!matches.length) { hideSuggestions(); return; }
              sugBox.innerHTML = matches.map(function(c) {
                return '<div class="cmd-item" data-cmd="' + c.name + '"><span class="cmd-name">' + c.name + '</span><span class="cmd-desc">' + c.desc + '</span></div>';
              }).join('');
              sugBox.querySelectorAll('.cmd-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                  e.preventDefault(); playClick();
                  input.value = el.dataset.cmd + ' ';
                  hideSuggestions(); input.focus();
                });
              });
              activeIdx = -1;
              sugBox.classList.add('visible');
            }
            input.addEventListener('input', function() {
              if (input.value.indexOf('/') === 0) showSuggestions(input.value); else hideSuggestions();
            });
            input.addEventListener('keydown', function(e) {
              var items = sugBox.querySelectorAll('.cmd-item');
              if (sugBox.classList.contains('visible') && items.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); return; }
                if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) {
                  e.preventDefault();
                  var chosen = items[activeIdx >= 0 ? activeIdx : 0];
                  input.value = chosen.dataset.cmd + ' ';
                  hideSuggestions();
                  return;
                }
                if (e.key === 'Escape') { hideSuggestions(); return; }
              }
              if (e.key === 'Enter') sendCommand();
            });
            function sendCommand() {
              var cmd = input.value.trim();
              if (!cmd) return;
              hideSuggestions();
              input.value = '';
              sendBtn.disabled = true;
              fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) })
                .then(function(r) { return r.json(); })
                .then(function(data) { if (data.msg && !data.success) showToast(data.msg, 'err'); })
                .catch(function() { showToast('Failed to send command.', 'err'); })
                .finally(function() { sendBtn.disabled = false; input.focus(); });
            }
            sendBtn.addEventListener('click', function(e) { playClick(); spawnRipple(sendBtn, e); sendCommand(); });
            input.addEventListener('focus', function() { typing = true; label.textContent = 'Auto-refresh paused while typing'; });
            input.addEventListener('blur', function() {
              setTimeout(function() { hideSuggestions(); typing = false; label.textContent = 'Auto-refreshing every 4 seconds'; }, 150);
            });
          }

          // ============================================================
          // Raw JSON tab (full file control)
          // ============================================================
          async function reloadRaw() {
            window.__rawLoaded = true;
            try {
              var r = await fetch('/api/settings');
              var data = await r.json();
              if (data.success) {
                document.getElementById('raw-editor').value = JSON.stringify(data.settings, null, 2);
                showToast('Loaded current settings.json.', 'info');
              } else {
                showToast('Could not load settings.', 'err');
              }
            } catch (e) { showToast('Network error loading raw settings.', 'err'); }
          }
          function formatRaw() {
            playClick();
            var el = document.getElementById('raw-editor');
            try {
              var parsed = JSON.parse(el.value);
              el.value = JSON.stringify(parsed, null, 2);
              showToast('Formatted.', 'ok');
            } catch (e) { showToast('Invalid JSON: ' + e.message, 'err'); }
          }
          function downloadRaw() {
            playClick();
            window.location.href = '/api/settings/export';
          }
          function uploadRaw(evt) {
            playClick();
            var file = evt.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function() {
              try {
                var parsed = JSON.parse(reader.result);
                document.getElementById('raw-editor').value = JSON.stringify(parsed, null, 2);
                showToast('File loaded into the editor. Click "Save Raw JSON" to apply it.', 'info');
              } catch (e) { showToast('That file is not valid JSON.', 'err'); }
            };
            reader.readAsText(file);
            evt.target.value = '';
          }
          async function saveRaw(evt) {
            if (evt) spawnRipple(evt.currentTarget, evt);
            playClick();
            var el = document.getElementById('raw-editor');
            var parsed;
            try {
              parsed = JSON.parse(el.value);
            } catch (e) {
              showToast('Invalid JSON: ' + e.message, 'err');
              return;
            }
            openModal('Overwrite settings.json?', 'This replaces the entire settings file with what is in the editor. A backup will be kept automatically.', async function() {
              try {
                var r = await fetch('/api/settings/raw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
                var data = await r.json();
                showToast(data.msg || (data.success ? 'Saved!' : 'Failed to save.'), data.success ? 'ok' : 'err');
                if (data.success) { window.__settingsLoaded = false; }
              } catch (e) { showToast('Network error while saving raw JSON.', 'err'); }
            });
          }
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

app.post("/start", (req, res) => {
  if (botRunning) return res.json({ success: false, msg: "Already running" });

  botRunning = true;
  createBot();
  addLog("[Control] Bot started");

  res.json({ success: true });
});

app.post("/stop", (req, res) => {
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

app.post("/command", express.json(), (req, res) => {
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
app.get("/api/settings", (req, res) => {
  res.json({ success: true, settings: config });
});

app.post("/api/settings", express.json(), (req, res) => {
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

app.post("/api/restart", (req, res) => {
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
// LOGS API - JSON feed for the control panel's Console tab
// (keeps /logs HTML page working too; this just avoids full reloads)
// ============================================================
app.get("/api/logs", (req, res) => {
  res.json({ success: true, logs: getLogs() });
});

// ============================================================
// SETTINGS EXPORT - download settings.json directly from the panel
// ============================================================
app.get("/api/settings/export", (req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="settings.json"');
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(config, null, 2));
});

// ============================================================
// SETTINGS RAW - full-file control: replace the entire settings
// object (not a merge), used by the Raw JSON tab. Keeps a backup
// of the previous file before overwriting.
// ============================================================
app.post("/api/settings/raw", express.json({ limit: "1mb" }), (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.json({ success: false, msg: "Invalid settings payload." });
    }

    // Backup the current file before overwriting it
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        fs.copyFileSync(
          SETTINGS_PATH,
          path.join(__dirname, "settings.backup.json"),
        );
      }
    } catch (backupErr) {
      addLog(`[Settings] Warning: could not write backup file: ${backupErr.message}`);
    }

    // Full replace: clear every existing key, then take on the incoming object
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, incoming);

    const saved = saveSettingsToDisk();
    addLog("[Settings] Full settings.json overwrite from Raw JSON panel");

    res.json({
      success: saved,
      msg: saved
        ? "settings.json fully overwritten (backup saved as settings.backup.json)."
        : "Applied in memory, but failed to write settings.json to disk.",
    });
  } catch (e) {
    addLog(`[Settings] Error in raw settings overwrite: ${e.message}`);
    res.json({ success: false, msg: e.message });
  }
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

createBot();
