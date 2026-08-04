/* Clawd renderer: procedural pixel sprite + chat UI + agent state machine. */
"use strict";

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const chat = $("chat"), transcript = $("transcript"), input = $("input");
const composer = $("composer"), btnSend = $("btnSend"), btnStop = $("btnStop");
const btnNew = $("btnNew"), btnClose = $("btnClose");
const pill = $("pill"), pillTitle = $("pillTitle"), pillSub = $("pillSub");
const canvas = $("pet"), ctx = canvas.getContext("2d");

/* ---------------- agent state ---------------- */
let busy = false;
let pendingTools = 0;
let activeTool = null;      // summary string of the running tool
let talkingUntil = 0;
let errorUntil = 0;
let lastActivity = Date.now();
let streamBuf = "";
let streamEl = null;
let pillHideTimer = null;

/* ---------------- chat UI ---------------- */
function scrollBottom() { transcript.scrollTop = transcript.scrollHeight; }

function addBubble(cls, text) {
  const el = document.createElement("div");
  el.className = "bubble " + cls;
  el.textContent = text;
  transcript.appendChild(el);
  scrollBottom();
  return el;
}
function addToolRow(summary) {
  const el = document.createElement("div");
  el.className = "toolrow";
  el.textContent = "⚙ " + summary;
  transcript.appendChild(el);
  scrollBottom();
}
function addNote(text) {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  transcript.appendChild(el);
  scrollBottom();
}
function ensureStreamEl() {
  if (!streamEl) {
    streamEl = addBubble("assistant streaming", "");
  }
  return streamEl;
}
// strip markdown emphasis the model may emit — transcript is plaintext by design
function tidy(t) {
  return t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`\n]+)`/g, "$1");
}
function finalizeStream(finalText) {
  if (streamEl) {
    streamEl.classList.remove("streaming");
    const best = finalText && finalText.length > streamBuf.length ? finalText : streamBuf;
    streamEl.textContent = tidy(best);
    if (!streamEl.textContent) streamEl.remove();
  } else if (finalText) {
    addBubble("assistant", tidy(finalText));
  }
  streamEl = null;
  streamBuf = "";
}
function greet() {
  addBubble("assistant", "Hey Pete 👋 I'm Clawd. Ask me to do things on this Mac — I'll actually do them.");
}

function setPill(title, sub) {
  clearTimeout(pillHideTimer);
  pill.classList.remove("hidden");
  pillTitle.textContent = title;
  pillSub.textContent = sub || "";
}
function fadePill(ms) {
  clearTimeout(pillHideTimer);
  pillHideTimer = setTimeout(() => pill.classList.add("hidden"), ms);
}
function streamTail() {
  const t = streamBuf.replace(/\s+/g, " ").trim();
  return t.length > 70 ? "…" + t.slice(-69) : t;
}
function refreshPill() {
  if (!busy) return;
  const title = activeTool || (streamBuf ? "Replying…" : "Thinking…");
  setPill(title, streamTail());
}

function setBusy(b) {
  busy = b;
  btnStop.classList.toggle("hidden", !b);
}

/* ---------------- chat open/close ---------------- */
function toggleChat(force) {
  const open = force !== undefined ? force : chat.classList.contains("hidden");
  chat.classList.toggle("hidden", !open);
  if (open) {
    window.focus();
    input.focus();
    scrollBottom();
  }
  lastActivity = Date.now();
}

/* ---------------- agent events ---------------- */
window.clawd.onEvent((ev) => {
  lastActivity = Date.now();
  switch (ev.type) {
    case "turnStart":
      setBusy(true);
      finalizeStream(null);
      refreshPill();
      break;
    case "delta":
      streamBuf += ev.text;
      talkingUntil = Date.now() + 900;
      ensureStreamEl();
      refreshPill();
      break;
    case "textStart":
      if (streamBuf) streamBuf += "\n\n";
      break;
    case "tool":
      pendingTools++;
      activeTool = ev.summary;
      addToolRow(ev.summary);
      refreshPill();
      break;
    case "toolResult":
      pendingTools = Math.max(0, pendingTools - 1);
      if (pendingTools === 0) activeTool = null;
      refreshPill();
      break;
    case "result": {
      setBusy(false);
      pendingTools = 0;
      activeTool = null;
      if (ev.ok) {
        finalizeStream(ev.text);
        const cost = ev.costUsd > 0.005 ? ` · $${ev.costUsd.toFixed(2)}` : "";
        setPill("Done ✓" + cost, "");
      } else if (ev.error === "stopped") {
        finalizeStream(null);
        addNote("stopped");
        setPill("Stopped", "");
      } else {
        finalizeStream(null);
        addBubble("error", "Turn ended: " + ev.error);
        setPill("Error", "");
        errorUntil = Date.now() + 1400;
      }
      fadePill(4000);
      break;
    }
    case "error":
      setBusy(false);
      pendingTools = 0;
      activeTool = null;
      finalizeStream(null);
      addBubble("error", ev.text);
      setPill("Error", "");
      errorUntil = Date.now() + 1400;
      fadePill(5000);
      break;
    case "probeUser":
      addBubble("user", ev.text);
      break;
    case "reset":
      setBusy(false);
      pendingTools = 0;
      activeTool = null;
      streamEl = null;
      streamBuf = "";
      transcript.replaceChildren();
      greet();
      setPill("New conversation", "");
      fadePill(2500);
      break;
  }
});
window.clawd.onToggleChat(() => toggleChat());

