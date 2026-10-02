/* The big countdown: title, clock and status, filling whatever box it sits
   in. Drawn by the presenter on this device and by the other screen when
   sharing, so the two look the same. Text only ever goes in through
   textContent, since on the other screen it arrived from another device. */

export const UNITS = [
  { key: "d", ms: 86400000, label: "Days" },
  { key: "h", ms: 3600000, label: "Hours" },
  { key: "m", ms: 60000, label: "Minutes" },
  { key: "s", ms: 1000, label: "Seconds" },
];

export function pad(n) {
  return String(Math.max(0, n)).padStart(2, "0");
}

// Split into the units given. A missing unit's share rolls into the next one
// down, so hiding Days shows 49 hours rather than 1. Rounded up to the
// second, so the display reaches 00 exactly when time is up.
export function splitRemaining(ms, keys) {
  let rest = Math.ceil(Math.max(0, ms) / 1000) * 1000;
  const parts = {};
  for (const u of UNITS) {
    if (!keys.includes(u.key)) continue;
    parts[u.key] = Math.floor(rest / u.ms);
    rest -= parts[u.key] * u.ms;
  }
  return parts;
}

/* Builds the markup into `root` and returns what paintDisplay needs. */
export function createDisplay(root) {
  root.classList.add("display");
  root.innerHTML = `
    <p class="display-title"></p>
    <div class="display-clock">
      ${UNITS.map(
        (u) => `
        <div class="display-unit" data-unit="${u.key}">
          <span class="display-value">00</span>
          <span class="display-label">${u.label}</span>
        </div>`
      ).join("")}
    </div>
    <p class="display-status"></p>`;

  const units = {};
  root.querySelectorAll("[data-unit]").forEach((node) => {
    units[node.dataset.unit] = { node, value: node.querySelector(".display-value") };
  });
  return {
    root,
    title: root.querySelector(".display-title"),
    clock: root.querySelector(".display-clock"),
    status: root.querySelector(".display-status"),
    units,
  };
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/* `units` is the keys to show, in any order. Writes only what changed, since
   the other screen paints this twenty times a second. */
export function paintDisplay(view, { title, units, ms, status, done }) {
  const parts = splitRemaining(ms, units);
  let digits = 2;

  for (const u of UNITS) {
    const shown = units.includes(u.key);
    const unit = view.units[u.key];
    unit.node.hidden = !shown;
    const text = pad(parts[u.key] ?? 0);
    setText(unit.value, text);
    if (shown) digits = Math.max(digits, text.length);
  }

  // The digits are sized from these, so four units and two of them both
  // fill the width, and a three digit day count still fits its box.
  view.clock.style.setProperty("--unit-count", String(Math.max(1, units.length)));
  view.clock.style.setProperty("--digits", String(digits));
  view.clock.hidden = units.length === 0;

  setText(view.title, title);
  setText(view.status, status);
  view.status.classList.toggle("done", !!done);
}
