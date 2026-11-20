let apiBase = window.location.origin;
// let token = "";
// let currentUserId = "";
// let currentUserName = "";
// let connection = null;

const SESSION_KEY = "chatflow_auth";
const PENDING_KEY = "chatflow_pending_registration";
let pendingRegistration = null;

// Restore previous login session
let savedSession = null;

try {
  savedSession = JSON.parse(sessionStorage.getItem(SESSION_KEY));
} catch (error) {
  sessionStorage.removeItem(SESSION_KEY);
}

let token = savedSession?.token || "";
let currentUserId = savedSession?.userId || "";
let currentUserName = savedSession?.userName || "";
let expiresAt = savedSession?.expiresAt || null;

let connection = null;
let activeConversationId = null;
let activeOtherUserId = null;
let activeOtherUserName = "";
let typingStarted = false;
let typingTimer = null;
let searchTimer = null;

const $ = (id) => document.getElementById(id);
const loginView = $("loginView"),
  chatView = $("chatView");
const messagesEl = $("messages"),
  messageInput = $("messageInput");
const sendBtn = $("sendBtn"),
  typingEl = $("typingIndicator");

function formatDateTime(utcDate) {
  if (!utcDate) return "Never";

  return new Date(utcDate).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
function setConnectionStatus(value, online = false) {
  $("connectionStatus").textContent = value;
  $("connectionStatus").classList.toggle("online", online);
  $("sideStatus").textContent = online ? "Connected" : value;
  sendBtn.disabled = !online || !activeConversationId;
}
function showEmpty(title, detail) {
  messagesEl.innerHTML = `<div class="empty"><div class="emoji">💬</div><strong>${title}</strong><br>${detail}</div>`;
}
function displayIdentity(mobileNumber, userName) {
  const mobile = String(mobileNumber || "").trim();
  const username = String(userName || "").trim();
  if (mobile) return mobile;
  if (username && !/^user_[0-9a-f-]{20,}$/i.test(username)) return username;
  return "Chat user";
}
function userInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

// Get a local date key, e.g. 2026-11-12
function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Format date as Today, Yesterday, or 12 November 2026
function getDateLabel(date) {
  const today = new Date();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const dateKey = getLocalDateKey(date);

  if (dateKey === getLocalDateKey(today)) {
    return "Today";
  }

  if (dateKey === getLocalDateKey(yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Show date separator whenever the message date changes
function appendDateSeparator(date, dateKey) {
  const separator = document.createElement("div");
  separator.className = "date-separator";
  separator.dataset.dateKey = dateKey;

  const label = document.createElement("span");
  label.textContent = getDateLabel(date);

  separator.appendChild(label);
  messagesEl.appendChild(separator);
}

function appendMessage(message) {
  const messageId = message.id ?? message.Id;
  const deliveredAt = message.deliveredAt ?? message.DeliveredAt;
  const readAt = message.readAt ?? message.ReadAt;

  const cid = Number(message.conversationId ?? message.ConversationId);

  if (activeConversationId && cid !== Number(activeConversationId)) return;

  const senderId = String(
    message.senderId ?? message.SenderId ?? "",
  ).toLowerCase();
  const mine = senderId === String(currentUserId).toLowerCase();

  const senderName =
    message.senderName ??
    message.SenderName ??
    (mine ? currentUserName : activeOtherUserName) ??
    "User";

  const text = message.text ?? message.Text ?? "";
  const sentAt = message.sentAt ?? message.SentAt;

  const empty = messagesEl.querySelector(".empty");
  if (empty) empty.remove();

  const date = sentAt ? new Date(sentAt) : new Date();
  const validDate = !Number.isNaN(date.getTime());

  const dateKey = validDate ? getLocalDateKey(date) : "unknown-date";

  // Find the previous MESSAGE, not the previous element.
  const previousMessage = messagesEl.querySelector(".message:last-of-type");
  const previousDateKey = previousMessage?.dataset.dateKey;

  // Add a date separator only when the message date changes.
  if (validDate && previousDateKey !== dateKey) {
    appendDateSeparator(date, dateKey);
  }

  const item = document.createElement("div");
  item.className = "message" + (mine ? " own" : "");
  item.dataset.messageId = messageId ?? "";
  item.dataset.dateKey = dateKey;

  const sender = document.createElement("div");
  sender.className = "sender";
  sender.textContent = mine ? "You" : senderName;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const time = document.createElement("div");
  time.className = "time";

  time.textContent = validDate
    ? date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Just now";

  // Show ticks only on our own messages.
  if (mine) {
    const tick = document.createElement("span");
    tick.className = "message-tick";

    if (readAt) {
      tick.textContent = "✓✓";
      tick.classList.add("read");
    } else if (deliveredAt) {
      tick.textContent = "✓✓";
    } else {
      tick.textContent = "✓";
    }

    time.appendChild(tick);
  }

  item.append(sender, bubble, time);

  // Append the message exactly once.
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateMessageStatus(status) {
  const messageId = status.messageId ?? status.MessageId;
  const deliveredAt = status.deliveredAt ?? status.DeliveredAt;
  const readAt = status.readAt ?? status.ReadAt;

  if (!messageId) return;

  const item = messagesEl.querySelector(`[data-message-id="${messageId}"]`);

  if (!item) return;

  const tick = item.querySelector(".message-tick");
  if (!tick) return;

  if (readAt) {
    tick.textContent = "✓✓";
    tick.classList.add("read");
  } else if (deliveredAt) {
    tick.textContent = "✓✓";
    tick.classList.remove("read");
  }
}

function renderHistory(items) {
  messagesEl.innerHTML = "";

  if (!items || !items.length) {
    showEmpty(
      "No messages yet",
      "Send the first message to get the conversation going.",
    );
    return;
  }

  // Backend already returns messages in chronological order.
  items.forEach(appendMessage);

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    // Do not expose raw backend exception details or stack traces in the UI.
    const serverMessage =
      typeof data === "object" && data !== null ? data.message : null;
    const safeMessage =
      response.status === 400
        ? serverMessage || "Please check the mobile number and try again."
        : response.status === 401
          ? "Your session has expired. Please sign in again."
          : response.status === 404
            ? "The requested resource was not found."
            : response.status === 429
              ? "Too many requests. Please wait a moment and try again."
              : "Unable to complete the request. Please try again.";
    const error = new Error(safeMessage);
    error.status = response.status;
    throw error;
  }
  return data;
}

function getMobileNumber() {
  return $("mobileNumber").value.trim();
}

function isValidMobileNumber(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

$("sendOtpBtn").addEventListener("click", async () => {
  const mobileNumber = getMobileNumber();
  const error = $("loginError");
  const button = $("sendOtpBtn");

  error.style.color = "#c0392b";
  error.textContent = "";

  if (!isValidMobileNumber(mobileNumber)) {
    error.textContent = "Enter a valid mobile number, e.g. +919876543210.";
    return;
  }

  button.disabled = true;
  button.textContent = "Sending OTP…";

  try {
    await apiRequest("/api/auth/send-otp", {
      method: "POST",
      body: JSON.stringify({ mobileNumber }),
    });

    $("otpSection").classList.remove("hidden");
    $("otp").focus();
    error.style.color = "var(--green)";
    error.textContent =
      "Development OTP generated. Check the backend terminal; no real SMS is sent.";
  } catch (err) {
    error.textContent = err.message || "Unable to send OTP. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Send OTP again";
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const mobileNumber = getMobileNumber();
  const otp = $("otp").value.trim();
  const button = $("verifyOtpBtn");
  const error = $("loginError");

  error.style.color = "#c0392b";
  error.textContent = "";

  if (!isValidMobileNumber(mobileNumber)) {
    error.textContent = "Enter a valid mobile number in international format.";
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    error.textContent = "Enter the 6-digit OTP.";
    return;
  }

  button.disabled = true;
  button.textContent = "Verifying…";

  try {
    const result = await apiRequest("/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ mobileNumber, otp }),
    });

    if (result.status === "profileRequired") {
      showPendingRegistration(result);
    } else if (result.status === "signedIn" && result.login) {
      await acceptLogin(result.login);
    } else {
      throw new Error("Invalid authentication response.");
    }
  } catch (err) {
    error.textContent =
      err.message || "OTP verification failed. Please try again.";
    loginView.classList.remove("hidden");
    chatView.classList.add("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Verify OTP & sign in";
  }
});

function showPendingRegistration(result) {
  const expiry = new Date(result.registrationExpiresAt).getTime();
  if (!result.registrationToken || !Number.isFinite(expiry) || expiry <= Date.now())
    throw new Error("Verify your mobile again to complete registration.");
  pendingRegistration = {
    registrationToken: result.registrationToken,
    registrationExpiresAt: result.registrationExpiresAt,
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingRegistration));
  loginView.classList.add("hidden");
  chatView.classList.add("hidden");
  $("profileView").classList.remove("hidden");
  $("profileError").textContent = "";
  $("userName").focus();
}

async function acceptLogin(result) {
  if (!result.token || !result.userId || !result.expiresAt)
    throw new Error("Invalid authentication response.");
  token = result.token;
  currentUserId = result.userId;
  currentUserName = displayIdentity(result.mobileNumber, result.userName);
  expiresAt = result.expiresAt;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, userId: currentUserId, userName: currentUserName, expiresAt }));
  sessionStorage.removeItem(PENDING_KEY);
  pendingRegistration = null;
  $("profileView").classList.add("hidden");
  loginView.classList.add("hidden");
  chatView.classList.remove("hidden");
  $("currentUserLabel").textContent = `Signed in as ${currentUserName}`;
  try { await connectSignalR(); }
  catch { setConnectionStatus("Connection failed"); }
}

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const userName = $("userName").value.trim();
  const error = $("profileError");
  error.textContent = "";
  if (!userName || userName.length > 100) {
    error.textContent = "Enter a name of 1 to 100 characters.";
    return;
  }
  if (!pendingRegistration) {
    error.textContent = "Verify your mobile again to complete registration.";
    return;
  }
  $("completeProfileBtn").disabled = true;
  try {
    const result = await apiRequest("/api/auth/complete-profile", {
      method: "POST",
      body: JSON.stringify({ userName, registrationToken: pendingRegistration.registrationToken }),
    });
    await acceptLogin(result);
  } catch (err) {
    error.textContent = [401, 409, 410].includes(err.status)
      ? "Verify your mobile again to sign in or resume registration."
      : err.message;
    if ([401, 409, 410].includes(err.status)) {
      pendingRegistration = null;
      sessionStorage.removeItem(PENDING_KEY);
    }
  } finally { $("completeProfileBtn").disabled = false; }
});

