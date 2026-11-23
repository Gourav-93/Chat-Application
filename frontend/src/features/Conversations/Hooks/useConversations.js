/**
 * File: useConversations.js
 * Purpose: Loads conversation summaries and coalesces background refreshes.
 * Responsibilities: Serialize refreshes and restore the last successful rows and
 * unread counts from a tab cache tied to the authenticated session.
 */
import { useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AuthContext } from "../../../app/AuthContext";
import { getConversations, getConversationErrorMessage } from "../Services/ConversationService";

const REFRESH_DELAY_MS = 150;
const MAX_TIMEOUT_MS = 2_147_483_647;
const CACHE_KEY = "sandesh-conversation-snapshot";
const CACHE_VERSION = 1;
const AUTH_SESSION_KEY = "sandesh-auth-session";
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function getSessionId(token) {
  if (typeof token !== "string") return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    const payload = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const { sid } = JSON.parse(atob(payload));
    return typeof sid === "string" && SESSION_ID_PATTERN.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

function clearCachedConversations() {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage access is optional. Session scoping still protects the rows.
  }
}

const isOptionalString = (value) => value == null || typeof value === "string";

function isCacheRow(row) {
  return row && Number.isInteger(row.conversationId) && row.conversationId > 0 &&
    typeof row.otherUserId === "string" && row.otherUserId.trim() &&
    typeof row.otherUserName === "string" &&
    isOptionalString(row.otherUserMobileNumber) && isOptionalString(row.lastMessage) &&
    isOptionalString(row.lastMessageAt) && isOptionalString(row.lastMessageSenderId);
}

function toCacheRow(row) {
  return {
    conversationId: row.conversationId,
    otherUserId: row.otherUserId,
    otherUserName: row.otherUserName,
    otherUserMobileNumber: row.otherUserMobileNumber ?? null,
    lastMessage: row.lastMessage ?? null,
    lastMessageAt: row.lastMessageAt ?? null,
    lastMessageSenderId: row.lastMessageSenderId ?? null,
    unreadCount: Number.isSafeInteger(row.unreadCount) && row.unreadCount >= 0 ? row.unreadCount : null,
  };
}

function readCachedConversations(scope) {
  try {
    const saved = window.sessionStorage.getItem(CACHE_KEY);
    if (saved === null) return null;

    const cache = JSON.parse(saved);
    if (scope.sessionId && scope.expiresAt > Date.now() && cache?.version === CACHE_VERSION &&
        cache.userId === scope.userId && cache.sessionId === scope.sessionId &&
        cache.expiresAt === scope.expiresAt && Array.isArray(cache.conversations) &&
        cache.conversations.every(isCacheRow)) {
      return cache.conversations.map(toCacheRow);
    }
  } catch {
    // An unreadable snapshot is a cache miss.
  }
  clearCachedConversations();
  return null;
}

function saveCachedConversations(scope, conversations) {
  if (!scope.sessionId) return;

  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      userId: scope.userId,
      sessionId: scope.sessionId,
      expiresAt: scope.expiresAt,
      conversations: conversations.map(toCacheRow),
    }));
  } catch {
    // The live snapshot remains usable when storage is unavailable or full.
  }
}

function savedAuthMatches(scope) {
  if (!scope.sessionId || scope.expiresAt <= Date.now()) return false;

  try {
    const saved = JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY));
    return saved?.userId === scope.userId && saved.expiresAt === scope.expiresAt &&
      getSessionId(saved.token) === scope.sessionId;
  } catch {
    return false;
  }
}

