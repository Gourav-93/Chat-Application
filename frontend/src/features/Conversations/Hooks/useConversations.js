/**
 * File: useConversations.js
 * Purpose: Manages the signed-in user's conversation list request lifecycle.
 * Responsibilities:
 * 1. Fetch conversation summaries and expose loading, error, retry, and refresh state.
 * 2. Cancel requests and ignore late responses after cleanup or logout.
 * 3. Keep another user's or an earlier request's results out of the current UI.
 */

import { useCallback, useContext, useEffect, useState } from "react";
import { AuthContext } from "../../../app/AuthContext";
import {
  getConversations,
  getConversationErrorMessage,
} from "../Services/ConversationService";

export default function useConversations(refreshKey = 0) {
  const auth = useContext(AuthContext);
  const userId = auth?.isAuthenticated ? auth.user?.userId : null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  // A parent refresh immediately makes older list responses ineligible.
  const requestKey = userId ? userId + ":" + refreshKey + ":" + attempt : null;

  useEffect(() => {
    if (!userId) return undefined;

    const controller = new AbortController();
    let active = true;

    getConversations(controller.signal).then(
      (conversations) => {
        if (active && !controller.signal.aborted) {
          setResult({ requestKey, conversations, error: "" });
        }
      },
      (error) => {
        if (active && !controller.signal.aborted) {
          setResult({
            requestKey,
            conversations: [],
            error: getConversationErrorMessage(error),
          });
        }
      },
    );

    return () => {
      // Both guards protect against late resolutions and StrictMode cleanup.
      active = false;
      controller.abort();
    };
  }, [userId, requestKey]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const isCurrent = Boolean(requestKey && result?.requestKey === requestKey);

  // Derive loading from request identity instead of setting state in the effect.
  return {
    conversations: isCurrent ? result.conversations : [],
    isLoading: Boolean(userId) && !isCurrent,
    error: isCurrent ? result.error : "",
    retry,
  };
}
