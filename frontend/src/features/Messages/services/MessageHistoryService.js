/**
 * Purpose: Owns the dashboard session's shared authenticated messaging connection.
 * Responsibilities: Serialize history requests, isolate session transport from
 * request cancellation, await complete transport stop, and offer best-effort typing.
 */
import {
  HubConnectionBuilder, HubConnectionState, LogLevel,
} from "@microsoft/signalr";

// Shared across replacement owners, including React StrictMode cleanup.
let transportBarrier = Promise.resolve();
let cleanupBlocked = false;
const REQUEST_TIMEOUT = 20000;

async function awaitLatestCleanup() {
  // A different owner may append cleanup while this owner is already waiting.
  while (true) {
    const barrier = transportBarrier;
    await barrier;
    if (barrier === transportBarrier) return;
  }
}

// Keep confirmed receipt timestamps when older/null payloads arrive later.
export function mergeMessageReceipts(previous, incoming) {
  const confirmed = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const pick = (first, second) => {
    if (!confirmed(first)) return confirmed(second) ? second : null;
    return confirmed(second) && Date.parse(second) < Date.parse(first) ? second : first;
  };
  return {
    deliveredAt: pick(previous?.deliveredAt, incoming?.deliveredAt),
    readAt: pick(previous?.readAt, incoming?.readAt),
  };
}

