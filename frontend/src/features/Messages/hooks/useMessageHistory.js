/**
 * File: useMessageHistory.js
 * Purpose: Loads selected-conversation history through the existing SignalR service.
 * Responsibilities:
 * 1. Publish session-scoped service readiness and clean up replaced owners.
 * 2. Ignore stale selections and retain successful pages during older-page retries.
 * 3. Deduplicate and order messages, with 30-message pages and explicit UI states.
 */

import { useCallback, useContext, useEffect, useState } from "react";
import { AuthContext } from "../../../app/AuthContext";
import { createMessageHistoryService } from "../services/MessageHistoryService";

const PAGE_SIZE = 30;
const EMPTY_MESSAGES = [];

// Selection is the dashboard's { conversation, generation } object.
export default function useMessageHistory(selection) {
  const auth = useContext(AuthContext);
  const token = auth?.isAuthenticated ? auth.user?.token : null;
  const userId = auth?.user?.userId;
  const expiresAt = auth?.user?.expiresAt;
  const validSession = Boolean(
    typeof token === "string" && token.trim() &&
    typeof userId === "string" && userId &&
    Number.isFinite(expiresAt),
  );

  const [owner, setOwner] = useState(null);
  const [expiredOwner, setExpiredOwner] = useState(null);
  const [result, setResult] = useState(null);
  const [ticket, setTicket] = useState(null);

  const ownerReady = Boolean(
    validSession && owner?.token === token &&
    owner.userId === userId && owner.expiresAt === expiresAt,
  );
  const expired = ownerReady && expiredOwner === owner;
  const conversationId = selection?.conversation?.conversationId;
  const selectionKey = conversationId
    ? conversationId + ":" + (selection.generation ?? 0)
    : null;
  const ticketMatches = ownerReady &&
    ticket?.owner === owner && ticket.selectionKey === selectionKey;
  const page = ticketMatches ? ticket.page : 1;
  const attempt = ticketMatches ? ticket.attempt : 0;
  const requestKey = selectionKey + ":" + page + ":" + attempt;

  useEffect(() => {
    if (!validSession) return undefined;

    const service = createMessageHistoryService(token, expiresAt);
    const nextOwner = { service, token, userId, expiresAt };
    let active = true;
    let expiryTimer;

    // Publishing readiness reruns the request effect; it cannot miss startup.
    // StrictMode cleanup prevents its discarded owner from being published.
    Promise.resolve().then(() => {
      if (active) setOwner(nextOwner);
    });

    const checkExpiry = () => {
      if (!active) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setExpiredOwner(nextOwner);
        void service.dispose();
      } else {
        expiryTimer = window.setTimeout(
          checkExpiry, Math.min(remaining, 2147483647),
        );
      }
    };
    expiryTimer = window.setTimeout(checkExpiry, 0);

    return () => {
      active = false;
      window.clearTimeout(expiryTimer);
      // The service gates replacement connections on complete transport cleanup.
      void service.dispose();
    };
  }, [validSession, token, userId, expiresAt]);

  useEffect(() => {
    if (!ownerReady || expired || !conversationId) return undefined;
    let active = true;

    owner.service.request(conversationId, page, PAGE_SIZE, () => active).then(
      (messages) => {
        if (!active) return;
        setResult((previous) => {
          const same = previous?.owner === owner &&
            previous.selectionKey === selectionKey;
          const prior = page > 1 && same
            ? previous.messages
            : EMPTY_MESSAGES;
          const unique = new Map(
            [...messages, ...prior].map((message) => [message.id, message]),
          );
          return {
            owner,
            selectionKey,
            requestKey,
            messages: [...unique.values()].sort((a, b) =>
              Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id - b.id,
            ),
            loadedPage: page,
            hasMore: messages.length === PAGE_SIZE,
            error: "",
          };
        });
      },
      (error) => {
        if (!active) return;
        setResult((previous) => {
          const same = previous?.owner === owner &&
            previous.selectionKey === selectionKey;
          return {
            owner,
            selectionKey,
            requestKey,
            messages: same && page > 1
              ? previous.messages
              : EMPTY_MESSAGES,
            loadedPage: same && page > 1 ? previous.loadedPage : 0,
            hasMore: same && page > 1 ? previous.hasMore : false,
            error: error?.message || "Unable to load message history.",
          };
        });
      },
    );

    // Drain invoked requests in the service, but never display stale results.
    return () => { active = false; };
  }, [
    ownerReady, owner, expired, conversationId,
    selectionKey, requestKey, page,
  ]);

  const sameSelection = Boolean(
    ownerReady && selectionKey && result?.owner === owner &&
    result.selectionKey === selectionKey,
  );
  const complete = sameSelection && result.requestKey === requestKey;
  const loading = Boolean(
    validSession && conversationId && !expired &&
    (!ownerReady || !complete),
  );
  const messages = sameSelection && !expired
    ? result.messages
    : EMPTY_MESSAGES;
  const error = !validSession
    ? "Your session could not be authorized. Please sign in again."
    : expired
      ? "Your session has expired. Please sign in again."
      : complete ? result.error : "";

  const retry = useCallback(() => {
    if (!ownerReady || expired || !conversationId || loading) return;
    // Preserve the failed page while assigning a new request attempt.
    setTicket((previous) => ({
      owner,
      selectionKey,
      page,
      attempt: previous?.owner === owner &&
        previous.selectionKey === selectionKey
        ? previous.attempt + 1
        : 1,
    }));
  }, [ownerReady, expired, conversationId, loading, owner, selectionKey, page]);

  const loadOlder = useCallback(() => {
    if (!loading && !expired && sameSelection &&
        result.hasMore && !result.error) {
      setTicket({
        owner,
        selectionKey,
        page: result.loadedPage + 1,
        attempt: 0,
      });
    }
  }, [loading, expired, sameSelection, result, owner, selectionKey]);

  return {
    messages,
    isLoading: loading && page === 1,
    isLoadingOlder: loading && page > 1,
    isEmpty: Boolean(conversationId && complete && !expired &&
      !error && messages.length === 0),
    hasMore: sameSelection && !expired ? result.hasMore : false,
    // Session state determines sign-in guidance without parsing error messages.
    requiresSignIn: !validSession || expired,
    error,
    page,
    retry,
    loadOlder,
    userId,
  };
}
