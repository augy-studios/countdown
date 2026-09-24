// Countdown Timer

import {
  COLOR_THEMES,
  applyColorTheme,
  applyMode,
  getStoredColorTheme,
  getStoredMode,
  getModePreference,
  initTheme,
} from "./js/theme.js";
import { hydrateIcons, openModal, closeModal } from "./js/ui.js";
import "./js/update.js";

const $ = (s) => document.querySelector(s);

// ===== Theme modal =====
function buildThemeModal() {
  const grid = document.getElementById("swatchGrid");
  grid.innerHTML = COLOR_THEMES.map(
    (t) => `
      <button class="swatch" data-theme-id="${t.id}" style="--swatch-color:${t.hex}" type="button" aria-label="${t.label}">
        <span class="swatch-dot"></span>
        <span class="swatch-label">${t.label}</span>
      </button>`
  ).join("");

  syncThemeModalState();

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-id]");
    if (!btn) return;
    applyColorTheme(btn.dataset.themeId);
    syncThemeModalState();
  });

  document.getElementById("modeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    applyMode(btn.dataset.mode);
    syncThemeModalState();
  });

  // A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
  // modal so the note and pressed state stay in step with the change.
  document.addEventListener("uwu:modechange", syncThemeModalState);
}

function syncThemeModalState() {
  const activeTheme = getStoredColorTheme();
  const activePreference = getModePreference();
  const resolvedMode = getStoredMode();

  document.querySelectorAll("#swatchGrid .swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.themeId === activeTheme);
  });
  document.querySelectorAll("#modeToggle .mode-btn").forEach((el) => {
    const isActive = el.dataset.mode === activePreference;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-pressed", String(isActive));
  });

  const note = document.getElementById("modeNote");
  if (note) {
    note.hidden = activePreference !== "time";
    if (activePreference === "time") {
      note.textContent = `Following the clock. Currently ${resolvedMode}.`;
    }
  }

  updateThemeButtonIcon();
}

function updateThemeButtonIcon() {
  const span = document.querySelector("#themeBtn [data-icon]");
  span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
  hydrateIcons(document.getElementById("themeBtn"));
}

// Focus goes into the modal on open and back to whatever opened it on close.
let modalOpener = null;

function showModal(id) {
  modalOpener = document.activeElement;
  openModal(id);
  document.querySelector(`#${id} [data-close-modal]`)?.focus();
}

function hideModal(id) {
  closeModal(id);
  modalOpener?.focus?.();
  modalOpener = null;
}

function wireModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => hideModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hideModal(backdrop.id);
    });
  });
  document.getElementById("themeBtn").addEventListener("click", () => showModal("themeModal"));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal-backdrop:not(.hidden)");
    if (open) hideModal(open.id);
  });
}

// ===== Elements =====
const els = {
  d: $("#d"),
  h: $("#h"),
  m: $("#m"),
  s: $("#s"),

  titleInput: $("#titleInput"),
  status: $("#status"),

  startBtn: $("#startBtn"),
  pauseBtn: $("#pauseBtn"),
  resetBtn: $("#resetBtn"),

  settingsToggle: $("#settingsToggle"),
  settingsPanel: $("#settingsPanel"),

  countMode: $("#countMode"),
  target: $("#target"),
  durationMin: $("#durationMin"),
  startDelay: $("#startDelay"),

  bgLayer: $("#bgLayer"),
  bgImg: $("#bgImg"),
  bgUrl: $("#bgUrl"),
  bgFile: $("#bgFile"),
  clearBgBtn: $("#clearBgBtn"),
  dim: $("#dim"),
  dimOut: $("#dimOut"),
  blur: $("#blur"),
  blurOut: $("#blurOut"),

  showDays: $("#showDays"),
  showHours: $("#showHours"),
  showMinutes: $("#showMinutes"),
  showSeconds: $("#showSeconds"),

  saveBtn: $("#saveBtn"),
  clearBtn: $("#clearBtn"),

  toast: $("#toast"),
  canvas: $("#confettiCanvas"),
};

const PAGE_TITLE = document.title;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ===== Toast =====
let toastTimer = null;

function showToast(message, kind = "") {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", kind === "error");
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.classList.toggle("done", kind === "done");
}

function setButton(btn, iconName, label) {
  btn.querySelector("[data-icon]").setAttribute("data-icon", iconName);
  btn.querySelector(".btn-label").textContent = label;
  hydrateIcons(btn);
}

// ===== Settings panel =====
els.settingsToggle.addEventListener("click", () => {
  const open = els.settingsToggle.getAttribute("aria-expanded") !== "true";
  els.settingsToggle.setAttribute("aria-expanded", String(open));
  els.settingsPanel.classList.toggle("hidden", !open);
});