export function createMessageHistoryService(token, expiresAt, {
  onMessages, onState, onReceipt, onPresence, onTyping, onConversationsInvalidated,
} = {}) {
  if (typeof token !== "string" || !token.trim() ||
      !Number.isFinite(expiresAt)) {
    throw new Error("Invalid authenticated history session.");
  }

  let disposed = false;
  let generation = 0;
  let current = null;
  let starting = null;
  let activeOperation = null;
  let queue = Promise.resolve();
  let foregroundWork = 0;

  const publishState = (status, error = "") => {
    if (!disposed) onState?.({ status, error });
  };
  const invalidateConversations = (record) => {
    if (!disposed && current === record && !record.retired &&
        record.generation === generation && Date.now() < expiresAt) {
      onConversationsInvalidated?.();
    }
  };
  const validMessage = (message) => message &&
    Number.isInteger(message.id) && message.id > 0 &&
    Number.isInteger(message.conversationId) && message.conversationId > 0 &&
    typeof message.senderId === "string" && message.senderId.length > 0 &&
    typeof message.receiverId === "string" && message.receiverId.length > 0 &&
    typeof message.text === "string" &&
    typeof message.sentAt === "string" &&
    Number.isFinite(Date.parse(message.sentAt));

  function checkSession() {
    if (disposed) throw new Error("History session was closed.");
    // AuthProvider supplies epoch milliseconds, not a backend date string.
    if (Date.now() >= expiresAt) {
      throw new Error("Your session has expired. Please sign in again.");
    }
  }

  function stopRecord(record, reason) {
    if (!record) return transportBarrier;
    if (record.stopTask) return record.stopTask;

    record.retired = true;
    record.connection.off("MessageHistory", record.handler);
    record.connection.off("ReceiveMessage", record.receiveHandler);
    record.connection.off("ConversationUnreadChanged", record.unreadHandler);
    record.connection.off("PendingMessages", record.pendingHandler);
    record.connection.off("MessageStatusUpdated", record.receiptHandler);
    record.connection.off("UserOnline", record.onlineHandler);
    record.connection.off("UserOffline", record.offlineHandler);
    record.connection.off("UserTyping", record.typingHandler);
    record.typingIntent = null;
    record.pending?.reject(reason);
    record.pending = null;

    const previousBarrier = transportBarrier;

    // Initiate stop while startup is pending; never await startup first.
    const stopAttempt = Promise.resolve().then(() =>
      record.connection.stop(),
    );

    // Observe stop and startup separately. The barrier never rejects.
    record.stopTask = Promise.allSettled([
      previousBarrier,
      record.startSettled,
      stopAttempt,
    ]).then((outcomes) => {
      if (outcomes.some((outcome) => outcome.status === "rejected") ||
          record.connection.state !== HubConnectionState.Disconnected) {
        cleanupBlocked = true;
      }
    });

    transportBarrier = record.stopTask;
    return record.stopTask;
  }

  function invalidateConnection(reason) {
    // Also invalidates startup that has not created a transport yet.
    generation++;
    publishState("disconnected", reason.message);
    const record = current;
    current = null;
    return stopRecord(record, reason);
  }

  function connect() {
    checkSession();

    if (current && !current.retired &&
        current.connection.state === HubConnectionState.Connected) {
      return Promise.resolve(current);
    }
    if (starting?.generation === generation) return starting.promise;

    publishState("connecting");
    const startGeneration = generation;
    const task = (async () => {
      await awaitLatestCleanup();
      checkSession();

      if (startGeneration !== generation) {
        throw new Error("History connection startup was superseded.");
      }
      if (cleanupBlocked) {
        throw new Error(
          "Connection cleanup failed. Please reload before retrying.",
        );
      }

      let record;
      const connection = new HubConnectionBuilder()
        .withUrl("/hubs/chat", {
          // Token access belongs to the session/transport, not its first request.
          accessTokenFactory: () => {
            checkSession();
            if (record?.retired || startGeneration !== generation) {
              throw new Error("History transport was retired.");
            }
            return token;
          },
        })
        .configureLogging(LogLevel.Warning)
        .build();

      let settleStart;
      const startSettled = new Promise((resolve) => {
        settleStart = resolve;
      });

      record = {
        connection,
        generation: startGeneration,
        retired: false,
        pending: null,
        handler: null,
        startSettled,
        stopTask: null,
        typingIntent: null,
        typingInFlight: false,
      };

      record.handler = (messages) => {
        const pending = record.pending;
        if (disposed || record.retired || current !== record ||
            record.generation !== generation ||
            !pending || pending.received) return;

        pending.received = true;

        // Empty arrays are valid and belong to the single in-flight invocation.
        const valid = Array.isArray(messages) && messages.every((message) =>
          message &&
          Number.isInteger(message.id) && message.id > 0 &&
          message.conversationId === pending.conversationId &&
          typeof message.senderId === "string" && message.senderId.length > 0 &&
          typeof message.receiverId === "string" && message.receiverId.length > 0 &&
          typeof message.text === "string" &&
          typeof message.sentAt === "string" &&
          Number.isFinite(Date.parse(message.sentAt)),
        );

        if (valid) {
          // Persist known history receipts in the same session cache as live events.
          for (const message of messages) onReceipt?.({ ...message, messageId: message.id });
          pending.resolve(messages);
        }
        else pending.reject(new Error(
          "The server returned an unexpected message history response.",
        ));
      };

      // PendingMessages can arrive before start() resolves: subscribe first.
      const receive = (messages) => {
        if (disposed || record.retired || current !== record ||
            record.generation !== generation) return;
        if (!Array.isArray(messages) || !messages.every(validMessage)) {
          publishState("connected", "An unexpected message update was ignored. Reload history to check messages.");
          return;
        }
        onMessages?.(messages);
      };
      record.receiveHandler = (message) => receive([message]);
      record.pendingHandler = receive;
      record.presenceVersions = new Map();
      const liveRecord = () => !disposed && !record.retired &&
        current === record && record.generation === generation;
      record.receiptHandler = (status) => {
        if (!liveRecord() || !status ||
            !Number.isInteger(status.messageId) || status.messageId < 1 ||
            !Number.isInteger(status.conversationId) || status.conversationId < 1 ||
            typeof status.senderId !== "string" || typeof status.receiverId !== "string") return;
        onReceipt?.(status);
      };
      const presence = (data, isOnline) => {
        if (!liveRecord() || !data || typeof data.userId !== "string" ||
            data.isOnline !== isOnline) return;
        const id = data.userId.toLowerCase();
        record.presenceVersions.set(id, (record.presenceVersions.get(id) || 0) + 1);
        onPresence?.({ ...data, isOnline });
      };
      record.onlineHandler = (data) => presence(data, true);
      record.offlineHandler = (data) => presence(data, false);
      record.typingHandler = (data) => {
        if (!liveRecord() || !data ||
            !Number.isInteger(data.conversationId) || data.conversationId < 1 ||
            typeof data.userId !== "string" || !data.userId.trim() ||
            typeof data.isTyping !== "boolean") return;
        onTyping?.({ conversationId: data.conversationId, userId: data.userId, isTyping: data.isTyping });
      };
      record.unreadHandler = (event) => {
        if (!liveRecord() || !Number.isSafeInteger(event?.conversationId) ||
            event.conversationId < 1) return;
        invalidateConversations(record);
      };
      connection.on("ConversationUnreadChanged", record.unreadHandler);
      connection.on("UserTyping", record.typingHandler);
      connection.on("MessageStatusUpdated", record.receiptHandler);
      connection.on("UserOnline", record.onlineHandler);
      connection.on("UserOffline", record.offlineHandler);
      connection.on("ReceiveMessage", record.receiveHandler);
      connection.on("PendingMessages", record.pendingHandler);
      connection.on("MessageHistory", record.handler);
      connection.onclose(() => {
        // SignalR has no public offclose API; retired callbacks remain inert.
        if (record.retired || current !== record) return;
        const error = new Error("Chat connection closed. Please try again.");
        if (activeOperation) activeOperation.cancel(error);
        else void invalidateConnection(error);
      });

      current = record;

      try {
        const rawStart = connection.start();

        // Observe startup rejection independently of stop/cleanup.
        Promise.resolve(rawStart).then(settleStart, settleStart);
        await rawStart;

        checkSession();
        if (record.retired || current !== record ||
            startGeneration !== generation) {
          throw new Error("History connection startup was superseded.");
        }
        publishState("connected");
        // Events missed during a disconnect are recovered from the list API.
        invalidateConversations(record);
        return record;
      } catch {
        // Covers a synchronous start() throw as well as asynchronous failure.
        settleStart();

        // Never await retirement here: stop() already awaits pending startup.
        if (current === record) {
          void invalidateConnection(new Error("Unable to connect to chat."));
        } else {
          void stopRecord(record, new Error("History transport was retired."));
        }
        publishState("disconnected", "Unable to connect to chat. Check your connection or sign in again.");
        throw new Error(
          "Unable to connect to chat. Check your connection or sign in again.",
        );
      }
    })();

    const entry = { generation: startGeneration, promise: task };
    starting = entry;
    const clear = () => {
      if (starting === entry) starting = null;
    };
    task.then(clear, clear);
    return task;
  }

  async function execute(conversationId, page, pageSize, isCurrent) {
    checkSession();
    if (!isCurrent()) throw new Error("History request cancelled.");

    let rejectCancellation;
    const cancellation = new Promise((_, reject) => {
      rejectCancellation = reject;
    });

    const operation = {
      cancelled: false,
      cancel(error) {
        if (operation.cancelled) return;
        operation.cancelled = true;
        rejectCancellation(error);
        if (activeOperation === operation) {
          void invalidateConnection(error);
        }
      },
    };
    activeOperation = operation;

    const timer = window.setTimeout(() => operation.cancel(
      new Error("Loading message history timed out. Please try again."),
    ), REQUEST_TIMEOUT);

    const work = (async () => {
      const record = await connect();
      checkSession();
      if (operation.cancelled) throw new Error("History request cancelled.");

      // A superseded selection leaves healthy startup available to its successor.
      if (!isCurrent()) return [];

      let resolveHistory;
      let rejectHistory;
      const history = new Promise((resolve, reject) => {
        resolveHistory = resolve;
        rejectHistory = reject;
      });
      const pending = {
        conversationId,
        received: false,
        resolve: resolveHistory,
        reject: rejectHistory,
      };
      record.pending = pending;

      try {
        // Attach both observers before invocation runs, including sync failures.
        const invocation = Promise.resolve().then(() => {
          checkSession();
          if (operation.cancelled || record.retired || current !== record) {
            throw new Error("History request cancelled.");
          }
          return record.connection.invoke(
            "GetMessages", conversationId, page, pageSize,
          );
        });

        // Drain both channels before permitting another request on this hub.
        const [messages] = await Promise.all([history, invocation]);

        checkSession();
        if (operation.cancelled || record.retired || current !== record) {
          throw new Error("History request cancelled.");
        }
        return messages;
      } finally {
        if (record.pending === pending) record.pending = null;
      }
    })();

    try {
      return await Promise.race([work, cancellation]);
    } catch (error) {
      // A failure after invocation can leave an unlabelled event behind.
      operation.cancel(error);

      if (error.message.includes("Unable to access this conversation")) {
        throw new Error("Unable to access this conversation.", { cause: error });
      }
      if (error.message.includes("Invalid message history request")) {
        throw new Error("Invalid message history request.", { cause: error });
      }
      if (error.message.startsWith("Failed to invoke")) {
        throw new Error("Unable to load message history. Please try again.", { cause: error });
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
      if (activeOperation === operation) activeOperation = null;
    }
  }

  function typingTransportReady(record) {
    return Boolean(record && !disposed && !record.retired && current === record &&
      record.generation === generation && Date.now() < expiresAt &&
      record.connection.state === HubConnectionState.Connected);
  }

  function typingIntentCurrent(intent) {
    try {
      return Boolean(intent && Date.now() < intent.deadline && intent.isCurrent());
    } catch {
      // A caller's obsolete guard must never break messaging.
      return false;
    }
  }

  function flushTyping(record) {
    // Ephemeral typing never enters or holds the history/receipt queue.
    if (!typingTransportReady(record) || foregroundWork > 0 || record.typingInFlight) return;
    const intent = record.typingIntent;
    record.typingIntent = null;
    if (!typingIntentCurrent(intent)) return;
    record.typingInFlight = true;
    const work = Promise.resolve().then(() => {
      // Foreground work can arrive between scheduling and this microtask.
      if (!typingTransportReady(record) || !typingIntentCurrent(intent)) return;
      if (foregroundWork > 0) {
        if (!record.typingIntent) record.typingIntent = intent;
        return;
      }
      return record.connection.invoke("Typing", intent.conversationId, intent.isTyping);
    });
    const settled = () => {
      record.typingInFlight = false;
      // Failures are observed and dropped: no automatic retry or connection stop.
      flushTyping(record);
    };
    work.then(settled, settled);
  }

  function finishForegroundWork() {
    foregroundWork--;
    flushTyping(current);
  }

  // New activity commands share the existing history queue. Their timers start
  // only after dequeue, so acknowledgement backlog cannot consume a history timeout.
  // Capture the transport at enqueue time; never retarget stale work after reconnect.
  function command(method, args, isCurrent = () => true) {
    const record = current;
    foregroundWork++;
    const request = queue.then(() => executeCommand(record, method, args, isCurrent));
    queue = request.catch(() => undefined);
    return request.finally(finishForegroundWork);
  }

  async function executeCommand(record, method, args, isCurrent) {
    checkSession();
    if (!isCurrent()) throw new Error("Chat activity request was superseded.");
    if (!record || record !== current || record.retired ||
        record.connection.state !== HubConnectionState.Connected) {
      throw new Error("Chat is disconnected.");
    }
    let timer;
    let timedOut = false;
    try {
      const invocation = Promise.resolve().then(() => {
        checkSession();
        if (record.retired || current !== record || !isCurrent()) {
          throw new Error("Chat activity request was superseded.");
        }
        return record.connection.invoke(method, ...args);
      });
      const result = await Promise.race([invocation, new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          timedOut = true;
          const error = new Error("Chat update timed out.");
          if (current === record) void invalidateConnection(error);
          reject(error);
        }, REQUEST_TIMEOUT);
      })]);
      checkSession();
      if (record.retired || current !== record || !isCurrent()) {
        throw new Error("Chat activity request was superseded.");
      }
      return { record, result };
    } catch (error) {
      // Do not release the queue while a timed-out transport is still stopping.
      // Invocation rejection is observed by Promise.race even if it settles later.
      if (timedOut) await awaitLatestCleanup();
      throw new Error("Unable to update chat activity. Please try again.", { cause: error });
    } finally {
      window.clearTimeout(timer);
    }
  }

  return {
    // Returns acceptance only, never a delivery promise. The caller handles
    // 800ms refresh/1100ms inactivity; this layer only keeps one latest intent.
    setTyping(conversationId, isTyping, isCurrent = () => true) {
      const record = current;
      if (!Number.isInteger(conversationId) || conversationId < 1 ||
          typeof isTyping !== "boolean" || typeof isCurrent !== "function" ||
          !typingTransportReady(record)) return false;
      record.typingIntent = {
        conversationId, isTyping, isCurrent,
        deadline: Date.now() + (isTyping ? 1100 : 3000),
      };
      flushTyping(record);
      return true;
    },
    markDelivered: (id) => command("MarkDelivered", [id]),
    async markRead(id, isCurrent) {
      const response = await command("MarkRead", [id], isCurrent);
      // Refresh the initiating device after the server acknowledges the read.
      invalidateConversations(response.record);
      return response;
    },
    async getUserStatus(userId, isCurrent = () => true) {
      const record = current;
      const id = userId.toLowerCase();
      const version = record?.presenceVersions.get(id) || 0;
      const response = await command("GetUserStatus", [userId], isCurrent);
      const status = response.result;
      // A newer push event wins over a late presence snapshot.
      if (!isCurrent() || response.record !== record || (record.presenceVersions.get(id) || 0) !== version) return;
      if (status && typeof status.userId === "string" &&
          status.userId.toLowerCase() === id && typeof status.isOnline === "boolean") {
        onPresence?.(status);
      } else {
        throw new Error("The server returned an unexpected presence response.");
      }
    },
    // Manual start/retry only; no automatic reconnect or uncertain-send retry.
    start: connect,

    async send(conversationId, value) {
      checkSession();
      const text = value.trim();
      if (!Number.isInteger(conversationId) || conversationId < 1 ||
          !text || text.length > 5000) {
        throw new Error("Enter a message containing 1 to 5,000 characters.");
      }
      const record = current;
      if (!record || record.retired ||
          record.connection.state !== HubConnectionState.Connected) {
        throw new Error("Chat is disconnected. Connect before sending.");
      }
      foregroundWork++;
      let timer;
      const invocation = Promise.resolve().then(() => {
        checkSession();
        if (record.retired || current !== record) {
          throw new Error("Chat connection changed before sending.");
        }
        return record.connection.invoke("SendMessage", { conversationId, text });
      });
      const timeout = new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          const error = new Error("Sending timed out.");
          if (current === record) void invalidateConnection(error);
          reject(error);
        }, REQUEST_TIMEOUT);
      });
      try {
        await Promise.race([invocation, timeout]);
        checkSession();
        if (record.retired || current !== record) throw new Error("Connection changed.");
      } catch (error) {
        // Saving can precede a lost response. Never resend automatically.
        throw new Error(
          "Send could not be confirmed. Your draft is kept. Check message history before sending it again.",
          { cause: error },
        );
      } finally {
        window.clearTimeout(timer);
        finishForegroundWork();
      }
    },

    request(conversationId, page, pageSize, isCurrent) {
      foregroundWork++;
      const request = queue.then(() =>
        execute(conversationId, page, pageSize, isCurrent),
      );
      queue = request.catch(() => undefined);
      return request.finally(finishForegroundWork);
    },

    dispose() {
      disposed = true;
      const error = new Error("History session was closed.");

      if (activeOperation) activeOperation.cancel(error);
      else void invalidateConnection(error);

      // Capture cleanup after cancellation, and follow subsequently added barriers.
      return awaitLatestCleanup();
    },
  };
}