$("restartRegistrationBtn").addEventListener("click", () => {
  sessionStorage.removeItem(PENDING_KEY);
  pendingRegistration = null;
  $("profileView").classList.add("hidden");
  loginView.classList.remove("hidden");
  $("otp").value = "";
  $("otpSection").classList.add("hidden");
  $("loginError").textContent = "";
});

async function connectSignalR() {
  const hubUrl = `${apiBase}/hubs/chat`;
  connection = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl, { accessTokenFactory: () => token })
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  connection.on("ReceiveMessage", async (message) => {
    appendMessage(message);
    loadConversationHistory();

    const messageId =
      message.messageId ?? message.MessageId ?? message.id ?? message.Id;

    const conversationId = Number(
      message.conversationId ?? message.ConversationId,
    );

    const senderId = String(
      message.senderId ?? message.SenderId ?? "",
    ).toLowerCase();

    const isMine = senderId === String(currentUserId).toLowerCase();

    // Only the recipient acknowledges delivery.
    if (!isMine && messageId) {
      try {
        await connection.invoke("MarkDelivered", Number(messageId));

        // If the recipient is currently viewing this conversation,
        // mark its incoming messages as read too.
        if (Number(activeConversationId) === conversationId) {
          await connection.invoke("MarkRead", conversationId);
        }
      } catch (err) {
        console.warn("Message acknowledgement failed:", err);
      }
    }
  });

  // Handle messages received while the user was offline.
  connection.on("PendingMessages", async (messages) => {
    if (!Array.isArray(messages) || messages.length === 0) {
      return;
    }

    console.log("Pending messages received:", messages.length);

    for (const message of messages) {
      const messageId = message.id ?? message.Id;

      const senderId = String(
        message.senderId ?? message.SenderId ?? "",
      ).toLowerCase();

      // Only acknowledge messages received from another user.
      if (!messageId || senderId === String(currentUserId).toLowerCase()) {
        continue;
      }

      try {
        // Save delivery status in the backend.
        await connection.invoke("MarkDelivered", Number(messageId));

        console.log("Message delivered:", messageId);
      } catch (err) {
        console.error(
          "Pending message acknowledgement failed:",
          messageId,
          err,
        );
      }
    }

    // Refresh conversation sidebar.
    await loadConversationHistory();

    // Refresh active chat if one is already open.
    // Do not mark messages as read just because the user reconnected.
    if (activeConversationId) {
      try {
        await connection.invoke(
          "GetMessages",
          Number(activeConversationId),
          1,
          50,
        );
      } catch (err) {
        console.error("Conversation refresh failed:", err);
      }
    }
  });

  // Receive message status updates from the backend.
  connection.on("MessageStatusUpdated", (status) => {
    updateMessageStatus(status);
  });

  // Receive conversation message history.
  connection.on("MessageHistory", renderHistory);

  connection.on("UserTyping", (data) => {
    const cid = Number(data.conversationId ?? data.ConversationId);
    const uid = String(data.userId ?? data.UserId ?? "").toLowerCase();
    if (
      cid !== Number(activeConversationId) ||
      uid === String(currentUserId).toLowerCase()
    )
      return;
    typingEl.textContent =
      (data.isTyping ?? data.IsTyping)
        ? `${activeOtherUserName || "The other user"} is typing…`
        : "";
  });

  connection.on("UserOnline", (data) => {
    const userId = String(data.userId ?? data.UserId ?? "").toLowerCase();

    if (userId !== String(activeOtherUserId).toLowerCase()) return;

    updatePresenceUI(true);
  });

  connection.on("UserOffline", (data) => {
    const userId = String(data.userId ?? data.UserId ?? "").toLowerCase();

    if (userId !== String(activeOtherUserId).toLowerCase()) return;

    const lastSeenAt = data.lastSeenAt ?? data.LastSeenAt;
    updatePresenceUI(false, lastSeenAt);
  });

  connection.onreconnecting(() => setConnectionStatus("Reconnecting…"));
  connection.onreconnected(() => {
    setConnectionStatus("Connected", true);

    if (activeConversationId) {
      connection
        .invoke("GetMessages", Number(activeConversationId), 1, 50)
        .catch(console.error);
    }
  });
  connection.onclose(() => setConnectionStatus("Disconnected"));
  setConnectionStatus("Connecting…");
  try {
    await connection.start();
    setConnectionStatus("Connected", true);
    await loadConversationHistory();
  } catch (err) {
    setConnectionStatus("Connection failed");
    throw new Error(`SignalR connection failed: ${err.message}`);
  }
}

