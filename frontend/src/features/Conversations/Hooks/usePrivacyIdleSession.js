import { useCallback, useEffect, useRef } from "react";
import api from "../../../shared/lib/api";
import { clearPrivacy, getPrivacySnapshot, getPrivacyToken, renewPrivacyAccess } from "../../../shared/lib/privacyAccess";

const BATCH_MS = 15_000;
const IDLE_MS = 300_000;

export default function usePrivacyIdleSession(enabled, rootRef) {
  const token = enabled ? getPrivacyToken() : null;
  const lifecycle = useRef({ generation: 0 });

  const lock = useCallback(() => {
    const currentToken = getPrivacySnapshot().token;
    // Clear synchronously; failed networking must never keep private UI visible.
    clearPrivacy("Locked Chats are protected.");
    if (currentToken) return api.post("/privacy/session/lock", { token: currentToken });
    return Promise.resolve();
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const lifecycleState = lifecycle.current;
    const generation = ++lifecycleState.generation;
    const root = rootRef.current;
    const controller = new AbortController();
    let timer;
    let idleTimer;
    let dirty = false;
    let inFlight = false;
    let stopped = false;
    let lastActivity = performance.now();
    let lastRequest = performance.now();

    function checkIdle() {
      if (getPrivacySnapshot().token === token && performance.now() - lastActivity >= IDLE_MS) {
        clearPrivacy("Your privacy session expired. Enter your PIN again.");
        return true;
      }
      return false;
    }

    function scheduleIdle() {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(checkIdle, IDLE_MS);
    }

    function schedule() {
      window.clearTimeout(timer);
      if (!dirty || stopped) return;
      const untilExpiry = getPrivacySnapshot().expiresAt - Date.now();
      const wait = Math.max(0, Math.min(BATCH_MS - (performance.now() - lastRequest), untilExpiry - 5000));
      timer = window.setTimeout(renew, wait);
    }

    async function renew() {
      if (stopped || inFlight || !dirty || getPrivacyToken() !== token) return;
      const inactiveMilliseconds = performance.now() - lastActivity;
      if (inactiveMilliseconds >= IDLE_MS) { clearPrivacy("Your privacy session expired. Enter your PIN again."); return; }
      dirty = false;
      inFlight = true;
      lastRequest = performance.now();
      try {
        const { data } = await api.post("/privacy/activity", { token, inactiveMilliseconds }, { signal: controller.signal });
        if (!stopped) renewPrivacyAccess(token, data.expiresAt);
      } catch {
        if (!stopped && getPrivacySnapshot().token === token) {
          // Fail closed on renewal failure. No retry heartbeat can extend idle access.
          clearPrivacy("Privacy access could not be renewed. Enter your PIN again.");
        }
      } finally {
        inFlight = false;
        if (!stopped) schedule();
      }
    }

    function onActivity(event) {
      if (!event.isTrusted || document.visibilityState === "hidden" || getPrivacyToken() !== token) return;
      if (event.type === "pointermove" && !event.buttons) return;
      if (checkIdle()) return;
      // A programmatic scroll isn't user activity. Scroll intent comes from wheel,
      // touch movement, keyboard, or a pointer interacting with the scroll area.
      lastActivity = performance.now();
      scheduleIdle();
      dirty = true;
      if (!inFlight) schedule();
    }

    function onPageHide() { void lock().catch(() => {}); }
    const events = ["pointerdown", "pointerup", "pointermove", "click", "keydown", "input", "wheel", "touchmove"];
    scheduleIdle();
    for (const name of events) root?.addEventListener(name, onActivity, { capture: true, passive: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("focus", checkIdle);
    document.addEventListener("visibilitychange", checkIdle);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(idleTimer);
      for (const name of events) root?.removeEventListener(name, onActivity, true);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", checkIdle);
      document.removeEventListener("visibilitychange", checkIdle);
      // StrictMode immediately installs a replacement effect. Only a real exit
      // revokes; each request names its old grant explicitly to avoid other tabs.
      queueMicrotask(() => {
        if (lifecycleState.generation !== generation) return;
        if (getPrivacySnapshot().token === token) clearPrivacy("Locked Chats are protected.");
        void api.post("/privacy/session/lock", { token }).catch(() => {});
      });
    };
  }, [token, rootRef, lock]);

  return lock;
}
