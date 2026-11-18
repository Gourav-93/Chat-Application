/**
 * File: useConversations.js
 * Purpose: Loads conversation summaries while retaining successful background data.
 * Responsibilities: Cancel stale requests, isolate accounts, distinguish initial
 * failures from refresh errors, and expose only successful current snapshots.
 */
import { useCallback, useContext, useEffect, useState } from "react";
import { AuthContext } from "../../../app/AuthContext";
import { getConversations, getConversationErrorMessage } from "../Services/ConversationService";

export default function useConversations(refreshKey = 0) {
  const auth = useContext(AuthContext);
  const userId = auth?.isAuthenticated ? auth.user?.userId : null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = userId ? userId + ":" + refreshKey + ":" + attempt : null;

  useEffect(() => {
    if (!userId) return undefined;
    const controller = new AbortController();
    let active = true;
    getConversations(controller.signal).then(
      (conversations) => {
        if (active && !controller.signal.aborted) {
          setResult({ requestKey, userId, conversations, error: "", hasSnapshot: true });
        }
      },
      (error) => {
        if (active && !controller.signal.aborted) {
          setResult((previous) => ({
            requestKey, userId,
            conversations: previous?.userId === userId ? previous.conversations : [],
            hasSnapshot: previous?.userId === userId && previous.hasSnapshot,
            error: getConversationErrorMessage(error),
          }));
        }
      },
    );
    return () => { active = false; controller.abort(); };
  }, [userId, requestKey]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const isCurrent = Boolean(requestKey && result?.requestKey === requestKey);
  const hasSnapshot = Boolean(userId && result?.userId === userId && result.hasSnapshot);
  return {
    conversations: hasSnapshot ? result.conversations : [],
    isLoading: Boolean(userId) && !isCurrent && !hasSnapshot,
    isRefreshing: Boolean(userId) && !isCurrent && hasSnapshot,
    snapshotReady: Boolean(isCurrent && hasSnapshot && !result.error),
    error: isCurrent && !hasSnapshot ? result.error : "",
    refreshError: isCurrent && hasSnapshot ? result.error : "",
    retry,
  };
}