async function restoreSession() {
  // Check whether a saved session exists
  if (!token || !currentUserId || !expiresAt) {
    return;
  }

  // Check token expiration
  const expiryTime = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) {
    sessionStorage.removeItem(SESSION_KEY);

    token = "";
    currentUserId = "";
    currentUserName = "";
    expiresAt = null;

    return;
  }

  // Restore user interface
  $("currentUserLabel").textContent = `Signed in as ${currentUserName}`;

  loginView.classList.add("hidden");
  chatView.classList.remove("hidden");

  // Reconnect SignalR
  try {
    await connectSignalR();

    console.log("User session restored successfully.");
  } catch (error) {
    console.error("SignalR reconnection failed:", error);

    // Keep the user authenticated.
    // A SignalR failure is not a logout.
  }
}

$("userSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = $("userSearch").value.trim();

  if (!query) {
    $("searchResults").innerHTML =
      '<div class="empty">Enter a mobile number with country code<br>to find someone.</div>';
    return;
  }

  // E.164 format, e.g. +919876543210
  if (!/^\+[1-9]\d{7,14}$/.test(query)) {
    $("searchResults").innerHTML =
      '<div class="empty">Enter a valid international mobile number,<br>e.g. +919876543210.</div>';
    return;
  }

  searchTimer = setTimeout(() => searchUsers(query), 350);
});