// ===== Background =====
// An image the person uploaded or dropped. Kept in memory until saved, then
// stored in IndexedDB so it survives a reload and works offline.
let bgBlob = null;
let bgObjectUrl = null;

function applyOverlay() {
  document.documentElement.style.setProperty("--bg-dim", `${els.dim.value}%`);
  document.documentElement.style.setProperty("--bg-blur", `${els.blur.value}px`);
  els.dimOut.textContent = `${els.dim.value}%`;
  els.blurOut.textContent = `${els.blur.value} px`;
}

function releaseObjectUrl() {
  if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl);
  bgObjectUrl = null;
}

// The layer is revealed on load, so a broken URL never flashes an empty frame.
function showBackground(src) {
  if (!src) {
    els.bgLayer.classList.add("hidden");
    return;
  }
  els.bgImg.src = src;
}

function setBackgroundUrl(url) {
  bgBlob = null;
  releaseObjectUrl();
  els.bgFile.value = "";
  showBackground(url);
}

function setBackgroundBlob(blob) {
  bgBlob = blob;
  releaseObjectUrl();
  bgObjectUrl = URL.createObjectURL(blob);
  els.bgUrl.value = "";
  showBackground(bgObjectUrl);
}

function clearBackground() {
  bgBlob = null;
  els.bgUrl.value = "";
  els.bgFile.value = "";
  showBackground("");
  releaseObjectUrl();
}

els.bgImg.addEventListener("load", () => els.bgLayer.classList.remove("hidden"));
els.bgImg.addEventListener("error", () => {
  els.bgLayer.classList.add("hidden");
  showToast("That background image could not be loaded.", "error");
});

els.bgUrl.addEventListener("change", () => setBackgroundUrl(els.bgUrl.value.trim()));
els.bgFile.addEventListener("change", () => {
  const f = els.bgFile.files?.[0];
  if (f) setBackgroundBlob(f);
});
els.clearBgBtn.addEventListener("click", clearBackground);

// Drag & drop background
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith("image/")) setBackgroundBlob(f);
});

els.dim.addEventListener("input", applyOverlay);
els.blur.addEventListener("input", applyOverlay);

// ===== Image storage (IndexedDB) =====
const DB_NAME = "countdown";
const DB_STORE = "files";
const IMAGE_KEY = "background";

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

// Storage can be unavailable (private windows, blocked site data). The
// background then lasts for this page view only, which is still useful.
function storeImage(blob) {
  try {
    return withStore("readwrite", (s) => (blob ? s.put(blob, IMAGE_KEY) : s.delete(IMAGE_KEY))).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function loadImage() {
  try {
    return withStore("readonly", (s) => s.get(IMAGE_KEY)).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

// ===== Count mode =====
let countMode = "date";

function setCountMode(mode) {
  countMode = mode === "duration" ? "duration" : "date";
  els.countMode.querySelectorAll("[data-count-mode]").forEach((btn) => {
    const on = btn.dataset.countMode === countMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-for-mode]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.forMode !== countMode);
  });
  updateControls();
}

els.countMode.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-count-mode]");
  if (btn) setCountMode(btn.dataset.countMode);
});

// ===== Visibility toggles =====
const UNITS = [
  { key: "d", ms: 86400000, toggle: "showDays" },
  { key: "h", ms: 3600000, toggle: "showHours" },
  { key: "m", ms: 60000, toggle: "showMinutes" },
  { key: "s", ms: 1000, toggle: "showSeconds" },
];

function visibleUnits() {
  return UNITS.filter((u) => els[u.toggle].checked);
}

function applyVisibility() {
  UNITS.forEach((u) => {
    els[u.key].parentElement.classList.toggle("hidden", !els[u.toggle].checked);
  });
  if (targetTS !== null && delayTimer === null) tick();
}

UNITS.forEach((u) => els[u.toggle].addEventListener("change", applyVisibility));

// ===== Countdown engine =====
let runMode = null; // "date" or "duration" once started, null when idle
let targetTS = null; // when the running countdown ends
let pausedRemaining = null; // ms left while paused, duration mode only
let tickTimer = null;
let delayTimer = null;
let endReached = false;

function pad(n) {
  return String(Math.max(0, n)).padStart(2, "0");
}

// Split into the visible units. A hidden unit's share rolls into the next
// visible one down, so hiding Days shows 49 hours rather than 1. Rounded up
// to the second, so the display reaches 00 exactly when time is up.
function splitRemaining(ms) {
  let rest = Math.ceil(ms / 1000) * 1000;
  const parts = {};
  for (const u of visibleUnits()) {
    parts[u.key] = Math.floor(rest / u.ms);
    rest -= parts[u.key] * u.ms;
  }
  return parts;
}

