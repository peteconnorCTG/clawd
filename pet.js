/* Clawd renderer: official-Clawd pixel sprite + chiptune sounds + wander + chat UI. */
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
let activeTool = null;
let talkingUntil = 0;
let errorUntil = 0;
let scurryUntil = 0;        // excited run-off animation right after a task starts
let walkingUntil = 0;       // idle wander shuffle
let walkDir = 1;
let lastActivity = Date.now();
let streamBuf = "";
let streamEl = null;
let pillHideTimer = null;

/* ---------------- sounds (procedural chiptune, no assets) ---------------- */
let muted = localStorage.getItem("clawd-mute") === "1";
let audio = null;
function blip(notes, noteMs = 70, type = "square", vol = 0.1) {
  if (muted) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
    const t0 = audio.currentTime;
    notes.forEach((f, i) => {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const start = t0 + (i * noteMs) / 1000;
      const end = start + noteMs / 1000;
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, end);
      osc.connect(g).connect(audio.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });
  } catch {}
}
const sfx = {
  scurry: () => blip([523, 659, 784], 60),          // runs off to work
  done: () => blip([659, 988], 95),                 // ta-da
  error: () => blip([196, 165], 130, "sawtooth", 0.07),
  hello: () => blip([784, 1047], 70, "triangle", 0.08),
};

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
  if (!streamEl) streamEl = addBubble("assistant streaming", "");
  return streamEl;
}
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
  if (ev.type !== "wanderDone") lastActivity = Date.now();
  switch (ev.type) {
    case "turnStart":
      setBusy(true);
      finalizeStream(null);
      refreshPill();
      scurryUntil = Date.now() + 1100;
      sfx.scurry();
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
        sfx.done();
      } else if (ev.error === "stopped") {
        finalizeStream(null);
        addNote("stopped");
        setPill("Stopped", "");
      } else {
        finalizeStream(null);
        addBubble("error", "Turn ended: " + ev.error);
        setPill("Error", "");
        errorUntil = Date.now() + 1400;
        sfx.error();
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
      sfx.error();
      fadePill(5000);
      break;
    case "probeUser":
      addBubble("user", ev.text);
      break;
    case "wanderDone":
      walkingUntil = 0;
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
window.clawd.onToggleMute(() => {
  muted = !muted;
  localStorage.setItem("clawd-mute", muted ? "1" : "0");
  if (!muted) sfx.hello();
  setPill(muted ? "Sounds off" : "Sounds on", "");
  fadePill(1500);
});

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

/* ================= sprite engine — official Clawd ================= */
/* Anthropic's clawd.svg is an 11x4 cell creature; we render it on a 2x-fine
   grid (22 wide) with eyes, pupils, mouth, blush and leg animation added. */
const FW = 22, FH = 10;         // fine grid of the body (2 fine px per official cell)
const U = 3;                    // css px per fine px — small is cute
const CSS_W = 200, CSS_H = 132;
const BODY_X = (CSS_W - FW * U) / 2;
const BODY_Y = 58;              // leaves headroom for the thinking spark + Zzz
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = CSS_W * dpr;
canvas.height = CSS_H * dpr;
ctx.imageSmoothingEnabled = false;

const C = {
  coral: "#d97757",
  dark: "#c05f3f",
  face: "#f7f3ea",
  ink: "#2a2620",
  blush: "#eb9a7e",
};

// body map rows (legs drawn separately for animation)
// '.'=empty  c=coral  E=eye(ivory) — official 11x4 Clawd, chibi-lifted one row,
// corners rounded, arms as the official side nubs
const BODY = [
  "...cccccccccccccccc...",   // head, rounded
  "..cccccccccccccccccc..",
  "..cccEEEccccccEEEccc..",   // big eyes
  "..cccEEEccccccEEEccc..",
  "cccccEEEccccccEEEccccc",   // arm nubs at mid-body + eye bottoms
  "cccccccccccccccccccccc",
  "..cccccccccccccccccc..",
  "...cccccccccccccccc...",   // bottom, rounded
];
const LEGS = [ [2, 3], [6, 7], [14, 15], [18, 19] ]; // fine-col pairs, official cols 1,3,7,9
const LEG_Y = 8;                // legs occupy fine rows 8-9

function fpx(fx, fy, color, ox = 0, oy = 0) {
  ctx.fillStyle = color;
  ctx.fillRect((BODY_X + fx * U + ox) * dpr, (BODY_Y + fy * U + oy) * dpr, U * dpr, U * dpr);
}

let blinkAt = 2000 + Math.random() * 3000;
let zzz = [];
let lastZzz = 0;
const Z_MAP = [[1, 1, 1], [0, 1, 0], [1, 1, 1]];

function petState() {
  const now = Date.now();
  if (now < errorUntil) return "error";
  if (now < scurryUntil) return "scurry";
  if (busy && pendingTools > 0) return "working";
  if (busy && now < talkingUntil) return "talking";
  if (busy) return "thinking";
  if (now < talkingUntil) return "talking";
  if (now < walkingUntil) return "walking";
  if (now - lastActivity > 90_000 && chat.classList.contains("hidden")) return "sleeping";
  return "idle";
}

function draw(tMs) {
  const t = tMs / 1000;
  const state = petState();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let bob = Math.sin(t * 2.2) > 0 ? 0 : 1;          // slow 2-frame idle breath
  let lean = 0;
  let eyeMode = "open";
  let pupilDx = 0;
  let mouth = "smile";
  let stepPhase = -1;                                // -1 = planted
  const walkish = state === "walking" || state === "scurry";

  if (state === "thinking") {
    eyeMode = "up";
    bob = 0;
  } else if (state === "working") {
    bob = Math.sin(t * 10) > 0 ? 0 : 1;
    eyeMode = "half";
  } else if (state === "talking") {
    mouth = (t * 8) % 1 < 0.5 ? "open" : "smile";
    bob = Math.sin(t * 7) > 0 ? 0 : 1;
  } else if (walkish) {
    const rate = state === "scurry" ? 14 : 7;
    stepPhase = Math.floor(t * rate) % 2;
    bob = stepPhase;
    lean = (state === "scurry" ? 2 : 1) * (state === "walking" ? walkDir : (Math.floor(t * 6) % 2 ? 1 : -1));
    if (state === "scurry") eyeMode = "open";
  } else if (state === "sleeping") {
    bob = Math.sin(t * 1.1) > 0 ? 0 : 1;
    eyeMode = "closed";
    mouth = "none";
  } else if (state === "error") {
    eyeMode = "x";
    mouth = "open";
    lean = Math.sin(t * 40) > 0 ? 1 : -1;
  }
  // occasional idle glance left/right
  if (state === "idle") pupilDx = Math.sin(t * 0.5) > 0.6 ? 1 : Math.sin(t * 0.5) < -0.6 ? -1 : 0;

  if (eyeMode === "open" && tMs > blinkAt) {
    if (tMs > blinkAt + 130) blinkAt = tMs + 2200 + Math.random() * 3200;
    else eyeMode = "closed";
  }

  const ox = lean;               // css px offsets for the whole body
  const oy = bob;

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse((CSS_W / 2 + ox) * dpr, (BODY_Y + (FH + 2) * U + 4) * dpr,
    (FW * U * 0.44) * dpr, 4 * dpr, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  for (let fy = 0; fy < FH - 2; fy++) {
    const row = BODY[fy];
    for (let fx = 0; fx < FW; fx++) {
      const ch = row[fx];
      if (ch === ".") continue;
      fpx(fx, fy, ch === "E" ? C.face : C.coral, ox, oy);
    }
  }

  // legs: two fine-px tall; walking lifts alternate pairs
  LEGS.forEach((pair, i) => {
    const lifted = stepPhase >= 0 && i % 2 === stepPhase;
    for (const fx of pair) {
      fpx(fx, LEG_Y, C.coral, ox, oy - (lifted ? U : 0));
      if (!lifted) fpx(fx, LEG_Y + 1, C.dark, ox, oy);
    }
  });

  // eyes: 3x3 sclera at cols 5-7 / 14-16 (rows 2-4); overlays per state
  for (const eye of [{ e: 5 }, { e: 14 }]) {
    // pupil 2x2, right-biased at rest, glance shifts left — always inside the sclera
    const p = eye.e + (pupilDx < 0 ? 0 : 1);
    if (eyeMode === "open") {
      fpx(p, 3, C.ink, ox, oy); fpx(p + 1, 3, C.ink, ox, oy);
      fpx(p, 4, C.ink, ox, oy); fpx(p + 1, 4, C.ink, ox, oy);
      fpx(p, 3, "#ffffff", ox, oy);                  // sparkle inside the pupil
    } else if (eyeMode === "half") {
      fpx(eye.e, 2, C.coral, ox, oy); fpx(eye.e + 1, 2, C.coral, ox, oy); fpx(eye.e + 2, 2, C.coral, ox, oy);
      fpx(p, 4, C.ink, ox, oy); fpx(p + 1, 4, C.ink, ox, oy);
    } else if (eyeMode === "up") {
      fpx(eye.e + 1, 2, C.ink, ox, oy); fpx(eye.e + 2, 2, C.ink, ox, oy);
      fpx(eye.e + 1, 3, C.ink, ox, oy); fpx(eye.e + 2, 3, C.ink, ox, oy);
      fpx(eye.e + 1, 2, "#ffffff", ox, oy);
    } else if (eyeMode === "closed") {
      for (let i = 0; i < 3; i++) { fpx(eye.e + i, 2, C.coral, ox, oy); fpx(eye.e + i, 4, C.coral, ox, oy); fpx(eye.e + i, 3, C.ink, ox, oy); }
    } else if (eyeMode === "x") {
      fpx(eye.e, 2, C.ink, ox, oy); fpx(eye.e + 2, 2, C.ink, ox, oy);
      fpx(eye.e + 1, 3, C.ink, ox, oy);
      fpx(eye.e, 4, C.ink, ox, oy); fpx(eye.e + 2, 4, C.ink, ox, oy);
    }
  }

  // mouth (center, under the eye line)
  if (mouth === "open") { fpx(10, 5, C.ink, ox, oy); fpx(11, 5, C.ink, ox, oy); fpx(10, 6, C.ink, ox, oy); fpx(11, 6, C.ink, ox, oy); }
  else if (mouth === "smile") { fpx(10, 6, C.ink, ox, oy); fpx(11, 6, C.ink, ox, oy); }

  // blush on the cheeks, outside under the eyes
  fpx(2, 5, C.blush, ox, oy); fpx(3, 5, C.blush, ox, oy);
  fpx(18, 5, C.blush, ox, oy); fpx(19, 5, C.blush, ox, oy);

  // thinking spark: tiny Claude asterisk spinning above his head
  if (state === "thinking") {
    const sx = CSS_W / 2 + ox;
    const sy = BODY_Y - 14;
    const a = t * 3;
    ctx.fillStyle = C.coral;
    for (let k = 0; k < 4; k++) {
      const th = a + (k * Math.PI) / 2;
      for (const rr of [3, 6]) {
        ctx.fillRect((sx + Math.cos(th) * rr - 1.5) * dpr, (sy + Math.sin(th) * rr - 1.5) * dpr, 3 * dpr, 3 * dpr);
      }
    }
    ctx.fillRect((sx - 2) * dpr, (sy - 2) * dpr, 4 * dpr, 4 * dpr);
  }

  // Zzz
  if (state === "sleeping" && tMs - lastZzz > 1700) {
    lastZzz = tMs;
    zzz.push({ x: CSS_W / 2 + 26, y: BODY_Y - 6, age: 0 });
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

/* ---------------- idle wander ---------------- */
let nextWanderAt = Date.now() + 30_000;
setInterval(() => {
  const now = Date.now();
  if (now < nextWanderAt) return;
  nextWanderAt = now + 25_000 + Math.random() * 45_000;
  if (busy || hot || downAt || !chat.classList.contains("hidden")) return;
  if (petState() !== "idle") return;
  walkDir = Math.random() < 0.5 ? -1 : 1;
  const dist = Math.round(50 + Math.random() * 110) * walkDir;
  walkingUntil = now + 5000; // safety cap; wanderDone ends it sooner
  window.clawd.wander(dist);
}, 1000);

/* ---------------- render loop ---------------- */
let lastFrame = 0;
function loop(tMs) {
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
