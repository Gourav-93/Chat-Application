/**
 * File: useChatSession.js
 * Purpose: Owns the authenticated dashboard's single messaging service.
 * Responsibilities: Schedule automatic recovery, guard session cleanup, buffer
 * messages and receipts, acknowledge delivery, and forward presence and typing.
 */
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getPrivacySnapshot, subscribePrivacy } from "../../../shared/lib/privacyAccess";
import { AuthContext } from "../../../app/AuthContext";
import { createMessageHistoryService, mergeMessageReceipts } from "../services/MessageHistoryService";

const EMPTY_MESSAGES = new Map();
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;

export default function useChatSession() {
  const privacy = useSyncExternalStore(subscribePrivacy, getPrivacySnapshot);
  const auth = useContext(AuthContext);
  const endSession = auth?.endSession;
  const token = auth?.isAuthenticated ? auth.user?.token : null;
  const userId = auth?.user?.userId;
  const expiresAt = auth?.user?.expiresAt;
  const validSession = Boolean(typeof token === "string" && token.trim() &&
    typeof userId === "string" && userId && Number.isFinite(expiresAt));
  const [state, setState] = useState(null);
  const [sending, setSending] = useState(null);
  const sendRef = useRef(null);

  useEffect(() => {
    if (!validSession) return undefined;
    let active = true;
    let expiryTimer;
    let retryTimer;
    let startInFlight = false;
    let recoveryStopped = false;
    let networkRecoveryPending = navigator.onLine === false;
    let reconnectDelay = INITIAL_RECONNECT_DELAY;
    let lastFailure = null;
    let backgroundRecovery = false;
    const owner = { token, userId, expiresAt, privacyVersion: privacy.version, service: null };
    let connectionStatus = "connecting";
    let typingEpoch = 0;
    const typingListeners = new Set();
    let flushingDelivery = false;
    let deliveryFlushRequested = false;
    const deliveries = new Map();
    const delivered = new Set();
    const update = (change) => {
      if (active) setState((previous) =>
        previous?.owner === owner ? change(previous) : previous);
    };
    const sessionCurrent = () => active && Date.now() < expiresAt;
    const canStart = () => sessionCurrent() && !recoveryStopped && navigator.onLine !== false;

    function clearRetryTimer() {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    function scheduleReconnect() {
      if (!canStart() || startInFlight || retryTimer !== undefined ||
          connectionStatus !== "disconnected" || !lastFailure?.retryable) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        if (!canStart() || connectionStatus !== "disconnected" || !lastFailure?.retryable) return;
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        startConnection(true);
      }, reconnectDelay);
    }

    function startConnection(background = false, afterOffline = false) {
      if (!canStart() || startInFlight || (!afterOffline && connectionStatus === "connected")) return;
      clearRetryTimer();
      backgroundRecovery = background;
      // Publish the task before calling start(), which can emit state synchronously.
      startInFlight = true;
      void Promise.resolve()
        .then(() => {
          if (!canStart()) {
            if (afterOffline && sessionCurrent() && navigator.onLine === false) {
              networkRecoveryPending = true;
            }
            return;
          }
          if (afterOffline) {
            // Any additional offline events before this attempt belong to the same recovery.
            networkRecoveryPending = false;
            return owner.service.restartAfterOffline();
          }
          return owner.service.start();
        })
        .catch(() => undefined)
        .finally(() => {
          startInFlight = false;
          backgroundRecovery = false;
          continueRecovery();
        });
    }

    function continueRecovery() {
      if (networkRecoveryPending && canStart() && !startInFlight) {
        networkRecoveryPending = false;
        if (lastFailure?.retryable !== false) {
          startConnection(true, true);
          return;
        }
      }
      scheduleReconnect();
    }

    function pauseRecovery() {
      networkRecoveryPending = true;
      clearRetryTimer();
    }
    function stopRecovery() {
      recoveryStopped = true;
      networkRecoveryPending = false;
      clearRetryTimer();
      window.removeEventListener("online", continueRecovery);
      window.removeEventListener("offline", pauseRecovery);
    }
    owner.start = startConnection;

    const typingReady = () => sessionCurrent() && connectionStatus === "connected";
    const guardCurrent = (guard) => {
      try { return typeof guard === "function" && Boolean(guard()); }
      catch { return false; }
    };
    const clearTypingSubscriptions = () => {
      typingEpoch++;
      for (const subscription of typingListeners) subscription.active = false;
      typingListeners.clear();
    };
    owner.subscribeTyping = (conversationId, recipientId, listener, isCurrent) => {
      if (!typingReady() || !Number.isInteger(conversationId) || conversationId < 1 ||
          typeof recipientId !== "string" || !recipientId.trim() ||
          recipientId.toLowerCase() === userId.toLowerCase() ||
          typeof listener !== "function" || !guardCurrent(isCurrent)) return () => {};
      const subscription = {
        conversationId, recipientId: recipientId.toLowerCase(), listener, isCurrent, active: true,
      };
      typingListeners.add(subscription);
      return () => {
        subscription.active = false;
        typingListeners.delete(subscription);
      };
    };
    owner.setTyping = (conversationId, isTyping, isCurrent) => {
      if (!typingReady() || !guardCurrent(isCurrent)) return false;
      const epoch = typingEpoch;
      return owner.service.setTyping(conversationId, isTyping, () =>
        typingReady() && epoch === typingEpoch && guardCurrent(isCurrent));
    };

    const hasPendingDelivery = () =>
      Array.from(deliveries.values()).some((entry) => !entry.failed);

    const flushDelivery = async () => {
      // Record every wake-up before the single-flight guard. A batch arriving
      // during an await must request another pass, not lose its delivery work.
      deliveryFlushRequested = true;
      if (!active || flushingDelivery || connectionStatus !== "connected") return;
      flushingDelivery = true;
      try {
        do {
          deliveryFlushRequested = false;
          // Each pass owns a stable batch; later arrivals stay queued for the next.
          const batch = Array.from(deliveries.entries()).filter(([, entry]) => !entry.failed);
          for (const [id, entry] of batch) {
            if (!active || connectionStatus !== "connected") break;
            if (deliveries.get(id) !== entry || delivered.has(id)) continue;
            try {
              await owner.service.markDelivered(id);
              if (!active) break;
              delivered.add(id);
              deliveries.delete(id);
            } catch {
              if (!active) break;
              entry.failed = true;
              update((previous) => ({ ...previous,
                receiptError: "Some delivery updates failed. You can retry receipts." }));
            }
          }
        } while (active && connectionStatus === "connected" &&
          (deliveryFlushRequested || hasPendingDelivery()));
      } finally {
        flushingDelivery = false;
        // Failed entries stay in the map. Clear the banner only after the
        // connected single-flight drain has settled with no work remaining.
        if (active && connectionStatus === "connected" && deliveries.size === 0) {
          update((previous) => previous.receiptError
            ? { ...previous, receiptError: "" } : previous);
        }
        // Close the drain/idle boundary without retrying failed acknowledgements.
        if (active && connectionStatus === "connected" && hasPendingDelivery()) {
          void flushDelivery();
        }
      }
    };
    owner.retryDeliveries = () => {
      for (const entry of deliveries.values()) entry.failed = false;
      void flushDelivery();
    };
    owner.service = createMessageHistoryService(token, expiresAt, {
      onConversationsInvalidated: () => update((previous) => ({
        ...previous, revision: previous.revision + 1,
      })),
      onSessionReplaced: (message) => {
        if (!active) return;
        stopRecovery();
        endSession?.(message, token);
      },
      onState: ({ status, error, failure }) => {
        if (!sessionCurrent()) return;
        connectionStatus = status;
        if (status !== "connected") clearTypingSubscriptions();
        if (status === "connecting") {
          clearRetryTimer();
          // Keep the displayed state stable while tracking the real startup above.
          if (backgroundRecovery) return;
        } else {
          lastFailure = failure;
        }
        const keepPreviousError = backgroundRecovery && status === "disconnected" && failure?.retryable;
        update((previous) => ({
          ...previous, status, failure: status === "connecting" ? previous.failure : failure,
          error: keepPreviousError ? (previous.error || error) : error,
          presence: status === "connected" ? previous.presence : new Map(),
        }));
        if (status === "connected") {
          clearRetryTimer();
          reconnectDelay = INITIAL_RECONNECT_DELAY;
          for (const entry of deliveries.values()) entry.failed = false;
          void flushDelivery();
        } else if (status === "disconnected") {
          if (failure?.retryable) continueRecovery();
          else clearRetryTimer();
        }
      },
      onTyping: (event) => {
        if (!typingReady() || event.userId.toLowerCase() === userId.toLowerCase()) return;
        // Do not update React session state for heartbeats. Only the selected
        // activity subscriber needs an event to refresh its local expiry deadline.
        for (const subscription of Array.from(typingListeners)) {
          if (!subscription.active || subscription.conversationId !== event.conversationId ||
              subscription.recipientId !== event.userId.toLowerCase() ||
              !guardCurrent(subscription.isCurrent)) continue;
          try { subscription.listener(event); }
          catch { /* A transient UI listener must not break messaging or receipts. */ }
        }
      },
      onReceipt: (status) => update((previous) => {
        if (status.senderId.toLowerCase() !== userId.toLowerCase()) return previous;
        const receipts = new Map(previous.receipts);
        const earlier = receipts.get(status.messageId);
        receipts.set(status.messageId, { ...status, ...mergeMessageReceipts(earlier, status) });
        return { ...previous, receipts };
      }),
      onPresence: (status) => update((previous) => {
        const presence = new Map(previous.presence);
        presence.set(status.userId.toLowerCase(), status);
        return { ...previous, presence };
      }),
      onMessages: (batch) => {
        // Side effects stay outside React state updaters (including StrictMode).
        for (const message of batch) {
          if (message.receiverId.toLowerCase() !== userId.toLowerCase() ||
              message.senderId.toLowerCase() === userId.toLowerCase()) continue;
          const receipt = mergeMessageReceipts(null, message);
          if (receipt.deliveredAt || receipt.readAt) {
            delivered.add(message.id);
            deliveries.delete(message.id);
          }
          if (!delivered.has(message.id) && !deliveries.has(message.id)) {
            deliveries.set(message.id, { failed: false });
          }
        }
        void flushDelivery();
        update((previous) => {
        const messages = new Map(previous.messages);
        let changed = false;
        for (const message of batch) {
          // Scope all buffered events to the authenticated account.
          const id = userId.toLowerCase();
          if (message.senderId.toLowerCase() !== id &&
              message.receiverId.toLowerCase() !== id) continue;
          if (JSON.stringify(messages.get(message.id)) === JSON.stringify(message)) continue;
          messages.set(message.id, { ...message,
            ...mergeMessageReceipts(messages.get(message.id), message) });
          changed = true;
        }
        return changed ? { ...previous, messages, revision: previous.revision + 1 } : previous;
        });
      },
    });
    const checkExpiry = () => {
      if (!active) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        stopRecovery();
        connectionStatus = "disconnected";
        clearTypingSubscriptions();
        update((previous) => ({ ...previous, expired: true, status: "disconnected",
          failure: null, error: "Your session has expired. Please sign in again." }));
        void owner.service.dispose();
      } else {
        expiryTimer = window.setTimeout(checkExpiry, Math.min(remaining, 2147483647));
      }
    };

    window.addEventListener("online", continueRecovery);
    window.addEventListener("offline", pauseRecovery);

    // Publish the owner before starting; event callbacks then queue behind it.
    // StrictMode's discarded owner cannot publish or start a transport.
    Promise.resolve().then(() => {
      if (!active) return;
      setState({ owner, messages: new Map(), receipts: new Map(), presence: new Map(),
        receiptError: "", revision: 0, status: "connecting", error: "", failure: null, expired: false });
      checkExpiry();
      startConnection();
    });
    return () => {
      active = false;
      stopRecovery();
      clearTypingSubscriptions();
      window.clearTimeout(expiryTimer);
      if (sendRef.current?.owner === owner) sendRef.current = null;
      void owner.service.dispose();
    };
  }, [validSession, token, userId, expiresAt, endSession, privacy.version]);

  const current = validSession && state?.owner.token === token &&
    state.owner.privacyVersion === privacy.version &&
    state.owner.userId === userId && state.owner.expiresAt === expiresAt;
  const owner = current ? state.owner : null;
  const requiresSignIn = !validSession || Boolean(current && state.expired);
  const send = useCallback(async (conversationId, text) => {
    if (!owner || requiresSignIn || sendRef.current) return false;
    const operation = { owner, conversationId };
    sendRef.current = operation;
    setSending({ ...operation, pending: true, error: "" });
    try {
      await owner.service.send(conversationId, text);
      if (sendRef.current !== operation) return false;
      setSending({ ...operation, pending: false, error: "" });
      setState((previous) => previous?.owner === owner
        ? { ...previous, revision: previous.revision + 1 } : previous);
      return true;
    } catch (error) {
      if (sendRef.current === operation) {
        setSending({ ...operation, pending: false,
          error: error.message || "Unable to send. Your draft is kept." });
      }
      return false;
    } finally {
      if (sendRef.current === operation) sendRef.current = null;
    }
  }, [owner, requiresSignIn]);

  const start = useCallback(() => {
    if (owner && !requiresSignIn) owner.start();
  }, [owner, requiresSignIn]);

  const retryReceipts = useCallback(() => {
    if (owner && !requiresSignIn) owner.retryDeliveries();
  }, [owner, requiresSignIn]);

  // A selection guard is required so pending typing cannot target an old chat.
  const setTyping = useCallback((conversationId, isTyping, isCurrent) => {
    if (!owner || requiresSignIn) return false;
    return owner.setTyping(conversationId, isTyping, isCurrent);
  }, [owner, requiresSignIn]);

  const subscribeTyping = useCallback((conversationId, recipientId, listener, isCurrent) => {
    if (!owner || requiresSignIn) return () => {};
    return owner.subscribeTyping(conversationId, recipientId, listener, isCurrent);
  }, [owner, requiresSignIn]);

  return {
    owner, userId, requiresSignIn, send, start, retryReceipts, setTyping, subscribeTyping,
    receipts: current && !requiresSignIn ? state.receipts : EMPTY_MESSAGES,
    presence: current && !requiresSignIn && state.status === "connected" ? state.presence : EMPTY_MESSAGES,
    receiptError: current ? state.receiptError : "",
    status: current ? state.status : "connecting",
    error: current ? state.error : "",
    failure: current ? state.failure : null,
    revision: current ? state.revision : 0,
    messages: current && !requiresSignIn ? state.messages : EMPTY_MESSAGES,
    sending: sending?.owner === owner ? sending : null,
  };
}