function render(ms) {
  const parts = splitRemaining(ms);
  for (const u of UNITS) {
    const text = pad(parts[u.key] ?? 0);
    if (els[u.key].textContent !== text) els[u.key].textContent = text;
  }
  return parts;
}

function remaining() {
  if (pausedRemaining !== null) return pausedRemaining;
  return Math.max(0, targetTS - Date.now());
}

function tick() {
  const ms = remaining();
  const parts = render(ms);
  if (ms <= 0) {
    finish();
    return;
  }
  const units = visibleUnits();
  const title = units.length ?
    `${units.map((u) => pad(parts[u.key])).join(":")} | Countdown Timer` :
    PAGE_TITLE;
  if (document.title !== title) document.title = title;
}

function finish() {
  clearInterval(tickTimer);
  tickTimer = null;
  if (endReached) return;
  endReached = true;
  document.title = "Time's up! | Countdown Timer";
  setStatus("Time's up!", "done");
  startConfetti();
  updateControls();
}

function clearTimers() {
  clearInterval(tickTimer);
  clearTimeout(delayTimer);
  tickTimer = null;
  delayTimer = null;
}

function startCountdown() {
  const mode = countMode;
  let target = null;
  let durationMs = null;

  if (mode === "date") {
    const dt = new Date(els.target.value);
    if (!els.target.value || isNaN(dt.getTime())) {
      showToast("Set a target date and time first.", "error");
      els.target.focus();
      return;
    }
    target = dt.getTime();
  } else {
    const mins = Number(els.durationMin.value);
    if (!(mins > 0)) {
      showToast("Enter a duration in minutes first.", "error");
      els.durationMin.focus();
      return;
    }
    durationMs = Math.round(mins * 60000);
  }

  stopConfetti();
  clearTimers();
  endReached = false;
  pausedRemaining = null;
  targetTS = null;
  runMode = mode;

  // A duration starts counting when the delay ends, not when Start is pressed,
  // so "start after" never eats into it.
  const begin = () => {
    delayTimer = null;
    targetTS = mode === "duration" ? Date.now() + durationMs : target;
    setStatus("");
    tick();
    if (!endReached) tickTimer = setInterval(tick, 250);
    updateControls();
  };

  const delaySec = Math.max(0, Math.floor(Number(els.startDelay.value) || 0));
  if (delaySec > 0) {
    render(mode === "duration" ? durationMs : Math.max(0, target - Date.now()));
    setStatus(`Starting in ${delaySec} second${delaySec === 1 ? "" : "s"}`);
    delayTimer = setTimeout(begin, delaySec * 1000);
  } else {
    begin();
  }

  saveSettings();
  updateControls();
}

// A date does not move, so only a duration can be paused.
function togglePause() {
  if (runMode !== "duration" || endReached || delayTimer !== null || targetTS === null) return;
  if (pausedRemaining === null) {
    pausedRemaining = Math.max(0, targetTS - Date.now());
    setStatus("Paused");
  } else {
    targetTS = Date.now() + pausedRemaining;
    pausedRemaining = null;
    setStatus("");
  }
  tick();
  updateControls();
}

function resetCountdown() {
  clearTimers();
  runMode = null;
  targetTS = null;
  pausedRemaining = null;
  endReached = false;
  stopConfetti();
  render(0);
  setStatus("");
  document.title = PAGE_TITLE;
  updateControls();
}

function updateControls() {
  const mode = runMode ?? countMode;
  const running = runMode !== null && !endReached;
  const paused = pausedRemaining !== null;

  els.startBtn.disabled = running;
  els.pauseBtn.classList.toggle("hidden", mode !== "duration");
  els.pauseBtn.disabled = !running || delayTimer !== null;
  setButton(els.pauseBtn, paused ? "play" : "pause", paused ? "Resume" : "Pause");
}

els.startBtn.addEventListener("click", startCountdown);
els.pauseBtn.addEventListener("click", togglePause);
els.resetBtn.addEventListener("click", resetCountdown);

// ===== Persistence =====
const SETTINGS_KEY = "countdown.settings";

