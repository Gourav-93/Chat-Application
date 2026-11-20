/**
 * File: useConversationActivity.js
 * Purpose: Coordinates recipient presence, transient typing, and selected-chat read receipts.
 * Responsibilities: Reuse the shared session, reject stale queued work, require
 * loaded/visible history before marking read, format legacy IST last-seen data,
 * and scope typing timers/subscriptions to the original conversation.
 */
import { useCallback, useEffect, useRef, useState } from "react";

function formatLastSeen(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$/i.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() + 1 !== Number(month) ||
      calendar.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  // Preserve explicit offsets. Offset-less PresenceService dates are IST wall time,
  // not UTC or browser-local time; trim sub-millisecond precision for Date parsing.
  const iso = value.replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(offset ? iso : iso + "+05:30");
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h12",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return part("day") + " " + part("month") + " " + part("year") + ", " +
    part("hour") + ":" + part("minute") + " " + part("dayPeriod").toLowerCase();
}

export default function useConversationActivity(selection, session, history, enabled = true) {
  const { owner, status, requiresSignIn, userId, subscribeTyping, setTyping } = session;
  const conversationId = selection?.conversation?.conversationId;
  const recipientId = selection?.conversation?.otherUserId;
  const selectionKey = conversationId ? conversationId + ":" + (selection.generation ?? 0) : null;
  const connected = Boolean(owner && status === "connected" && !requiresSignIn);
  const presence = connected && recipientId
    ? session.presence.get(recipientId.toLowerCase()) : null;
  const recipientOffline = presence?.isOnline === false;
  const [typingView, setTypingView] = useState(null);
  const typingControllerRef = useRef(null);
  const [visible, setVisible] = useState(() =>
    document.visibilityState === "visible");
  const [attempt, setAttempt] = useState(0);
  const [readVersion, setReadVersion] = useState(0);
  const [presenceError, setPresenceError] = useState(null);
  const [readError, setReadError] = useState(null);
  const mountedRef = useRef(false);
  const readsRef = useRef({ owner: null, entries: new Map() });

  useEffect(() => {
    mountedRef.current = true;
    const update = () => setVisible(document.visibilityState === "visible");
    const timer = window.setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      readsRef.current = { owner: null, entries: new Map() };
    };
  }, []);

  useEffect(() => {
    if (!connected || !recipientId) return undefined;
    let active = true;
    // The service rechecks this guard after waiting in the shared command queue.
    owner.service.getUserStatus(recipientId, () => active).then(
      () => {
        if (active) setPresenceError(null);
      },
      () => {
        if (active) setPresenceError({ owner, selectionKey,
          message: "Recipient activity could not be loaded." });
      },
    );
    return () => { active = false; };
  }, [connected, owner, recipientId, selectionKey, attempt]);

  // Receipt-only rerenders must not repeatedly issue MarkRead.
  const incomingKey = history.messages
    .filter((message) => message.receiverId.toLowerCase() === String(userId).toLowerCase() &&
      message.senderId.toLowerCase() !== String(userId).toLowerCase())
    .map((message) => message.id).join(",");
  const canRead = connected && enabled && visible && Boolean(conversationId) &&
    history.hasLoadedHistory && !history.error && !history.isLoading;

  useEffect(() => {
    if (!canRead) return undefined;
    if (readsRef.current.owner !== owner) {
      readsRef.current = { owner, entries: new Map() };
    }
    const entries = readsRef.current.entries;
    let progress = entries.get(selectionKey);
    if (!progress) {
      progress = { running: false, done: null, failed: null };
      entries.set(selectionKey, progress);
    }
    if (progress.running || progress.done === incomingKey || progress.failed === incomingKey) return undefined;
    let active = true;
    const isCurrent = () => active && document.visibilityState === "visible";
    const timer = window.setTimeout(async () => {
      if (!isCurrent()) return;
      progress.running = true;
      try {
        await owner.service.markRead(conversationId, isCurrent);
        progress.done = incomingKey;
        if (active) setReadError((previous) =>
          previous?.owner === owner && previous.selectionKey === selectionKey ? null : previous);
      } catch {
        // Superseded/hidden work is cancellation, not a failure to lock out retries.
        if (isCurrent()) {
          progress.failed = incomingKey;
          setReadError({ owner, selectionKey, message: "Read receipts could not be updated." });
        }
      } finally {
        progress.running = false;
        // A newer incoming batch may have waited for this request to settle.
        if (mountedRef.current && readsRef.current.owner === owner) {
          setReadVersion((value) => value + 1);
        }
      }
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [canRead, owner, selectionKey, conversationId, incomingKey, readVersion, attempt]);

  useEffect(() => {
    if (!connected || !enabled || !conversationId || !recipientId ||
        recipientId.toLowerCase() === String(userId).toLowerCase()) return undefined;
    let active = true;
    let outgoing = false;
    let outgoingEpoch = 0;
    let lastRefresh = -Infinity;
    let inactivityDeadline = 0;
    let inactivityTimer;
    let incoming = false;
    let receiverDeadline = 0;
    let receiverTimer;
    const scope = {};
    const inputCurrent = () => active && document.visibilityState === "visible" && document.hasFocus();

    const clearIncoming = () => {
      window.clearTimeout(receiverTimer);
      receiverDeadline = 0;
      if (!incoming) return;
      incoming = false;
      setTypingView((previous) => previous?.scope === scope && previous.active
        ? { ...previous, active: false } : previous);
    };
    const checkReceiverDeadline = () => {
      window.clearTimeout(receiverTimer);
      if (!incoming) return;
      const remaining = receiverDeadline - Date.now();
      if (remaining <= 0) clearIncoming();
      else receiverTimer = window.setTimeout(checkReceiverDeadline, remaining);
    };
    const stop = () => {
      window.clearTimeout(inactivityTimer);
      inactivityDeadline = 0;
      if (!outgoing) return;
      outgoing = false;
      const epoch = ++outgoingEpoch;
      // Stop may outlive this selection's cleanup. The session still guards its
      // transport epoch; this closure always targets the captured original ID.
      // Typing(false) is best-effort; receiver expiry covers a delayed or dropped stop.
      setTyping(conversationId, false, () => outgoingEpoch === epoch);
    };
    const checkInactivity = () => {
      window.clearTimeout(inactivityTimer);
      if (!outgoing) return;
      const remaining = inactivityDeadline - Date.now();
      if (!inputCurrent() || remaining <= 0) stop();
      else inactivityTimer = window.setTimeout(checkInactivity, remaining);
    };
    const input = (value) => {
      if (!inputCurrent() || typeof value !== "string" || !value.trim()) {
        stop();
        return;
      }
      const now = Date.now();
      if (!outgoing) {
        outgoing = true;
        outgoingEpoch++;
        lastRefresh = -Infinity;
      }
      inactivityDeadline = now + 1100;
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(checkInactivity, 1100);
      if (now - lastRefresh < 800) return;
      lastRefresh = now;
      const epoch = outgoingEpoch;
      setTyping(conversationId, true, () =>
        inputCurrent() && outgoing && outgoingEpoch === epoch &&
        Date.now() < inactivityDeadline);
    };
    const controller = { owner, selectionKey, input, stop };
    typingControllerRef.current = controller;
    // Re-run on connected transitions: session subscriptions are invalidated on
    // disconnect even when the dashboard and selected conversation stay mounted.
    const unsubscribe = subscribeTyping(conversationId, recipientId, (event) => {
      if (!active || recipientOffline || event.conversationId !== conversationId ||
          event.userId.toLowerCase() !== recipientId.toLowerCase() ||
          event.userId.toLowerCase() === String(userId).toLowerCase()) return;
      if (!event.isTyping) {
        clearIncoming();
        return;
      }
      receiverDeadline = Date.now() + 3000;
      if (!incoming) {
        incoming = true;
        setTypingView({ owner, selectionKey, scope, active: true });
      }
      checkReceiverDeadline();
    }, () => active);

    const handleVisibility = () => {
      if (!inputCurrent()) stop();
      // Background timers can be delayed: never revive an expired indicator.
      checkReceiverDeadline();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("blur", handleVisibility);
    return () => {
      active = false;
      stop();
      unsubscribe();
      clearIncoming();
      window.clearTimeout(inactivityTimer);
      window.clearTimeout(receiverTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("blur", handleVisibility);
      if (typingControllerRef.current === controller) typingControllerRef.current = null;
    };
  }, [connected, enabled, owner, conversationId, recipientId, selectionKey,
    userId, recipientOffline, subscribeTyping, setTyping]);

  // Bound callbacks cannot act on a newer selection's controller.
  const onTypingInput = useCallback((value) => {
    const controller = typingControllerRef.current;
    if (controller?.owner === owner && controller.selectionKey === selectionKey) controller.input(value);
  }, [owner, selectionKey]);
  const stopTyping = useCallback(() => {
    const controller = typingControllerRef.current;
    if (controller?.owner === owner && controller.selectionKey === selectionKey) controller.stop();
  }, [owner, selectionKey]);

  const retry = useCallback(() => {
    const progress = readsRef.current.entries.get(selectionKey);
    if (progress) progress.failed = null;
    setPresenceError(null);
    setReadError(null);
    setAttempt((value) => value + 1);
  }, [selectionKey]);

  const lookupError = presenceError?.owner === owner && presenceError.selectionKey === selectionKey
    ? presenceError.message : "";
  const acknowledgementError = readError?.owner === owner && readError.selectionKey === selectionKey
    ? readError.message : "";
  let label = "Activity unavailable";
  if (connected) {
    if (!presence) label = lookupError ? "Activity unavailable" : "Checking activity...";
    else if (presence.isOnline) label = "Online";
    else {
      const lastSeen = formatLastSeen(presence.lastSeenAt);
      label = lastSeen ? "Last seen " + lastSeen : "Offline";
    }
  }
  const isTyping = Boolean(connected && enabled && !recipientOffline &&
    typingView?.owner === owner && typingView.selectionKey === selectionKey && typingView.active);
  return { label: isTyping ? "typing..." : label, isTyping, onTypingInput, stopTyping,
    error: acknowledgementError || (!presence ? lookupError : ""), retry };
}