/* ---------------- composer ---------------- */
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addBubble("user", text);
  window.clawd.send(text);
  input.value = "";
  input.style.height = "auto";
  lastActivity = Date.now();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 96) + "px";
});
btnStop.addEventListener("click", () => window.clawd.stop());
btnNew.addEventListener("click", () => window.clawd.newConversation());
btnClose.addEventListener("click", () => toggleChat(false));
pill.addEventListener("click", () => toggleChat());

/* ---------------- click-through hover dance ---------------- */
let hot = false;
document.addEventListener("mousemove", (e) => {
  const h = !!(e.target && e.target.closest && e.target.closest(".hot"));
  if (h !== hot) {
    hot = h;
    window.clawd.interactive(h);
  }
  if (h) lastActivity = Date.now();
});
document.addEventListener("mouseleave", () => {
  if (hot) { hot = false; window.clawd.interactive(false); }
});
window.addEventListener("blur", () => {
  if (hot) { hot = false; window.clawd.interactive(false); }
});

/* ---------------- drag vs click on the pet ---------------- */
let downAt = null;
canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  downAt = { x: e.screenX, y: e.screenY };
  window.clawd.dragStart();
});
window.addEventListener("mouseup", (e) => {
  if (!downAt) return;
  window.clawd.dragEnd();
  const moved = Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y);
  downAt = null;
  if (moved < 4) toggleChat();
});
for (const el of [canvas, pill]) {
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.clawd.contextMenu();
  });
}

/* ================= sprite engine ================= */
const GRID = 26, CX = 13, CY = 11;
const CSS_W = 200, CSS_H = 190;
const U = 5;                       // css px per grid cell
const OFF_X = (CSS_W - GRID * U) / 2;
const OFF_Y = CSS_H - GRID * U - 8;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = CSS_W * dpr;
canvas.height = CSS_H * dpr;
ctx.imageSmoothingEnabled = false;

const COLORS = {
  outline: "#b85c3f",
  coral: "#d97757",
  light: "#e89b7d",
  face: "#f4efe6",
  ink: "#2a2620",
  blush: "#f2b09b",
  feet: "#a44f36",
};

function px(gx, gy, color) {
  ctx.fillStyle = color;
  ctx.fillRect((OFF_X + gx * U) * dpr, (OFF_Y + gy * U) * dpr, U * dpr, U * dpr);
}

let blinkAt = 2000 + Math.random() * 3000;
let zzz = [];   // {x, y, age}
let lastZzz = 0;

const Z_MAP = [[1, 1, 1], [0, 1, 0], [1, 1, 1]];

function petState() {
  const now = Date.now();
  if (now < errorUntil) return "error";
  if (busy && pendingTools > 0) return "working";
  if (busy && now < talkingUntil) return "talking";
  if (busy) return "thinking";
  if (now < talkingUntil) return "talking";
  if (now - lastActivity > 90_000 && chat.classList.contains("hidden")) return "sleeping";
  return "idle";
}

