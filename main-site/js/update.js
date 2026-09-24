// Update bar (update-bar-spec.md). A new service worker downloads, installs
// and waits; nothing reloads until the reader presses Reload.

const SW_URL = "/sw.js";

// One language, so a lookup is the string itself.
const STRINGS = {
  "update.label": "Update",
  "update.ready": "A new version of Countdown Timer is ready.",
  "update.reload": "Reload",
  "update.later": "Not now",
};
const t = (key) => STRINGS[key] ?? key;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

let registration = null;
let waitingWorker = null;
let reloading = false;
// For this page view only, never stored: "Not now" means not now.
let dismissed = false;

function watchForUpdate() {
  if (!registration) return;

  // A worker already waiting when the page opened. This is the ordinary case on
  // the second page view after a deploy.
  if (registration.waiting && navigator.serviceWorker.controller) {
    waitingWorker = registration.waiting;
    render();
  }

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener("statechange", () => {
      // `installed` with no controller is a first install, which has nothing
      // to prompt about: there is no previous version on screen to protect.
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        waitingWorker = registration.waiting ?? installing;
        render();
      }
    });
  });
}

function registerWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .register(SW_URL)
    .then((reg) => {
      registration = reg;
      watchForUpdate();
    })
    .catch((cause) => {
      // A refused registration is not a reason to break the page.
      console.warn("service worker registration failed:", cause);
    });

  // Reload here rather than in the click handler, so the page comes back
  // served by the new worker and not the one being replaced. The flag stops a
  // second controllerchange from starting a reload loop.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

function render() {
  const existing = document.querySelector(".update-notice");

  if (!waitingWorker || dismissed) {
    existing?.remove();
    return;
  }

  const bar = existing ?? document.createElement("div");
  bar.className = "update-notice";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-label", t("update.label"));
  bar.innerHTML = `
    <div class="update-notice-inner">
      <p>${escapeHtml(t("update.ready"))}</p>
      <button type="button" class="btn btn-primary" data-sw-update>
        ${escapeHtml(t("update.reload"))}
      </button>
      <button type="button" class="btn btn-quiet" data-sw-later>
        ${escapeHtml(t("update.later"))}
      </button>
    </div>
  `;

  bar.querySelector("[data-sw-update]").addEventListener("click", () => {
    // The only place anything asks for skipWaiting. The reload happens on
    // controllerchange, not here.
    waitingWorker?.postMessage("skip-waiting");
  });

  bar.querySelector("[data-sw-later]").addEventListener("click", () => {
    dismissed = true;
    render();
  });

  if (!existing) document.body.prepend(bar);
}

// Registration on `load`, so precaching does not compete with the page's own
// first fetches.
if (document.readyState === "complete") registerWorker();
else window.addEventListener("load", registerWorker, { once: true });
