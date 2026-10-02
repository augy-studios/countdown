/* The other screen: the guest's side of sharing. See STUN-p2p-spec.md at the
   repo root, and share.js for the host's side.

   A full screen overlay over the app. It joins a host by code, then waits on
   a plain screen until the host presses play; from then on it shows the
   host's countdown, in the host's colours and over the host's background,
   and goes back to waiting when the host stops. It never touches this
   device's own countdown, settings or saved theme: a received picture is
   held in memory only, and the colours go back to this device's own when it
   leaves.

   The time left comes from the host in every snapshot. Between snapshots
   this screen counts down from the moment the last one arrived, so a wifi
   stall does not freeze the seconds, and a device whose clock is wrong
   still shows the right time left.

   Everything that arrives is input from another device, so it is checked
   field by field before it is used, and none of it goes near innerHTML. */

import { Guest, normaliseCode, isValidCode } from "./p2p.js";
import { UNITS, createDisplay, paintDisplay } from "./display.js";
import { COLOR_THEMES, initTheme, showColorTheme } from "./theme.js";
import { readSetting, writeSetting } from "./store.js";

// Measured in time, not missed snapshots: at twenty a second, three missed
// is shorter than an ordinary wifi stall.
const STALE_MS = 2000;
// Paints between snapshots, and pings the host so it can notice a screen
// that has gone.
const BEAT_MS = 250;
const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 30000;

const MAX_IMAGES = 2;
const MAX_INCOMING = 2;
const MAX_CHUNKS = 1000;
const MAX_CHUNK_CHARS = 16000;
const MAX_TITLE = 80;
const MAX_STATUS = 80;
const MAX_URL = 2048;
// A hundred years, well past anything a date picker offers.
const MAX_MS = 100 * 365 * 86400000;
const IMAGE_ID = /^bg-[a-z0-9]{1,40}$/;
const IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp", "image/svg+xml",
]);
const UNIT_KEYS = UNITS.map((u) => u.key);

const COPY = {
  unreachable:
    "Could not reach the other device. Both have to be on the same network: join the same wifi, or turn on a hotspot on one and join it from the other. Check the code is still the one on screen.",
  load: "Could not load sharing. Check your connection.",
};

const el = {};
let view = null;
let celebrate = () => {};
let open = false;
let guest = null;
let code = "";
let status = "idle";
let failure = "";
let ended = false;
let outdated = false;

// After a connection that was working drops, keep trying quietly rather
// than showing a failure: the usual cause is the host's phone locking, and
// it comes back.
let resuming = false;
let retryTimer = null;
let retryDelay = RETRY_FIRST_MS;

let state = null;
let lastStateAt = 0;
let beatTimer = null;
let wakeLock = null;

const images = new Map(); // image id -> object URL, oldest first
const incoming = new Map(); // image id -> { mime, total, parts, count }
let showing = false;
let celebrating = false;
let bgSrc = "";

/* ---- joining ---- */

export function startViewing(input) {
  const next = normaliseCode(input);
  if (!isValidCode(next)) return false;

  code = next;
  writeSetting("lastCode", code);
  writeSetting("shareRole", "guest");

  ended = false;
  outdated = false;
  resuming = false;
  retryDelay = RETRY_FIRST_MS;
  state = null;
  showNothing();
  openViewer();
  join();
  return true;
}

async function join() {
  clearTimeout(retryTimer);
  retryTimer = null;

  const old = guest;
  guest = null;
  old?.close();

  const g = new Guest();
  guest = g;
  status = "connecting";
  failure = "";
  renderPanel();

  g.addEventListener("status", ({ detail }) => {
    if (guest === g) onStatus(detail);
  });
  g.addEventListener("message", ({ detail: { message } }) => {
    if (guest === g) onMessage(message);
  });

  try {
    await g.connect(code);
  } catch {
    if (guest !== g) return;
    guest = null;
    onStatus({ status: "error", message: COPY.load });
  }
}

