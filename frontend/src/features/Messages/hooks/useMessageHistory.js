/**
 * File: useMessageHistory.js
 * Purpose: Loads selected-conversation history through the existing SignalR service.
 * Responsibilities:
 * 1. Consume the dashboard's shared session without creating another connection.
 * 2. Ignore stale selections and retain successful pages during older-page retries.
 * 3. Merge confirmed receipts without downgrading history/live message status.
 * 4. Deduplicate and order messages, with 30-message pages and explicit UI states.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { mergeMessageReceipts } from "../services/MessageHistoryService";

const PAGE_SIZE = 30;
const EMPTY_MESSAGES = [];

// Selection is the dashboard's { conversation, generation } object.
export default function useMessageHistory(selection, session) {
  const { owner, userId, requiresSignIn } = session;
  const validSession = !requiresSignIn;
  const expired = requiresSignIn;
  const [result, setResult] = useState(null);
  const [ticket, setTicket] = useState(null);

  const ownerReady = Boolean(owner) && !requiresSignIn;
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
          const unique = new Map();
          for (const message of [...messages, ...prior]) {
            unique.set(message.id, { ...message,
              ...mergeMessageReceipts(unique.get(message.id), message) });
          }
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
  // Live/startup events remain outside page-result replacement, so a history
  // response cannot erase a confirmed message received while it was loading.
  const pageMessages = sameSelection && !expired ? result.messages : EMPTY_MESSAGES;
  const messages = useMemo(() => {
    if (!ownerReady || !conversationId) return EMPTY_MESSAGES;
    const unique = new Map(pageMessages.map((message) => [message.id,
      { ...message, ...mergeMessageReceipts(null, message) }]));
    for (const message of session.messages.values()) {
      if (message.conversationId === conversationId) {
        unique.set(message.id, { ...message,
          ...mergeMessageReceipts(unique.get(message.id), message) });
      }
    }
    // Receipts may arrive before their message. Apply the session cache last,
    // matching participant and conversation identity before merging timestamps.
    for (const [id, message] of unique) {
      const receipt = session.receipts.get(id);
      if (receipt && receipt.conversationId === message.conversationId &&
          receipt.senderId.toLowerCase() === message.senderId.toLowerCase() &&
          receipt.receiverId.toLowerCase() === message.receiverId.toLowerCase()) {
        unique.set(id, { ...message, ...mergeMessageReceipts(message, receipt) });
      }
    }
    return [...unique.values()].sort((a, b) =>
      Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id - b.id);
  }, [ownerReady, conversationId, pageMessages, session.messages, session.receipts]);
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
    // Activity/read coordination can distinguish loaded history from live-only data.
    hasLoadedHistory: Boolean(sameSelection && result.loadedPage >= 1 && !expired),
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