function updatePresenceUI(isOnline, lastSeenAt = null) {
  const subtitle = $("chatSubtitle");

  if (!subtitle) return;

  if (isOnline) {
    subtitle.textContent = "Online";
    return;
  }

  if (!lastSeenAt) {
    subtitle.textContent = "Offline";
    return;
  }

  const date = new Date(lastSeenAt);
  console.log("Last seen at:", lastSeenAt, "Parsed date:", date);

  if (Number.isNaN(date.getTime())) {
    subtitle.textContent = "Offline";
    return;
  }

  subtitle.textContent = `Last seen ${formatDateTime(lastSeenAt)}`;
}

function renderConversationHistory(items) {
  const container = $("conversationHistory");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML =
      '<div class="empty">No previous conversations yet.</div>';
    return;
  }

  items.forEach((item) => {
    const id = item.otherUserId ?? item.OtherUserId;
    const conversationId = item.conversationId ?? item.ConversationId;
    const mobile =
      item.otherUserMobileNumber ?? item.OtherUserMobileNumber ?? "";
    const username = item.otherUserName ?? item.OtherUserName ?? "";
    const name = displayIdentity(mobile, username);
    const lastMessage = item.lastMessage ?? item.LastMessage ?? "";
    const lastAt = item.lastMessageAt ?? item.LastMessageAt;
    const senderId = String(
      item.lastMessageSenderId ?? item.LastMessageSenderId ?? "",
    ).toLowerCase();
    if (!id || !conversationId) return;

    const button = document.createElement("button");
    button.className = "conversation-item";
    if (Number(activeConversationId) === Number(conversationId))
      button.classList.add("active");

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = userInitial(name);

    const details = document.createElement("span");
    details.className = "conversation-details";
    const title = document.createElement("strong");
    title.textContent = name;
    const preview = document.createElement("small");
    const prefix =
      senderId && senderId === String(currentUserId).toLowerCase()
        ? "You: "
        : "";
    preview.textContent = lastMessage
      ? `${prefix}${lastMessage}`
      : "No messages yet";
    details.append(title, preview);

    const meta = document.createElement("small");
    if (lastAt) {
      const lastDate = new Date(lastAt);

      meta.textContent = Number.isNaN(lastDate.getTime())
        ? ""
        : getDateLabel(lastDate);
    } else {
      meta.textContent = "";
    }

    button.append(avatar, details, meta);
    button.addEventListener("click", () =>
      openConversation(id, name, username || "One-to-one conversation"),
    );
    container.appendChild(button);
  });
}
async function loadConversationHistory() {
  try {
    const items = await apiRequest("/api/conversations");
    renderConversationHistory(items);
  } catch (err) {
    const container = $("conversationHistory");
    if (container)
      container.innerHTML =
        '<div class="empty">Unable to load conversation history.</div>';
    console.warn("Conversation history could not be loaded.");
  }
}

