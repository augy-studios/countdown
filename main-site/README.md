# main-site

The Countdown Timer site, served at
[countdown.uwuapps.org](https://countdown.uwuapps.org/). Plain HTML, CSS and
ES modules: no build step and no dependencies. This folder is deployed as-is.

## Files

| Path | What it does |
|---|---|
| `index.html` | The only page. Its `<head>` includes the pre-paint theme script. |
| `style.css` | Theme tokens and primitives from `uwuapps-theme.md` at the top, app styles below. |
| `script.js` | Entry module: theme modal wiring, the countdown, background image, settings, confetti, shortcuts. |
| `js/theme.js` | Brand colours and light, dark or time-based mode. |
| `js/icons.js` | Inline SVG icons, used as `data-icon="name"`. |
| `js/ui.js` | `hydrateIcons`, `openModal`, `closeModal`. |
| `js/update.js` | Registers the service worker and draws the update bar. |
| `sw.js` | Service worker: offline cache and update handling. |
| `manifest.json` | PWA manifest. |
| `images/` | Manifest screenshots (1080x2340 narrow, 1920x1080 wide). |
| `api/` | Meant for Vercel serverless functions. Unused; remove if not required. |
| `.well-known/assetlinks.json` | Links the Android app `org.uwuapps.countdown` to this domain. |
| `vercel.json` | Vercel config: `cleanUrls`, `sin1` region. |

## Running locally

Serve this folder over `localhost`. Opening `index.html` from disk will not
work, because modules and service workers need an http origin.

```sh
npx serve main-site
```

The service worker caches the site aggressively. While editing, either tick
**Update on reload** under DevTools, Application, Service workers, or bump
`VERSION` in `sw.js` and use the update bar.

## Releasing

**Bump `VERSION` in `sw.js` on every deploy that changes any file.** The
browser only notices an update when `sw.js` itself changes, so without the
bump nobody gets the new version.

After a deploy, a returning visitor sees *"A new version of Countdown Timer is
ready."* with **Reload** and **Not now**. Nothing reloads until they press
Reload. Keep it that way:

- `skipWaiting()` and `clients.claim()` are only ever called from the
  `skip-waiting` message handler in `sw.js`. Never add them to `install` or
  `activate`.
- If you add a file the page needs, add it to `ASSETS` in `sw.js` so it works
  offline.

See [`update-bar-spec.md`](../update-bar-spec.md) for the reasoning.

## Offline

- The page shell and every file in `ASSETS` are precached into a cache named
  after `VERSION`. Old caches are deleted when a new version takes over.
- Navigations to `/` are served from the cache, so the app opens offline.
- Google Fonts (Jua) are cached on first use. The stylesheet link has
  `crossorigin` so its response can be cached.
- Analytics, ads and background image URLs go to the network and are never
  cached. An uploaded background image is stored in IndexedDB, so it does
  work offline.

## Theme

Follows [`uwuapps-theme.md`](../uwuapps-theme.md) exactly, with the
time-based mode option. In short:

- Colours come from CSS variables only. No hardcoded hex values in component
  CSS; the footer heart is the one allowed exception.
- Jua everywhere, inline SVG icons, no emoji, no em dashes, no gradients.
- Light mode is the default. The OS dark preference is ignored until the
  person picks a mode.
- The daylight hours (09:00 to 18:00) appear in both `js/theme.js` and the
  pre-paint script in `index.html`. Change them together.

## Stored data

Everything stays in the visitor's browser. Nothing is sent anywhere.

| Where | Key | Holds |
|---|---|---|
| localStorage | `countdown.colorTheme` | Brand colour id |
| localStorage | `countdown.mode` | Mode preference: `light`, `dark` or `time` |
| localStorage | `countdown.settings` | Title, timing, background URL, dim, blur, visible units |
| IndexedDB `countdown` | `files` / `background` | Uploaded background image |

Settings save when the person presses Start or Save settings. Clear saved
removes the settings and the stored image. It does not change the theme.

## Keyboard shortcuts

Shortcuts are ignored while a field or button has focus, or while the theme
modal is open.

| Key | Action |
|---|---|
| Space | Start, or pause and resume a duration |
| S | Start |
| R | Reset |
| Esc | Close the theme modal |