function onStatus(detail) {
  switch (detail.status) {
    case "connecting":
      status = "connecting";
      break;
    case "connected":
      status = "connected";
      resuming = false;
      retryDelay = RETRY_FIRST_MS;
      lastStateAt = Date.now();
      // A picture kept from before a reconnect is still good.
      sendHave();
      break;
    case "dropped":
      status = "dropped";
      resuming = true;
      scheduleRetry();
      break;
    case "unreachable":
      status = "unreachable";
      if (resuming) scheduleRetry();
      break;
    case "error":
      status = "error";
      failure = detail.message || "The connection failed.";
      if (resuming) scheduleRetry();
      break;
    default:
      return;
  }
  renderPanel();
}

function scheduleRetry() {
  if (!open) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(join, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
}

function hangUp() {
  const g = guest;
  guest = null;
  g?.close();
  status = "idle";
}

function onMessage(message) {
  switch (message.type) {
    case "state":
      state = readState(message);
      lastStateAt = Date.now();
      wearTheme(state.theme);
      apply();
      break;
    case "image":
      receiveImage(message);
      break;
    case "end":
      // The host stopped on purpose. Its code is gone, so there is nothing
      // to come back to.
      ended = true;
      state = null;
      clearTimeout(retryTimer);
      resuming = false;
      hangUp();
      apply();
      break;
    case "outdated":
      outdated = true;
      hangUp();
      break;
    default:
      // Anything from a newer build. Never thrown on.
      return;
  }
  renderPanel();
}

function sendHave() {
  guest?.send({ type: "have", images: [...images.keys()] });
}

/* ---- checking what arrives ---- */

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function readState(message) {
  const theme = {
    color: COLOR_THEMES.some((t) => t.id === message.theme?.color) ? message.theme.color : COLOR_THEMES[0].id,
    mode: message.theme?.mode === "dark" ? "dark" : "light",
  };
  const show = message.presenting === true ? readShow(message.show) : null;
  return { presenting: show !== null, show, theme };
}

function readShow(s) {
  if (!s || typeof s !== "object") return null;

  const listed = Array.isArray(s.units) ? s.units.slice(0, UNIT_KEYS.length * 2) : [];
  const ms = Number.isFinite(s.ms) ? clamp(s.ms, 0, MAX_MS) : 0;

  return {
    title: typeof s.title === "string" ? s.title.slice(0, MAX_TITLE) : "",
    // In this device's order, whatever order they came in.
    units: UNIT_KEYS.filter((key) => listed.includes(key)),
    ms,
    running: s.running === true,
    // Counted from arrival, not from the host's clock; see the top of the file.
    endsAt: Date.now() + ms,
    status: typeof s.status === "string" ? s.status.slice(0, MAX_STATUS) : "",
    done: s.done === true,
    dim: Number.isFinite(s.dim) ? clamp(Math.round(s.dim), 0, 90) : 35,
    blur: Number.isFinite(s.blur) ? clamp(Math.round(s.blur), 0, 18) : 2,
    bgUrl: readUrl(s.bgUrl),
    bgImage: typeof s.bgImage === "string" && IMAGE_ID.test(s.bgImage) ? s.bgImage : null,
  };
}

// A web address only. Anything else (javascript:, data:, a blob: URL that
// means nothing on this device) is dropped.
function readUrl(value) {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function receiveImage(m) {
  if (
    typeof m.id !== "string" || !IMAGE_ID.test(m.id) ||
    !IMAGE_TYPES.has(m.mime) ||
    !Number.isInteger(m.total) || m.total < 1 || m.total > MAX_CHUNKS ||
    !Number.isInteger(m.seq) || m.seq < 0 || m.seq >= m.total ||
    typeof m.data !== "string" || m.data.length > MAX_CHUNK_CHARS
  ) {
    return;
  }
  if (images.has(m.id)) return;

  let entry = incoming.get(m.id);
  if (!entry || entry.total !== m.total || entry.mime !== m.mime) {
    entry = { mime: m.mime, total: m.total, parts: new Array(m.total), count: 0 };
    incoming.set(m.id, entry);
    // Bounded, so a host that starts transfers and never finishes them
    // cannot fill this device's memory.
    while (incoming.size > MAX_INCOMING) incoming.delete(incoming.keys().next().value);
  }

  if (entry.parts[m.seq] === undefined) {
    entry.parts[m.seq] = m.data;
    entry.count++;
  }
  if (entry.count < entry.total) return;

  incoming.delete(m.id);
  let url;
  try {
    const binary = atob(entry.parts.join(""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    url = URL.createObjectURL(new Blob([bytes], { type: entry.mime }));
  } catch {
    return;
  }

  images.set(m.id, url);
  evictImages();
  sendHave();
  apply();
}

// Oldest first, never the one on screen.
function evictImages() {
  for (const [id, url] of images) {
    if (images.size <= MAX_IMAGES) break;
    if (url === bgSrc) continue;
    URL.revokeObjectURL(url);
    images.delete(id);
  }
}

/* ---- drawing ---- */

function wearTheme({ color, mode }) {
  const root = document.documentElement;
  if (root.getAttribute("data-color-theme") !== color) showColorTheme(color);
  if (root.getAttribute("data-mode") !== mode) root.setAttribute("data-mode", mode);
}

function apply() {
  const show = state?.presenting ? state.show : null;
  if (!show) {
    if (showing) showNothing();
    return;
  }

  if (!showing) {
    showing = true;
    el.viewer.classList.add("showing");
  }

  const ms = show.running ? Math.max(0, show.endsAt - Date.now()) : show.ms;
  paintDisplay(view, { title: show.title, units: show.units, ms, status: show.status, done: show.done });

  el.viewer.style.setProperty("--bg-dim", `${show.dim}%`);
  el.viewer.style.setProperty("--bg-blur", `${show.blur}px`);
  setBackground(show.bgImage ? images.get(show.bgImage) ?? "" : show.bgUrl ?? "");

  if (show.done !== celebrating) {
    celebrating = show.done;
    celebrate(celebrating);
  }
}

// Revealed on load, so a broken URL never flashes an empty frame, and an
// uploaded picture still on its way shows the plain colour until it lands.
function setBackground(src) {
  if (src === bgSrc) return;
  bgSrc = src;
  if (!src) {
    el.bg.classList.add("hidden");
    el.bgImg.removeAttribute("src");
    return;
  }
  el.bgImg.src = src;
}

function showNothing() {
  showing = false;
  if (!el.viewer) return;
  el.viewer.classList.remove("showing");
  setBackground("");
  if (celebrating) {
    celebrating = false;
    celebrate(false);
  }
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function renderPanel() {
  if (!open) return;

  const stale = status === "connected" && Date.now() - lastStateAt > STALE_MS;
  const readable = `${code.slice(0, 3)} ${code.slice(3)}`;
  let title;
  let message;
  let actions = ["leave"];
  let badge = "";

  if (ended) {
    title = "Sharing ended";
    message = "The other device stopped sharing.";
  } else if (outdated) {
    title = "Different versions";
    message = "These two devices are running different versions of Countdown Timer. Reload the page on both.";
  } else if (resuming) {
    title = "Reconnecting";
    message = "Lost the connection to the other device. Trying again...";
    badge = "Reconnecting...";
  } else if (status === "unreachable") {
    title = "Could not connect";
    message = COPY.unreachable;
    actions = ["retry", "leave"];
  } else if (status === "error") {
    title = "Could not connect";
    message = failure;
    actions = ["retry", "leave"];
  } else if (status === "connected") {
    title = "Ready";
    message = stale
      ? "Not hearing from the other device. It may be asleep or out of range."
      : `Joined ${readable}. The countdown appears here when the other device presses play.`;
    actions = ["fullscreen", "leave"];
    if (stale) badge = "Connection looks stale";
  } else {
    title = "Connecting";
    message = `Joining ${readable}...`;
  }

  setText(el.title, title);
  setText(el.message, message);
  el.retry.hidden = !actions.includes("retry");
  el.fullscreen.hidden = !actions.includes("fullscreen") || !document.fullscreenEnabled || !!document.fullscreenElement;
  el.leave.textContent = ended || outdated ? "Back to my countdown" : "Leave";

  // The badge only matters over the countdown; without it, the panel says it.
  const showBadge = badge !== "" && showing;
  el.badge.hidden = !showBadge;
  setText(el.badge, showBadge ? badge : "");
}

/* ---- the overlay ---- */

function openViewer() {
  if (open) return;
  open = true;
  el.viewer.classList.remove("hidden");
  document.body.classList.add("viewing");
  beatTimer = setInterval(beat, BEAT_MS);
  requestWakeLock();
  el.leave.focus();
}

// Four times a second: the ping the host uses to notice a screen that has
// gone, the countdown between snapshots, and the staleness check.
function beat() {
  guest?.send({ type: "ping" });
  apply();
  renderPanel();
}

export function leaveViewer() {
  clearTimeout(retryTimer);
  retryTimer = null;
  resuming = false;

  const g = guest;
  guest = null;
  if (g?.status === "connected") g.leave();
  else g?.close();

  writeSetting("shareRole", null);
  writeSetting("lastCode", null);

  clearInterval(beatTimer);
  beatTimer = null;
  state = null;
  showNothing();
  images.forEach((url) => URL.revokeObjectURL(url));
  images.clear();
  incoming.clear();
  status = "idle";
  ended = false;
  outdated = false;

  open = false;
  el.viewer.classList.add("hidden");
  document.body.classList.remove("viewing");
  releaseWakeLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

  // Back to this device's own colours, which were never overwritten.
  initTheme();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch {
    /* refused, as on iOS Safari outside an installed app; the overlay still fills the page */
  }
  renderPanel();
}

async function requestWakeLock() {
  if (!open || wakeLock) return;
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    wakeLock?.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    /* unsupported or refused; the screen may dim */
  }
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
}

export function isViewing() {
  return open;
}

/* `onCelebrate(true)` when the host's countdown reaches zero, and
   `onCelebrate(false)` when that moment is over: the app's confetti. */
export function initViewer({ onCelebrate } = {}) {
  if (onCelebrate) celebrate = onCelebrate;

  el.viewer = document.getElementById("viewer");
  el.bg = document.getElementById("viewerBg");
  el.bgImg = document.getElementById("viewerBgImg");
  el.title = document.getElementById("viewerTitle");
  el.message = document.getElementById("viewerMessage");
  el.badge = document.getElementById("viewerBadge");
  el.retry = document.getElementById("viewerRetry");
  el.fullscreen = document.getElementById("viewerFullscreen");
  el.leave = document.getElementById("viewerLeave");
  view = createDisplay(document.getElementById("viewerDisplay"));

  el.bgImg.addEventListener("load", () => {
    if (bgSrc) el.bg.classList.remove("hidden");
  });
  el.bgImg.addEventListener("error", () => el.bg.classList.add("hidden"));

  el.retry.addEventListener("click", () => {
    retryDelay = RETRY_FIRST_MS;
    join();
  });
  el.fullscreen.addEventListener("click", toggleFullscreen);
  el.leave.addEventListener("click", leaveViewer);
  document.getElementById("viewerFullscreenCorner").addEventListener("click", toggleFullscreen);
  document.getElementById("viewerExit").addEventListener("click", leaveViewer);
  document.addEventListener("fullscreenchange", renderPanel);

  // The browser drops a wake lock when the page is hidden, and a channel
  // often dies with a backgrounded page. Both come back here.
  document.addEventListener("visibilitychange", () => {
    if (!open || document.visibilityState !== "visible") return;
    requestWakeLock();
    if (resuming && retryTimer !== null) join();
  });

  // The QR code's link, or the screen this device was last showing. The
  // code is taken out of the address bar once read, so a reload comes back
  // through the remembered code instead, and a leave is not undone by one.
  const params = new URLSearchParams(location.search);
  const linked = params.get("join");
  if (linked !== null) {
    params.delete("join");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }

  const remembered = readSetting("shareRole") === "guest" ? readSetting("lastCode") : null;
  const initial = isValidCode(linked) ? linked : remembered;
  if (isValidCode(initial)) startViewing(initial);
}