async function searchUsers(mobileNumber) {
  const container = $("searchResults");
  container.innerHTML = '<div class="empty">Searching…</div>';

  try {
    const users = await apiRequest(
      `/api/conversations/search?mobileNumber=${encodeURIComponent(mobileNumber)}`,
    );

    container.innerHTML = "";

    if (!Array.isArray(users) || users.length === 0) {
      container.innerHTML = '<div class="empty">No matching users found.</div>';
      return;
    }

    users.forEach((user) => {
      // Keep the GUID internally; never use it as the visible identity.
      const id = user.id ?? user.Id ?? user.userId ?? user.UserId;
      const mobile = user.mobileNumber ?? user.MobileNumber ?? "";
      const username = user.userName ?? user.UserName ?? "";
      const displayName = displayIdentity(mobile, username);
      const secondaryName =
        mobile && username ? username : "Start a conversation";
      if (!id) return;

      const button = document.createElement("button");
      button.className = "user-result";

      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = userInitial(username || displayName);

      const details = document.createElement("span");
      details.innerHTML = `<strong></strong><small></small>`;
      details.querySelector("strong").textContent = displayName;
      details.querySelector("small").textContent = secondaryName;

      button.append(avatar, details);
      button.addEventListener("click", () =>
        openConversation(id, displayName, secondaryName),
      );
      container.appendChild(button);
    });

    if (!container.children.length) {
      container.innerHTML = '<div class="empty">No matching users found.</div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="empty">${escapeHtml(err.message || "Unable to search right now.")}</div>`;
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

async function openConversation(
  receiverId,
  receiverName,
  receiverSubtitle = "One-to-one conversation",
) {
  try {
    await stopTyping();
    $("chatName").textContent = receiverName;
    $("chatSubtitle").textContent =
      receiverSubtitle === "Start a conversation"
        ? "One-to-one conversation"
        : receiverSubtitle;
    $("chatAvatar").textContent = userInitial(receiverName);
    activeOtherUserId = receiverId;
    activeOtherUserName = receiverName;
    activeConversationId = null;
    typingEl.textContent = "";

    messageInput.disabled = true;
    messageInput.placeholder = "Opening conversation…";
    sendBtn.disabled = true;
    showEmpty("Opening conversation…", "Preparing your secure chat.");
    const conversation = await apiRequest("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ receiverId }),
    });
    const conversationMobile =
      conversation.otherUserMobileNumber ?? conversation.OtherUserMobileNumber;
    const conversationUserName =
      conversation.otherUserName ?? conversation.OtherUserName ?? receiverName;
    activeOtherUserName = displayIdentity(
      conversationMobile,
      conversationUserName,
    );
    $("chatName").textContent = activeOtherUserName;
    $("chatAvatar").textContent = userInitial(activeOtherUserName);
    activeConversationId =
      conversation.conversationId ?? conversation.ConversationId;

    if (
      connection &&
      connection.state === signalR.HubConnectionState.Connected
    ) {
      try {
        const status = await connection.invoke("GetUserStatus", receiverId);

        updatePresenceUI(
          status.isOnline ?? status.IsOnline,
          status.lastSeenAt ?? status.LastSeenAt,
        );
      } catch (error) {
        console.error("Could not fetch user presence:", error);
        $("chatSubtitle").textContent = "One-to-one conversation";
      }
    }
    if (!activeConversationId)
      throw new Error("Conversation response did not include conversationId.");
    await loadConversationHistory();
    messageInput.disabled = false;
    messageInput.placeholder = "Type your message…";
    sendBtn.disabled = false;
    if (connection?.state === signalR.HubConnectionState.Connected) {
      await connection.invoke(
        "GetMessages",
        Number(activeConversationId),
        1,
        50,
      );

      await connection.invoke("MarkRead", Number(activeConversationId));
    }
  } catch (err) {
    showEmpty("Couldn't open this chat", err.message);
    messageInput.disabled = true;
    sendBtn.disabled = true;
  }
}

async function startTyping() {
  if (
    !activeConversationId ||
    !connection ||
    connection.state !== signalR.HubConnectionState.Connected
  )
    return;
  if (!typingStarted) {
    typingStarted = true;
    try {
      await connection.invoke("Typing", Number(activeConversationId), true);
    } catch (err) {
      console.warn("Typing event failed", err);
      typingStarted = false;
    }
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1100);
}
async function stopTyping() {
  clearTimeout(typingTimer);
  if (!typingStarted) return;
  typingStarted = false;
  if (
    activeConversationId &&
    connection?.state === signalR.HubConnectionState.Connected
  ) {
    try {
      await connection.invoke("Typing", Number(activeConversationId), false);
    } catch (err) {
      console.warn(err);
    }
  }
}
messageInput.addEventListener("input", () => {
  if (!messageInput.value.trim()) {
    stopTyping();
    return;
  }
  startTyping();
});
async function sendMessage() {
  const text = messageInput.value.trim();
  if (
    !text ||
    !activeConversationId ||
    connection?.state !== signalR.HubConnectionState.Connected
  )
    return;
  sendBtn.disabled = true;
  try {
    await stopTyping();
    await connection.invoke("SendMessage", {
      conversationId: Number(activeConversationId),
      text,
    });
    messageInput.value = "";
  } catch (err) {
    alert(`Message could not be sent: ${err.message}`);
  } finally {
    sendBtn.disabled =
      !activeConversationId ||
      connection?.state !== signalR.HubConnectionState.Connected;
  }
}
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});
// $("logoutBtn").addEventListener("click", async () => {
//   if (connection) {
//     try {
//       await stopTyping();
//       await connection.stop();
//     } catch {}
//   }
//   connection = null;
//   token = "";
//   currentUserId = "";
//   activeConversationId = null;
//   chatView.classList.add("hidden");
//   loginView.classList.remove("hidden");
//   $("otp").value = "";
//   $("otpSection").classList.add("hidden");
//   $("loginError").textContent = "";
//   $("loginError").style.color = "#c0392b";
//   $("sendOtpBtn").textContent = "Send OTP";
//   $("userSearch").value = "";
//   showEmpty(
//     "Your conversations, in real time.",
//     "Search for a user on the left to begin.",
//   );
// });

$("logoutBtn").addEventListener("click", async () => {
  // Stop SignalR connection
  if (connection) {
    try {
      await stopTyping();
      await connection.stop();
    } catch (error) {
      console.error(error);
    }
  }

  connection = null;

  // Remove saved authentication
  sessionStorage.removeItem(SESSION_KEY);

  // Clear authentication variables
  token = "";
  currentUserId = "";
  currentUserName = "";
  expiresAt = null;

  activeConversationId = null;
  activeOtherUserId = null;
  activeOtherUserName = "";

  // Restore login screen
  chatView.classList.add("hidden");
  loginView.classList.remove("hidden");

  // Reset login form
  $("otp").value = "";
  $("otpSection").classList.add("hidden");
  $("loginError").textContent = "";
  $("loginError").style.color = "#c0392b";
  $("sendOtpBtn").textContent = "Send OTP";
  $("userSearch").value = "";

  showEmpty(
    "Your conversations, in real time.",
    "Search for a user on the left to begin.",
  );
});

// Restore existing user session on page refresh
if (token) {
  restoreSession();
} else {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY));
    if (pending) showPendingRegistration(pending);
  } catch { sessionStorage.removeItem(PENDING_KEY); }
}
