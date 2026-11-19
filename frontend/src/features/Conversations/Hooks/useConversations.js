/**
 * File: useConversations.js
 * Purpose: Loads conversation summaries and coalesces background refreshes.
 * Responsibilities: Isolate account snapshots, serialize requests, and retain
 * the last successful rows and unread counts through refresh failures.
 */
import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AuthContext } from "../../../app/AuthContext";
import { getConversations, getConversationErrorMessage } from "../Services/ConversationService";

const REFRESH_DELAY_MS = 150;

export default function useConversations(refreshKey = 0) {
  const auth = useContext(AuthContext);
  const userId = auth?.isAuthenticated ? auth.user?.userId : null;
  const token = auth?.isAuthenticated ? auth.user?.token : null;
  const scope = useMemo(() => userId && token ? { userId } : null, [userId, token]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const workRef = useRef(null);
  const requestKey = `${refreshKey}:${attempt}`;

  useLayoutEffect(() => {
    if (!scope) return undefined;
    const controller = new AbortController();
    const work = { controller, timer: null, pendingKey: null, running: false };
    workRef.current = work;

    return () => {
      controller.abort();
      window.clearTimeout(work.timer);
      workRef.current = null;
    };
  }, [scope]);

  useLayoutEffect(() => {
    const work = workRef.current;
    if (!work) return;
    const { signal } = work.controller;
    work.pendingKey = requestKey;

    // Later events replace the pending version without restarting the timer
    // or aborting the current request. A completed request drains the queue.
    function schedule() {
      if (signal.aborted || work.running || work.timer !== null || work.pendingKey === null) return;
      work.timer = window.setTimeout(load, REFRESH_DELAY_MS);
    }

    async function load() {
      work.timer = null;
      const key = work.pendingKey;
      work.pendingKey = null;
      work.running = true;
      const isLatest = () => !signal.aborted && work.pendingKey === null;

      try {
        const conversations = await getConversations(signal);
        if (isLatest()) setResult({ scope, key, conversations, error: "" });
      } catch (error) {
        if (isLatest()) {
          setResult((previous) => ({
            scope, key,
            conversations: previous?.scope === scope ? previous.conversations : null,
            error: getConversationErrorMessage(error),
          }));
        }
      } finally {
        work.running = false;
        schedule();
      }
    }

    schedule();
  }, [scope, requestKey]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const current = result?.scope === scope ? result : null;
  const isCurrent = current?.key === requestKey;
  const hasSnapshot = Boolean(current?.conversations);
  return {
    conversations: current?.conversations ?? [],
    isLoading: Boolean(scope) && !isCurrent && !hasSnapshot,
    isRefreshing: Boolean(scope) && !isCurrent && hasSnapshot,
    snapshotReady: isCurrent && hasSnapshot && !current.error,
    unreadCountsAvailable: hasSnapshot,
    error: isCurrent && !hasSnapshot ? current.error : "",
    refreshError: isCurrent && hasSnapshot ? current.error : "",
    retry,
  };
}