function saveSettings() {
  const data = {
    title: els.titleInput.value,
    countMode,
    target: els.target.value,
    durationMin: els.durationMin.value,
    startDelay: els.startDelay.value,
    bgUrl: els.bgUrl.value,
    dim: els.dim.value,
    blur: els.blur.value,
    showDays: els.showDays.checked,
    showHours: els.showHours.checked,
    showMinutes: els.showMinutes.checked,
    showSeconds: els.showSeconds.checked,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {}
  storeImage(bgBlob);
}

function loadSettings() {
  let d = null;
  try {
    d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
  } catch {}

  if (d) {
    els.titleInput.value = d.title ?? els.titleInput.value;
    els.target.value = d.target ?? "";
    els.durationMin.value = d.durationMin ?? "";
    els.startDelay.value = d.startDelay ?? "0";
    els.bgUrl.value = d.bgUrl ?? "";
    els.dim.value = d.dim ?? "35";
    els.blur.value = d.blur ?? "2";
    els.showDays.checked = d.showDays ?? true;
    els.showHours.checked = d.showHours ?? true;
    els.showMinutes.checked = d.showMinutes ?? true;
    els.showSeconds.checked = d.showSeconds ?? true;
    if (d.bgUrl) showBackground(d.bgUrl);
  }

  setCountMode(d?.countMode);
  applyOverlay();
  applyVisibility();

  loadImage().then((blob) => {
    if (blob instanceof Blob && !els.bgUrl.value && !bgBlob) setBackgroundBlob(blob);
  });
}

els.saveBtn.addEventListener("click", () => {
  saveSettings();
  showToast("Settings saved.");
});
els.clearBtn.addEventListener("click", () => {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {}
  storeImage(null);
  showToast("Saved settings cleared.");
});

// ===== Confetti =====
const ctx = els.canvas.getContext("2d");
let confettiRunning = false;
let confettiParticles = [];
let confettiAnimId = null;

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  els.canvas.width = Math.floor(window.innerWidth * dpr);
  els.canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Particle factory (top-fall spawn)
function makeParticle(fromTop = true) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    x: Math.random() * W,
    y: fromTop ? (Math.random() * H - H) : Math.random() * H,
    r: Math.random() * 6 + 4, // size base
    d: Math.random() * 100 + 10, // density/phase
    color: `hsl(${Math.floor(Math.random() * 360)} 90% 55%)`,
    tilt: Math.random() * 10 - 10,
    tiltAngleInc: Math.random() * 0.07 + 0.05,
    tiltAngle: 0,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 6,
    shape: (["rect", "circle", "tri", "line"])[Math.floor(Math.random() * 4)],
  };
}

function drawParticle(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.color;
  switch (p.shape) {
    case "circle":
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "tri":
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.6, p.r * 0.5);
      ctx.lineTo(0, -p.r * 0.7);
      ctx.lineTo(p.r * 0.6, p.r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case "line":
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, p.r * 0.25);
      ctx.moveTo(0, 0);
      ctx.lineTo(p.tilt, p.r);
      ctx.stroke();
      break;
    default: // rect
      ctx.fillRect(-p.r * 0.6, -p.r * 0.3, p.r, p.r * 0.6);
  }
  ctx.restore();
}

function updateParticles() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < confettiParticles.length; i++) {
    const p = confettiParticles[i];
    p.tiltAngle += p.tiltAngleInc;
    p.y += (Math.cos(p.d) + 3 + p.r / 2) * 0.5;
    p.x += Math.sin(p.d);
    p.tilt = Math.sin(p.tiltAngle) * 12;
    p.rot += p.vr * 0.016;

    drawParticle(p);

    // recycle at top when below screen
    if (p.y > H + 20) {
      confettiParticles[i] = makeParticle(true);
      confettiParticles[i].y = -10;
    }
  }
  confettiAnimId = requestAnimationFrame(updateParticles);
}

// With reduced motion the "Time's up!" status carries the moment on its own.
function startConfetti() {
  if (confettiRunning || reducedMotion.matches) return;
  confettiRunning = true;
  confettiParticles = Array.from({ length: 180 }, () => makeParticle(true));
  cancelAnimationFrame(confettiAnimId);
  confettiAnimId = requestAnimationFrame(updateParticles);
}

function stopConfetti() {
  confettiRunning = false;
  cancelAnimationFrame(confettiAnimId);
  confettiAnimId = null;
  confettiParticles = [];
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

// ===== Keyboard shortcuts =====
// Only when nothing that takes typing or its own keys has focus, so R and S
// can be typed into any field and Space still presses a focused button.
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.body.classList.contains("modal-open")) return;
  if (document.activeElement?.closest("input, textarea, select, button, [contenteditable]")) return;

  const key = e.key.toLowerCase();
  if (key === " ") {
    if (!els.startBtn.disabled) {
      e.preventDefault();
      startCountdown();
    } else if (!els.pauseBtn.disabled && !els.pauseBtn.classList.contains("hidden")) {
      e.preventDefault();
      togglePause();
    }
  } else if (key === "r") {
    resetCountdown();
  } else if (key === "s" && !els.startBtn.disabled) {
    startCountdown();
  }
});

// ===== Boot =====
function initCountdown() {
  loadSettings();

  // Pre-fill target to an hour from now for convenience
  if (!els.target.value) {
    const t = new Date(Date.now() + 3600000);
    els.target.value = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  render(0);
  updateControls();
}

function boot() {
  initTheme();
  hydrateIcons();
  updateThemeButtonIcon();
  buildThemeModal();
  wireModals();
  initCountdown();
}

boot();
