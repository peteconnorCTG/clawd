// Clawd — main process: transparent always-on-top pet window + Claude Agent SDK bridge.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const W = 340;
const H = 620;
const SMOKE = process.argv.includes("--smoke");
const SMOKE_OUT =
  process.argv.find((a) => a.startsWith("--smoke-out="))?.slice("--smoke-out=".length) ||
  path.join(os.tmpdir(), "clawd-smoke.png");
// --probe="<text>": drive one real agent turn through the full bridge + UI, screenshot, exit.
const PROBE = process.argv.find((a) => a.startsWith("--probe="))?.slice("--probe=".length) || null;

const PERSONA = `
You are Clawd, a small pixel-art Claude critter living on your human's macOS desktop.
You are a real agent: you run commands, read and write files, and finish tasks autonomously.
Style: short, warm, playful; lead with what you did. Use absolute paths when naming files.
Safety: before anything destructive or hard to reverse (deleting, overwriting user data,
sending anything anywhere), state what you're about to do and ask in chat first.
`.trim();

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let dragging = null; // {offX, offY, timer} — suppresses interactive toggles mid-drag

// ---------- agent bridge ----------
let sdk = null;
let sessionId = null;
let busy = false;
let queue = [];
let activeAbort = null;
const sessionFile = () => path.join(app.getPath("userData"), "session.json");

function loadSession() {
  try {
    sessionId = JSON.parse(fs.readFileSync(sessionFile(), "utf8")).sessionId || null;
  } catch {
    sessionId = null;
  }
}
function saveSession() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(sessionFile(), JSON.stringify({ sessionId }));
  } catch {}
}
function clearSession() {
  sessionId = null;
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {}
}

function ui(payload) {
  if (win && !win.isDestroyed()) win.webContents.send("agent:event", payload);
}

function toolSummary(name, input = {}) {
  const trunc = (s, n = 64) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
  const base = (p) => (p ? path.basename(p) : "");
  switch (name) {
    case "Bash":
      return `Running: ${trunc(input.description || input.command)}`;
    case "Read":
      return `Reading ${base(input.file_path)}`;
    case "Write":
      return `Writing ${base(input.file_path)}`;
    case "Edit":
      return `Editing ${base(input.file_path)}`;
    case "Glob":
    case "Grep":
      return `Searching files: ${trunc(input.pattern, 40)}`;
    case "WebSearch":
      return `Searching: ${trunc(input.query, 48)}`;
    case "WebFetch":
      return `Fetching ${trunc(input.url, 48)}`;
    case "Task":
      return `Delegating: ${trunc(input.description, 48)}`;
    case "TodoWrite":
      return "Planning steps";
    default:
      return name;
  }
}

