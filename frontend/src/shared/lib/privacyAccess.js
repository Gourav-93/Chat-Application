// Capabilities exist only in this tab's memory. Never serialize this state.
let snapshot = { version: 0, token: null, expiresAt: 0, reason: "" };
let expiryTimer;
const listeners = new Set();
try { window.sessionStorage.removeItem("sandesh-conversation-snapshot"); } catch { /* Discard legacy previews. */ }

function publish(next) {
  window.clearTimeout(expiryTimer);
  snapshot = { ...next, version: snapshot.version + 1 };
  // Older releases persisted previews. Do not restore those after a privacy change.
  try { window.sessionStorage.removeItem("sandesh-conversation-snapshot"); } catch { /* Optional storage. */ }
  for (const listener of listeners) listener();
}

export function clearPrivacy(reason = "Locked Chats are protected.") {
  publish({ token: null, expiresAt: 0, reason });
}

export function setPrivacyAccess(grant) {
  const expiresAt = Date.parse(grant?.expiresAt);
  if (typeof grant?.token !== "string" || !/^[0-9A-F]{64}$/.test(grant.token) ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Invalid privacy access response.");
  publish({ token: grant.token, expiresAt, reason: "" });
  scheduleExpiry();
}

function scheduleExpiry() {
  window.clearTimeout(expiryTimer);
  expiryTimer = window.setTimeout(() => clearPrivacy("Your privacy session expired. Enter your PIN again."), Math.max(0, snapshot.expiresAt - Date.now()));
}

// Renewal preserves the privacy boundary version: history, drafts and transport
// survive activity. Only entering/leaving access creates a new boundary.
export function renewPrivacyAccess(token, expiresAtValue) {
  const expiresAt = Date.parse(expiresAtValue);
  if (snapshot.token !== token || snapshot.expiresAt <= Date.now()) return false;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    clearPrivacy("Your privacy session expired. Enter your PIN again.");
    return false;
  }
  snapshot = { ...snapshot, expiresAt };
  scheduleExpiry();
  for (const listener of listeners) listener();
  return true;
}

export const subscribePrivacy = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getPrivacySnapshot = () => snapshot;
export const getPrivacyToken = () => snapshot.expiresAt > Date.now() ? snapshot.token : null;

function checkExpiry() {
  if (snapshot.token && snapshot.expiresAt <= Date.now()) clearPrivacy("Your privacy session expired. Enter your PIN again.");
}
window.addEventListener("focus", checkExpiry);
document.addEventListener("visibilitychange", checkExpiry);