export default function useConversations(refreshKey = 0) {
  const auth = useContext(AuthContext);
  const userId = auth?.isAuthenticated ? auth.user?.userId : null;
  const token = auth?.isAuthenticated ? auth.user?.token : null;
  const expiresAt = auth?.user?.expiresAt;
  const scope = useMemo(() => userId && token && Number.isFinite(expiresAt)
    ? { userId, sessionId: getSessionId(token), expiresAt } : null, [userId, token, expiresAt]);
  const [result, setResult] = useState(null);
  const workRef = useRef(null);
  const requestKey = String(refreshKey);

  useLayoutEffect(() => {
    if (!scope) {
      clearCachedConversations();
      return undefined;
    }
    const controller = new AbortController();
    const work = { controller, timer: null, pendingKey: null, running: false };
    workRef.current = work;
    const cached = readCachedConversations(scope);
    let expiryTimer;

    function checkExpiry() {
      if (controller.signal.aborted) return;
      window.clearTimeout(expiryTimer);
      const remaining = scope.expiresAt - Date.now();
      if (remaining > 0) {
        expiryTimer = window.setTimeout(checkExpiry, Math.min(remaining, MAX_TIMEOUT_MS));
        return;
      }

      controller.abort();
      window.clearTimeout(work.timer);
      clearCachedConversations();
      setResult({ scope, key: null, conversations: null, expired: true });
    }

    window.addEventListener("focus", checkExpiry);
    document.addEventListener("visibilitychange", checkExpiry);
    queueMicrotask(() => {
      checkExpiry();
      if (!controller.signal.aborted && cached !== null) {
        // A restored list is display-only until a successful server refresh.
        setResult((previous) => previous?.scope === scope ? previous
          : { scope, key: null, conversations: cached });
      }
    });

    return () => {
      controller.abort();
      window.clearTimeout(work.timer);
      window.clearTimeout(expiryTimer);
      window.removeEventListener("focus", checkExpiry);
      document.removeEventListener("visibilitychange", checkExpiry);
      workRef.current = null;
      // Session changes can unmount the dashboard before it renders signed-out state.
      if (!savedAuthMatches(scope)) clearCachedConversations();
    };
  }, [scope]);

  useLayoutEffect(() => {
    const work = workRef.current;
    if (!scope || !work) return;
    const { signal } = work.controller;
    work.pendingKey = requestKey;
    const isActive = () => !signal.aborted && scope.expiresAt > Date.now();

    // Later events replace the pending version without restarting the timer
    // or aborting the current request. A completed request drains the queue.
    function schedule() {
      if (!isActive() || work.running || work.timer !== null || work.pendingKey === null) return;
      work.timer = window.setTimeout(load, REFRESH_DELAY_MS);
    }

    async function load() {
      work.timer = null;
      if (!isActive()) return;
      const key = work.pendingKey;
      work.pendingKey = null;
      work.running = true;
      try {
        const conversations = await getConversations(signal);
        if (isActive() && work.pendingKey === null) {
          saveCachedConversations(scope, conversations);
          setResult({ scope, key, conversations, error: "" });
        }
      } catch (error) {
        if (isActive()) {
          const status = error?.response?.status;
          const accessDenied = status === 401 || status === 403;
          if (accessDenied) clearCachedConversations();
          if (accessDenied || work.pendingKey === null) {
            setResult((previous) => ({
              scope, key, accessDenied,
              conversations: !accessDenied && previous?.scope === scope ? previous.conversations : null,
              error: getConversationErrorMessage(error),
            }));
          }
        }
      } finally {
        work.running = false;
        schedule();
      }
    }

    schedule();
  }, [scope, requestKey]);

  const current = result?.scope === scope ? result : null;
  const isCurrent = current?.key === requestKey;
  const hasSnapshot = Boolean(current?.conversations);
  return {
    conversations: current?.conversations ?? [],
    isLoading: Boolean(scope) && !current?.expired && !current?.accessDenied && !isCurrent && !hasSnapshot,
    isRefreshing: Boolean(scope) && !isCurrent && hasSnapshot,
    snapshotReady: isCurrent && hasSnapshot && !current.error,
    hasSnapshot,
    accessError: current?.accessDenied ? current.error : "",
  };
}