function draw(tMs) {
  const t = tMs / 1000;
  const state = petState();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // per-state animation parameters
  let rot = Math.PI / 8;          // rest pose: rays on diagonals-ish
  let amp = 1;
  let sy = 1 + 0.025 * Math.sin(t * 2.4);
  let dy = 0;
  let eyes = "open";
  let mouth = "smile";
  let feet = true;
  let wobble = 0;

  if (state === "thinking") {
    rot = t * 1.5;
    eyes = "up";
    feet = false;                 // levitating spin
    dy = -1;
  } else if (state === "working") {
    amp = 1 + 0.24 * Math.sin(t * 9);
    sy = 1 + 0.02 * Math.sin(t * 8);
    eyes = "half";
  } else if (state === "talking") {
    dy = -Math.abs(Math.sin(t * 7)) * 1.2;
    mouth = (t * 8) % 1 < 0.5 ? "open" : "smile";
  } else if (state === "sleeping") {
    sy = 1 + 0.045 * Math.sin(t * 1.1);
    eyes = "closed";
    mouth = "none";
  } else if (state === "error") {
    eyes = "dizzy";
    mouth = "open";
    wobble = Math.sin(t * 40) * 0.6;
  }

  // scheduled blink (idle/talking/working)
  if (eyes === "open" && tMs > blinkAt) {
    if (tMs > blinkAt + 140) blinkAt = tMs + 2200 + Math.random() * 3200;
    else eyes = "closed";
  }

  const sx = 1 + (1 - sy) * 0.7;  // fake volume preservation

  // shadow
  const levit = state === "thinking" ? 8 : 0;
  ctx.fillStyle = `rgba(0,0,0,${0.16 - levit * 0.006})`;
  ctx.beginPath();
  ctx.ellipse(
    (CSS_W / 2 + wobble) * dpr,
    (OFF_Y + 23.6 * U) * dpr,
    (40 - levit + 4 * Math.sin(t * 2.4)) * dpr,
    6 * dpr, 0, 0, Math.PI * 2,
  );
  ctx.fill();

  // starburst body
  const r0 = 6.0, rayLen = 4.6 * amp;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const dx = (gx - CX - wobble) / sx;
      const dv = (gy - CY - dy) / sy;
      const r = Math.hypot(dx, dv);
      if (r > r0 + rayLen + 1.5) continue;
      const th = Math.atan2(dv, dx);
      const R = r0 + rayLen * Math.pow(Math.abs(Math.cos(4 * (th + rot))), 2.6);
      if (r > R) continue;
      let c;
      if (r >= R - 1.25) c = COLORS.outline;
      else if (r <= 4.55) c = COLORS.face;
      else if (dx * 0.6 + dv < -4.2) c = COLORS.light;
      else c = COLORS.coral;
      px(gx, gy, c);
    }
  }

  // face overlays (grid coords, follow dy but not squash — close enough)
  const ey = Math.round(CY + dy);
  const fy = (o) => ey + o;
  for (const side of [-2, 2]) {
    const ex = CX + side;
    if (eyes === "open") { px(ex, fy(-1), COLORS.ink); px(ex, fy(0), COLORS.ink); }
    else if (eyes === "closed") px(ex, fy(0), COLORS.ink);
    else if (eyes === "half") px(ex, fy(0), COLORS.ink);
    else if (eyes === "up") { px(ex, fy(-2), COLORS.ink); px(ex, fy(-1), COLORS.ink); }
    else if (eyes === "dizzy") { px(ex - 1, fy(-1), COLORS.ink); px(ex, fy(0), COLORS.ink); px(ex + 1, fy(-1), COLORS.ink); }
  }
  if (mouth === "smile") { px(CX - 1, fy(2), COLORS.ink); px(CX, fy(2), COLORS.ink); px(CX + 1, fy(2), COLORS.ink); }
  else if (mouth === "open") { px(CX - 1, fy(2), COLORS.ink); px(CX, fy(2), COLORS.ink); px(CX - 1, fy(3), COLORS.ink); px(CX, fy(3), COLORS.ink); }
  px(CX - 4, fy(1), COLORS.blush);
  px(CX + 4, fy(1), COLORS.blush);

  // feet
  if (feet) {
    px(CX - 4, 22, COLORS.feet); px(CX - 3, 22, COLORS.feet);
    px(CX + 3, 22, COLORS.feet); px(CX + 4, 22, COLORS.feet);
  }

  // Zzz particles
  if (state === "sleeping") {
    if (tMs - lastZzz > 1700) {
      lastZzz = tMs;
      zzz.push({ x: OFF_X + 21 * U, y: OFF_Y + 4 * U, age: 0 });
    }
  }
  zzz = zzz.filter((p) => p.age < 3.2);
  for (const p of zzz) {
    p.age += 1 / 12;
    const zx = p.x + p.age * 7;
    const zy = p.y - p.age * 13;
    const alpha = Math.max(0, 0.55 - p.age * 0.17);
    const s = 2 + p.age * 0.6;
    ctx.fillStyle = `rgba(240,238,230,${alpha})`;
    for (let ry = 0; ry < 3; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (Z_MAP[ry][rx]) ctx.fillRect((zx + rx * s) * dpr, (zy + ry * s) * dpr, s * dpr, s * dpr);
  }
}

/* ---------------- render loop ---------------- */
let lastFrame = 0;
function loop(tMs) {
  // stream text flushes at display rate; sprite at ~12fps for chunk
  if (streamEl && streamEl.textContent !== streamBuf) {
    streamEl.textContent = streamBuf;
    scrollBottom();
  }
  if (tMs - lastFrame > 80) {
    lastFrame = tMs;
    draw(tMs);
  }
  requestAnimationFrame(loop);
}

greet();
setPill("Hey Pete 👋", "click me to chat");
fadePill(6000);
requestAnimationFrame(loop);
