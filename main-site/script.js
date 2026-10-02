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
import { UNITS as UNIT_SIZES, pad, splitRemaining as splitInto, createDisplay, paintDisplay } from "./js/display.js";
import { initShare, isHosting, hostStatus, shareMode, shareNow } from "./js/share.js";
import { initViewer, isViewing } from "./js/viewer.js";
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

  presentBtn: $("#presentBtn"),
  present: $("#present"),
  remoteStatus: $("#remoteStatus"),
  presentStart: $("#presentStart"),
  presentPause: $("#presentPause"),
  presentReset: $("#presentReset"),
  presentExit: $("#presentExit"),
};

const presentView = createDisplay($("#presentDisplay"));

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
  paintPresent();
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
// Names the uploaded image to a shared screen, which says by id which
// pictures it already holds. New with every image, so a swap is noticed.
let bgId = null;

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
  bgId = `bg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
const TOGGLES = { d: "showDays", h: "showHours", m: "showMinutes", s: "showSeconds" };
const UNITS = UNIT_SIZES.map((u) => ({ ...u, toggle: TOGGLES[u.key] }));

function visibleUnits() {
  return UNITS.filter((u) => els[u.toggle].checked);
}

function visibleKeys() {
  return visibleUnits().map((u) => u.key);
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
// What the clock shows, for the presenter and a shared screen.
let shownMs = 0;

// Split into the visible units. A hidden unit's share rolls into the next
// visible one down, so hiding Days shows 49 hours rather than 1.
function splitRemaining(ms) {
  return splitInto(ms, visibleKeys());
}

function render(ms) {
  shownMs = ms;
  const parts = splitRemaining(ms);
  for (const u of UNITS) {
    const text = pad(parts[u.key] ?? 0);
    if (els[u.key].textContent !== text) els[u.key].textContent = text;
  }
  paintPresent();
  return parts;
}

// Counting down live, as opposed to idle, waiting out the start delay,
// paused or finished. Only then does a shared screen count on its own
// between snapshots.
function isCounting() {
  return targetTS !== null && delayTimer === null && pausedRemaining === null && !endReached;
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
  // Not while this device is showing somebody else's countdown, which
  // brings its own confetti.
  if (!isViewing()) startConfetti();
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

  // The presenter's remote buttons follow the page's own.
  for (const [start, pause] of [[els.startBtn, els.pauseBtn], [els.presentStart, els.presentPause]]) {
    start.disabled = running;
    pause.classList.toggle("hidden", mode !== "duration");
    pause.disabled = !running || delayTimer !== null;
    setButton(pause, paused ? "play" : "pause", paused ? "Resume" : "Pause");
  }

  // Start, pause, reset and time running out reach a shared screen now,
  // not on its next beat.
  shareNow();
}

els.startBtn.addEventListener("click", startCountdown);
els.pauseBtn.addEventListener("click", togglePause);
els.resetBtn.addEventListener("click", resetCountdown);
els.presentStart.addEventListener("click", startCountdown);
els.presentPause.addEventListener("click", togglePause);
els.presentReset.addEventListener("click", resetCountdown);

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

// ===== Presenting =====
// The play button in the top bar: the title and the clock, full screen, over
// the page's own background. Escape, the exit button, or leaving fullscreen
// stops it.
let presenting = false;
let wakeLock = null;

function paintPresent() {
  if (!presenting) return;
  paintDisplay(presentView, {
    title: els.titleInput.value.trim(),
    units: visibleKeys(),
    ms: shownMs,
    status: els.status.textContent,
    done: endReached,
  });
}

/* Sharing in extend mode turns the presenter into a remote: the other
   screen has the countdown, so this one shows it smaller with the controls
   beneath it. Mirror, or not sharing at all, is the plain full screen
   countdown. */
function showPresent() {
  const remote = isHosting() && shareMode() === "extend";
  els.present.classList.toggle("remote", remote);
  if (remote) {
    els.remoteStatus.textContent =
      hostStatus() === "connected" ? "On the other screen" : "Waiting for the other screen to join";
  }
  paintPresent();
}

async function requestWakeLock() {
  if (!presenting || wakeLock) return;
  try {
    // A countdown on a wall is one nobody touches for a while.
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    wakeLock?.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    /* wake lock unsupported or refused; the screen may dim */
  }
}

async function enterPresent() {
  if (presenting) return;
  presenting = true;
  els.present.classList.remove("hidden");
  document.body.classList.add("presenting");
  showPresent();
  // Sent before the fullscreen request, so the other screen is not kept
  // waiting on this one's animation.
  shareNow();
  // Focus on the overlay itself rather than a button, so Space and R work
  // as shortcuts here instead of pressing whatever was focused.
  els.present.focus();

  // Fullscreen is a request, not a guarantee: iOS Safari refuses it outside
  // an installed PWA. The presenter is styled to fill the viewport on its
  // own, so a refusal costs the status bar and nothing else.
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* fullscreen refused, the fixed overlay still covers the page */
  }

  requestWakeLock();
}

async function exitPresent() {
  if (!presenting) return;
  presenting = false;
  els.present.classList.add("hidden");
  document.body.classList.remove("presenting");
  // The other screen goes back to waiting at once, not on the next beat.
  shareNow();
  els.presentBtn.focus();

  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});

  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      /* already out */
    }
  }
}

function wirePresenter() {
  els.presentBtn.addEventListener("click", enterPresent);
  els.presentExit.addEventListener("click", exitPresent);

  document.addEventListener("keydown", (e) => {
    if (presenting && e.key === "Escape") exitPresent();
  });

  // Leaving fullscreen by the browser's own gesture, rather than the exit
  // button, has to close the presenter too or the page is left overlaid.
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && presenting) exitPresent();
  });

  // A screen lock is dropped when the tab is hidden and is not restored on
  // its own, so a presenter who takes a call comes back to a screen that
  // dims.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestWakeLock();
  });

  // A guest joining or leaving, or the mode changing, redraws the presenter
  // between its full screen countdown and the remote.
  document.addEventListener("uwu:sharechange", () => {
    if (presenting) showPresent();
  });
}

/* What a shared screen is told about. Nothing about the countdown leaves
   this device until play is pressed. */
function shareFrame() {
  return {
    presenting,
    title: els.titleInput.value.trim(),
    units: visibleKeys(),
    ms: isCounting() ? remaining() : shownMs,
    running: isCounting(),
    status: els.status.textContent,
    done: endReached,
    dim: Number(els.dim.value),
    blur: Number(els.blur.value),
    background: sharedBackground(),
  };
}

// Only a background that is actually on screen here.
function sharedBackground() {
  if (els.bgLayer.classList.contains("hidden")) return null;
  if (bgBlob) return { id: bgId, blob: bgBlob };
  const url = els.bgUrl.value.trim();
  return url ? { url } : null;
}

// ===== Keyboard shortcuts =====
// Only when nothing that takes typing or its own keys has focus, so R and S
// can be typed into any field and Space still presses a focused button. Not
// while showing a shared countdown either, which would start or reset this
// device's own one out of sight.
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.body.classList.contains("modal-open") || isViewing()) return;
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
  wirePresenter();

  // The viewer first: a QR code link that opens this page means "be the
  // other screen", and that has to be settled before sharing resumes a host
  // session from last time.
  initViewer({
    onCelebrate: (on) => (on ? startConfetti() : stopConfetti()),
  });
  initShare({ getFrame: shareFrame, showModal, hideModal });
}

boot();
