/* Showing the countdown on another screen: the host's side, and the share
   sheet that starts either side. See STUN-p2p-spec.md at the repo root, and
   uwuFlash, which this follows.

   This device is the host. It runs the countdown and publishes a code; the
   other screen joins as the guest. The guest shows nothing until this device
   presses play, then shows the countdown full screen, and goes back to
   waiting when the presenter closes. The countdown being set up never leaves
   this device; only one being presented does.

   Two ways to share, picked in the sheet:

   Mirror  both screens show the countdown.
   Extend  the other screen shows the countdown and this one becomes a
           remote: the countdown smaller, with Start, Pause and Reset.

   The host is authoritative and sends a full snapshot twenty times a second.
   The guest never reads its own clock against the target: a snapshot says
   how long is left, and the guest counts down from the moment it arrived, so
   two devices whose clocks disagree still agree on the countdown.

   Snapshots carry no pictures. An uploaded background goes once, in chunks,
   to a guest that says it lacks it, so it costs its bytes once and a snapshot
   stays a few hundred bytes. A background set by URL goes as the URL. */

import { Host, generateCode, isValidCode, normaliseCode, PROTOCOL_VERSION, CODE_LENGTH } from "./p2p.js";
import { qrSvg } from "./qr.js";
import { readSetting, writeSetting } from "./store.js";
import { closeModal, openModal } from "./ui.js";
import { startViewing } from "./viewer.js";

const SNAPSHOT_MS = 50;
// A guest pings every half second. Silence for this long is a guest that
// has gone (a browser closed, a laptop lid shut) without its channel saying
// so, which can otherwise take tens of seconds.
const GUEST_SILENT_MS = 5000;

// Under PeerJS's own 16,300 byte chunk size once the message around it is
// counted, so the library never has to split a chunk of ours again.
const CHUNK_CHARS = 12000;
const BUFFER_HIGH = 1024 * 1024;

// A photograph straight off a phone is 12 megapixels and several megabytes.
// No screen this is shown on needs more than 1080p, so anything larger is
// scaled before it is sent.
const MAX_EDGE = 1920;
const KEEP_BYTES = 400 * 1024;
const PREPARED_LIMIT = 2;

const MODE_NOTES = {
  mirror: "Both screens show the countdown.",
  extend: "The other screen shows the countdown. This one shows it smaller, with Start, Pause and Reset.",
};

let frame = () => null;
let host = null;
let status = { status: "idle" };
let retriedTaken = false;
let beatTimer = null;
let shownCode = "";

const lastHeard = new Map(); // guest peer id -> last time anything arrived
let guestImages = new Set(); // image ids the guest says it holds
let offered = new Set(); // image ids sent to this guest and not yet confirmed
let pumping = false;
const prepared = new Map(); // image id -> Promise<{ mime, data }>

const el = {};

/* ---- what the rest of the app reads ---- */

export function shareMode() {
  return readSetting("shareMode") === "extend" ? "extend" : "mirror";
}

export function isHosting() {
  return host !== null;
}

export function hostStatus() {
  return status.status;
}

/* Sends the current picture now rather than on the next beat, so pressing
   play, Start or Pause reaches the other screen without the wait. */
export function shareNow() {
  if (!host || host.links.size === 0) return;
  host.send(snapshot());
  pumpImages();
}

/* ---- hosting ---- */

async function startHosting() {
  if (host) return;

  const stored = readSetting("hostCode");
  const code = isValidCode(stored) ? stored : generateCode();
  writeSetting("hostCode", code);
  writeSetting("shareRole", "host");

  const h = new Host({ maxGuests: 1 });
  host = h;
  status = { status: "connecting" };
  showCode(code);

  h.addEventListener("status", ({ detail }) => {
    if (host !== h) return;
    // Another tab, or the broker not yet releasing the id after a reload.
    // One fresh code, silently; a second collision in a row is not stale
    // state and retrying would only hammer the broker.
    if (detail.taken && !retriedTaken) {
      retriedTaken = true;
      restartWithFreshCode();
      return;
    }
    if (detail.status === "waiting") retriedTaken = false;
    status = detail;
    changed();
  });

  h.addEventListener("join", ({ detail }) => {
    if (host !== h) return;
    // A new guest, or the same screen after a reload: either way it holds no
    // pictures until it says otherwise.
    lastHeard.set(detail.id, Date.now());
    guestImages = new Set();
    offered = new Set();
  });

  h.addEventListener("leave", ({ detail }) => lastHeard.delete(detail.id));

  h.addEventListener("message", ({ detail: { message, from } }) => {
    if (host === h) onMessage(message, from);
  });

  beatTimer = setInterval(beat, SNAPSHOT_MS);
  changed();

  try {
    await h.start(code);
  } catch {
    if (host !== h) return;
    stopHosting();
    writeSetting("shareRole", null);
    status = { status: "error", message: "Could not load sharing. Check your connection." };
    changed();
  }
}

/* `tellGuest` for stopping on purpose: the guest hears `end` and says the
   sharing ended, rather than reporting a dropped connection and trying to
   come back to a code that is gone. */
