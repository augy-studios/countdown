/* Small settings for sharing: one string each, under the app's prefix. The
   share mode, the code a host is using, the code a guest last joined, and
   which of the two this device was when the page closed. Storage that throws
   (private modes, a full quota) reads as nothing stored, which every caller
   already treats as a first visit. */

const APP_KEY = "countdown";

export function readSetting(name) {
  try {
    return localStorage.getItem(`${APP_KEY}.${name}`);
  } catch {
    return null;
  }
}

export function writeSetting(name, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(`${APP_KEY}.${name}`);
    else localStorage.setItem(`${APP_KEY}.${name}`, String(value));
  } catch {
    /* not remembered; the next visit starts fresh */
  }
}