async function runTurn(text) {
  sdk ??= await import("@anthropic-ai/claude-agent-sdk");
  activeAbort = new AbortController();
  const options = (resume) => ({
    systemPrompt: { type: "preset", preset: "claude_code", append: PERSONA },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    settingSources: [],
    cwd: os.homedir(),
    abortController: activeAbort,
    env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` },
    ...(resume ? { resume } : {}),
  });

  const debugLog = process.env.CLAWD_DEBUG_LOG
    ? (m) => {
        try {
          const blocks = (m.message?.content || []).map((b) => b.type + (b.name ? ":" + b.name : ""));
          const ev = m.event ? m.event.type + ":" + (m.event.delta?.type || m.event.content_block?.type || "") : "";
          fs.appendFileSync(
            process.env.CLAWD_DEBUG_LOG,
            JSON.stringify({ type: m.type, subtype: m.subtype, parent: m.parent_tool_use_id || null, blocks, ev }) + "\n",
          );
        } catch {}
      }
    : null;

  const attempt = async (resume) => {
    for await (const msg of sdk.query({ prompt: text, options: options(resume) })) {
      debugLog?.(msg);
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        saveSession();
        ui({ type: "init" });
      } else if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && !msg.parent_tool_use_id) {
          ui({ type: "delta", text: ev.delta.text });
        } else if (ev?.type === "content_block_start" && ev.content_block?.type === "text" && !msg.parent_tool_use_id) {
          ui({ type: "textStart" });
        }
      } else if (msg.type === "assistant") {
        for (const block of msg.message?.content || []) {
          if (block.type === "tool_use") {
            ui({ type: "tool", name: block.name, summary: toolSummary(block.name, block.input) });
          }
        }
      } else if (msg.type === "user") {
        const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
        if (blocks.some((b) => b.type === "tool_result")) ui({ type: "toolResult" });
      } else if (msg.type === "result") {
        ui({
          type: "result",
          ok: msg.subtype === "success",
          error: msg.subtype === "success" ? null : msg.subtype,
          text: msg.subtype === "success" ? msg.result : null,
          costUsd: msg.total_cost_usd || 0,
        });
      }
    }
  };

  try {
    await attempt(sessionId);
  } catch (e) {
    if (activeAbort?.signal.aborted) {
      ui({ type: "result", ok: false, error: "stopped", text: null, costUsd: 0 });
    } else if (sessionId) {
      // stale/pruned session — retry once fresh
      clearSession();
      try {
        await attempt(null);
      } catch (e2) {
        ui({ type: "error", text: String(e2?.message || e2) });
      }
    } else {
      ui({ type: "error", text: String(e?.message || e) });
    }
  } finally {
    activeAbort = null;
  }
}

async function pump() {
  if (busy || queue.length === 0) return;
  busy = true;
  const text = queue.shift();
  ui({ type: "turnStart" });
  await runTurn(text);
  busy = false;
  if (PROBE && queue.length === 0) return probeFinish();
  pump();
}

async function probeFinish() {
  setTimeout(async () => {
    try {
      const counts = await win.webContents.executeJavaScript(
        `({tools: document.querySelectorAll('.toolrow').length,
           bubbles: document.querySelectorAll('.bubble').length,
           pill: document.getElementById('pillTitle').textContent})`,
      );
      console.log("PROBE_COUNTS:" + JSON.stringify(counts));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SMOKE_OUT, img.toPNG());
      console.log("PROBE_PNG:" + SMOKE_OUT);
      app.exit(0);
    } catch (e) {
      console.error("probe capture failed:", e);
      app.exit(1);
    }
  }, 1200);
}

// ---------- window ----------
function setClickThrough(on) {
  if (!win) return;
  if (on) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: W,
    height: H,
    x: wa.x + wa.width - W - 24,
    y: wa.y + wa.height - H - 8,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile("pet.html");
  win.once("ready-to-show", () => {
    win.showInactive();
    setClickThrough(true);
  });
  win.on("blur", () => {
    if (!dragging) setClickThrough(true);
  });
  win.on("closed", () => (win = null));

  if (SMOKE) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(SMOKE_OUT, img.toPNG());
          console.log("SMOKE_PNG:" + SMOKE_OUT);
          app.exit(0);
        } catch (e) {
          console.error("smoke capture failed:", e);
          app.exit(1);
        }
      }, 2500);
    });
    setTimeout(() => app.exit(1), 10_000);
  }

  if (PROBE) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        win.webContents.send("ui:toggleChat");
        ui({ type: "probeUser", text: PROBE });
        queue.push(PROBE);
        pump();
      }, 800);
    });
    setTimeout(() => {
      console.error("probe timed out");
      app.exit(1);
    }, 180_000);
  }
}

// ---------- ipc ----------
ipcMain.on("ui:interactive", (_e, on) => {
  if (dragging) return;
  setClickThrough(!on);
});

ipcMain.on("ui:dragStart", () => {
  if (!win) return;
  const cur = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragging = { offX: cur.x - wx, offY: cur.y - wy, timer: null };
  setClickThrough(false);
  dragging.timer = setInterval(() => {
    if (!win || !dragging) return;
    const p = screen.getCursorScreenPoint();
    const wa2 = screen.getDisplayMatching(win.getBounds()).workArea;
    const x = Math.min(Math.max(p.x - dragging.offX, wa2.x), wa2.x + wa2.width - W);
    const y = Math.min(Math.max(p.y - dragging.offY, wa2.y), wa2.y + wa2.height - H);
    win.setPosition(Math.round(x), Math.round(y), false);
  }, 16);
});

ipcMain.on("ui:dragEnd", () => {
  if (dragging?.timer) clearInterval(dragging.timer);
  dragging = null;
});

// idle wander: ease the window horizontally by dx over ~1.2s
let wanderTimer = null;
ipcMain.on("ui:wander", (_e, dx) => {
  if (!win || dragging || wanderTimer || typeof dx !== "number") return;
  const [sx, sy] = win.getPosition();
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const target = Math.min(Math.max(sx + dx, wa.x), wa.x + wa.width - W);
  const t0 = Date.now(), dur = 1200;
  wanderTimer = setInterval(() => {
    if (!win || dragging) {
      clearInterval(wanderTimer);
      wanderTimer = null;
      return;
    }
    const p = Math.min((Date.now() - t0) / dur, 1);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    win.setPosition(Math.round(sx + (target - sx) * ease), sy, false);
    if (p >= 1) {
      clearInterval(wanderTimer);
      wanderTimer = null;
      ui({ type: "wanderDone" });
    }
  }, 16);
});

ipcMain.on("ui:contextMenu", () => {
  if (!win) return;
  Menu.buildFromTemplate([
    { label: "Open / Close Chat", click: () => win.webContents.send("ui:toggleChat") },
    { label: "Sounds On / Off", click: () => win.webContents.send("ui:toggleMute") },
    {
      label: "New Conversation",
      click: () => {
        clearSession();
        ui({ type: "reset" });
      },
    },
    { type: "separator" },
    { label: "Quit Clawd", role: "quit" },
  ]).popup({ window: win });
});

ipcMain.on("agent:send", (_e, text) => {
  if (typeof text !== "string" || !text.trim()) return;
  queue.push(text.trim());
  pump();
});

ipcMain.on("agent:stop", () => activeAbort?.abort());

ipcMain.on("agent:new", () => {
  clearSession();
  ui({ type: "reset" });
});

// ---------- app ----------
app.whenReady().then(() => {
  app.dock?.hide();
  loadSession();
  createWindow();
  try {
    globalShortcut.register("Alt+Shift+C", () => win?.webContents.send("ui:toggleChat"));
  } catch {}
  if (app.isPackaged && !app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
});

app.on("second-instance", () => win?.webContents.send("ui:toggleChat"));
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
