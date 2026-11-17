/**
 * Purpose: Owns the dashboard's lazy authenticated SignalR connection.
 * Responsibilities: Serialize history requests, isolate session transport from
 * request cancellation, and await startup settlement plus complete transport stop.
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

export function createMessageHistoryService(token, expiresAt) {
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

        if (valid) pending.resolve(messages);
        else pending.reject(new Error(
          "The server returned an unexpected message history response.",
        ));
      };

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

  return {
    request(conversationId, page, pageSize, isCurrent) {
      const request = queue.then(() =>
        execute(conversationId, page, pageSize, isCurrent),
      );
      queue = request.catch(() => undefined);
      return request;
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