function stopHosting({ tellGuest = false } = {}) {
  const h = host;
  if (!h) return;

  host = null;
  clearInterval(beatTimer);
  beatTimer = null;
  lastHeard.clear();
  status = { status: "idle" };

  if (tellGuest && h.links.size > 0) {
    h.send({ type: "end" });
    // Long enough for `end` to leave; close() tears the channel down at once.
    setTimeout(() => h.close(), 300);
  } else {
    h.close();
  }
}

function restartWithFreshCode({ tellGuest = false } = {}) {
  stopHosting({ tellGuest });
  writeSetting("hostCode", null);
  startHosting();
}

function onMessage(message, from) {
  lastHeard.set(from, Date.now());

  switch (message.type) {
    case "hello":
      if (message.v !== PROTOCOL_VERSION) {
        host.send({ type: "outdated" }, from);
        return;
      }
      host.send(snapshot(), from);
      break;
    case "have":
      guestImages = readImageList(message.images);
      guestImages.forEach((id) => offered.delete(id));
      pumpImages();
      break;
    case "bye":
      // Left on purpose, so the code is spent: one shown to a room in this
      // session should not keep working in the next.
      restartWithFreshCode();
      break;
    default:
      // `ping`, and anything from a newer build. Never thrown on.
      break;
  }
}

function readImageList(list) {
  if (!Array.isArray(list)) return new Set();
  return new Set(list.slice(0, 20).filter((id) => typeof id === "string" && id.length <= 64));
}

/* Twenty times a second: drop a guest that has gone quiet, send the
   snapshot, and keep any picture transfer moving. The snapshot is also the
   guest's heartbeat. */
function beat() {
  if (!host) return;

  const now = Date.now();
  for (const [id, link] of [...host.links]) {
    if (now - (lastHeard.get(id) ?? now) > GUEST_SILENT_MS) {
      lastHeard.delete(id);
      host.drop(link);
      host.refreshStatus();
    }
  }

  if (host.links.size === 0) return;
  host.send(snapshot());
  pumpImages();
}

/* ---- the snapshot ---- */

function snapshot() {
  const f = frame();
  const root = document.documentElement;
  const message = {
    type: "state",
    presenting: false,
    theme: { color: root.getAttribute("data-color-theme"), mode: root.getAttribute("data-mode") },
  };

  // Nothing about the countdown until play is pressed: the other screen
  // waits, and what is being set up stays on this one.
  if (f?.presenting) {
    message.presenting = true;
    message.show = {
      title: f.title,
      units: f.units,
      ms: Math.round(f.ms),
      running: f.running,
      status: f.status,
      done: f.done,
      dim: f.dim,
      blur: f.blur,
      bgUrl: f.background?.url ?? null,
      bgImage: f.background?.id ?? null,
    };
  }

  return message;
}

/* ---- the background picture ---- */

function wantedImage() {
  const f = frame();
  return f?.presenting && f.background?.blob ? f.background : null;
}

async function pumpImages() {
  if (pumping || !host) return;
  const h = host;
  const link = h.links.values().next().value;
  if (!link) return;

  const wanted = wantedImage();
  if (!wanted || guestImages.has(wanted.id) || offered.has(wanted.id)) return;
  const { id, blob } = wanted;

  pumping = true;
  offered.add(id);
  const session = offered;
  const current = () => host === h && h.links.get(link.peer) === link && offered === session;

  try {
    const { mime, data } = await preparedImage(id, blob);
    const total = Math.max(1, Math.ceil(data.length / CHUNK_CHARS));

    for (let seq = 0; seq < total; seq++) {
      // The guest may have gone, or been replaced, mid transfer. The next
      // one asks again from the start.
      while (current() && congested(link)) await wait(25);
      if (!current()) return;

      h.send(
        { type: "image", id, mime, seq, total, data: data.slice(seq * CHUNK_CHARS, (seq + 1) * CHUNK_CHARS) },
        link.peer
      );
      if (seq % 8 === 7) await wait(0);
    }
  } catch {
    // Undecodable. Left in `offered`, so it is not tried again on every
    // beat; the countdown shows without it.
  } finally {
    pumping = false;
  }
}

function congested(link) {
  return (link.dataChannel?.bufferedAmount ?? 0) > BUFFER_HIGH || (link.bufferSize ?? 0) > 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preparedImage(id, blob) {
  if (!prepared.has(id)) {
    prepared.set(id, prepareImage(blob));
    if (prepared.size > PREPARED_LIMIT) prepared.delete(prepared.keys().next().value);
  }
  return prepared.get(id);
}

async function prepareImage(blob) {
  const small = await shrink(blob);
  return { mime: small.type || blob.type || "image/png", data: await toBase64(small) };
}

async function shrink(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // SVG in some browsers, or something createImageBitmap cannot read.
    // Sent as it is; the other screen's <img> will manage.
    return blob;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && blob.size <= KEEP_BYTES) {
    bitmap.close();
    return blob;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // WebP keeps transparency and is small. Safari cannot encode it and hands
  // back a PNG instead, so JPEG is the fallback for pictures that had no
  // transparency to keep.
  let out = await toBlob(canvas, "image/webp", 0.85);
  if (out?.type !== "image/webp") {
    out = await toBlob(canvas, blob.type === "image/png" || blob.type === "image/gif" ? "image/png" : "image/jpeg", 0.85);
  }
  return out && out.size < blob.size ? out : blob;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ---- the sheet ---- */

function joinUrl(code) {
  return `${location.origin}/?join=${code}`;
}

function showCode(code) {
  if (code === shownCode) return;
  shownCode = code;

  el.code.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  el.link.textContent = joinUrl(code);
  el.qr.innerHTML = "";
  el.qr.hidden = false;

  qrSvg(joinUrl(code))
    .then((svg) => {
      if (shownCode === code) el.qr.innerHTML = svg;
    })
    .catch(() => {
      // The code and the link are on screen either way.
      if (shownCode === code) el.qr.hidden = true;
    });
}

function statusText() {
  switch (status.status) {
    case "connecting":
      return "Starting...";
    case "waiting":
      return "Waiting for the other screen to join.";
    case "connected":
      return "Connected. The other screen shows the countdown when you press play.";
    case "error":
      return status.message || "The connection failed.";
    default:
      return "";
  }
}

function renderSheet() {
  const mode = shareMode();
  el.modeButtons.forEach((btn) => {
    const active = btn.dataset.shareMode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  el.modeNote.textContent = MODE_NOTES[mode];

  el.idle.hidden = host !== null;
  el.live.hidden = host === null;
  el.status.textContent = host ? statusText() : "";
  el.startNote.hidden = host !== null || status.status !== "error";
  el.startNote.textContent = host === null && status.status === "error" ? statusText() : "";

  el.button.classList.toggle("live", host !== null);
  el.button.setAttribute("aria-label", host ? "Sharing screen" : "Share screen");
}

function changed() {
  renderSheet();
  document.dispatchEvent(new CustomEvent("uwu:sharechange"));
}

function wireSheet({ showModal, hideModal }) {
  el.button.addEventListener("click", () => {
    const last = readSetting("lastCode");
    if (!el.joinInput.value && last) el.joinInput.value = last;
    el.joinNote.hidden = true;
    renderSheet();
    showModal("shareModal");
  });

  el.modeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-share-mode]");
    if (!btn) return;
    writeSetting("shareMode", btn.dataset.shareMode === "extend" ? "extend" : "mirror");
    changed();
  });

  el.start.addEventListener("click", () => {
    status = { status: "idle" };
    startHosting();
  });

  el.newCode.addEventListener("click", () => restartWithFreshCode({ tellGuest: true }));

  el.stop.addEventListener("click", () => {
    stopHosting({ tellGuest: true });
    writeSetting("shareRole", null);
    changed();
  });

  el.joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = normaliseCode(el.joinInput.value);
    if (!isValidCode(code)) {
      el.joinNote.textContent = `A code is ${CODE_LENGTH} characters, from the other device's share sheet.`;
      el.joinNote.hidden = false;
      return;
    }

    // A device is one or the other. Joining somebody else's screen ends
    // this one's sharing, and says so to its own guest.
    if (host) {
      stopHosting({ tellGuest: true });
      changed();
    }
    hideModal("shareModal");
    startViewing(code);
  });
}

/* `getFrame` returns what the other screen should know about:
   { presenting, title, units, ms, running, status, done, dim, blur,
     background: { url } | { id, blob } | null }

   `showModal` and `hideModal` are the app's, so focus moves into the sheet
   and back the same way it does for the theme modal. */
export function initShare({ getFrame, showModal = openModal, hideModal = closeModal }) {
  frame = getFrame;

  el.button = document.getElementById("shareBtn");
  el.modeSeg = document.getElementById("shareMode");
  el.modeButtons = el.modeSeg.querySelectorAll("[data-share-mode]");
  el.modeNote = document.getElementById("shareModeNote");
  el.idle = document.getElementById("shareIdle");
  el.live = document.getElementById("shareLive");
  el.start = document.getElementById("shareStart");
  el.startNote = document.getElementById("shareStartNote");
  el.qr = document.getElementById("shareQr");
  el.code = document.getElementById("shareCode");
  el.link = document.getElementById("shareLink");
  el.status = document.getElementById("shareStatus");
  el.newCode = document.getElementById("shareNewCode");
  el.stop = document.getElementById("shareStop");
  el.joinForm = document.getElementById("joinForm");
  el.joinInput = document.getElementById("joinCode");
  el.joinNote = document.getElementById("joinNote");

  el.host = document.getElementById("shareHost");
  if (el.host) el.host.textContent = location.host;

  wireSheet({ showModal, hideModal });
  renderSheet();

  // Sharing when the page was reloaded: back on the same code, so the other
  // screen rejoins without anybody reading it out again.
  if (readSetting("shareRole") === "host") startHosting();
}
