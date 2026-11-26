/**
 * File: ConversationService.js
 * Purpose: Retrieves conversations and supports user search, chat creation, and invitation previews.
 * Responsibilities:
 * 1. Request the existing conversation list without changing its API contract.
 * 2. Validate response data before it reaches the UI.
 * 3. Provide readable errors without disguising server failures as empty lists.
 * 4. Search verified mobile numbers and create or reuse conversations.
 * 5. Read Chat Lock settings and manage Secret Codes through the privacy API.
 */

import api from "../../../shared/lib/api";

export async function getConversationSections(signal) {
  const { data } = await api.get("/conversations/sections", { signal });
  if (
    typeof data?.hasArchivedChats !== "boolean" ||
    typeof data?.hasLockedChats !== "boolean"
  ) {
    throw new Error("The server returned unexpected chat sections.");
  }
  return data;
}

export async function getChatLockSettings(signal) {
  const { data } = await api.get("/privacy/chat-lock-settings", { signal });
  if (
    typeof data?.secretCodeConfigured !== "boolean" ||
    typeof data?.hideLockedChats !== "boolean" ||
    (data.hideLockedChats && !data.secretCodeConfigured)
  ) {
    throw new Error("The server returned unexpected Chat Lock settings.");
  }
  return data;
}

export function setSecretCode(settings, signal) {
  return api.put("/privacy/secret-code", settings, { signal });
}

export function setHideLockedChats(settings, signal) {
  return api.put("/privacy/hide-locked-chats", settings, { signal });
}

// A request-specific transform runs after the shared interceptor adds its grant.
export function withPrivacyToken(token, signal) {
  return {
    signal,
    transformRequest: [
      (data, headers) => {
        if (token) headers.set("X-Privacy-Token", token);
        else headers.delete("X-Privacy-Token");
        return data;
      },
      ...api.defaults.transformRequest,
    ],
  };
}

export function disableSecretCode(settings, signal, requirePin = false) {
  return api.post(
    "/privacy/secret-code/disable",
    settings,
    requirePin ? withPrivacyToken(null, signal) : { signal },
  );
}

export async function verifySecretCode(secretCode, signal) {
  const { status, data } = await api.post(
    "/privacy/secret-code/verify",
    { secretCode },
    { signal },
  );
  return status === 200 ? data : null;
}

export async function getConversations(
  signal,
  section = "normal",
  pageNumber = 1,
) {
  const response = await api.get("/conversations", {
    signal,
    params: { section, pageNumber, pageSize: 30 },
  });
  const conversations = response.data;
  const isNullableString = (value) =>
    value == null || typeof value === "string";

  // An invalid payload is an error, not evidence that the user has no chats.
  if (
    !Array.isArray(conversations) ||
    !conversations.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        Number.isInteger(item.conversationId) &&
        item.conversationId > 0 &&
        typeof item.otherUserId === "string" &&
        item.otherUserId.trim().length > 0 &&
        typeof item.otherUserName === "string" &&
        isNullableString(item.otherUserMobileNumber) &&
        isNullableString(item.lastMessage) &&
        isNullableString(item.lastMessageAt) &&
        isNullableString(item.lastMessageSenderId),
    )
  ) {
    throw new Error("The server returned an unexpected conversation response.");
  }

  return conversations.map((conversation) => ({
    ...conversation,
    unreadCount:
      Number.isSafeInteger(conversation.unreadCount) &&
      conversation.unreadCount >= 0
        ? conversation.unreadCount
        : null,
  }));
}

export function getConversationErrorMessage(error) {
  if (error?.response?.data?.code === "privacy_access_required")
    return "Enter your privacy PIN to open Locked Chats.";
  const status = error?.response?.status;
  if (status === 401)
    return "Your session could not be authorized. Please log out and sign in again.";
  if (status === 403)
    return "You do not have permission to view these conversations.";
  if (status === 429)
    return "Too many requests. Please wait before trying again.";
  if (status >= 500)
    return "The server could not load your conversations. Please try again later.";
  if (error?.code === "ECONNABORTED")
    return "Loading conversations timed out. Please try again.";
  if (error?.isAxiosError && !error.response)
    return "Unable to connect to the server. Check your connection and try again.";
  if (error?.isAxiosError)
    return "Unable to load conversations. Please try again.";
  return "The server returned an unexpected conversation response. Please try again.";
}

/**
 * Finds other verified users by an exact international mobile number.
 */
export async function searchUsersByMobileNumber(mobileNumber, signal) {
  const response = await api.get("/conversations/search", {
    params: { mobileNumber: mobileNumber.trim() },
    signal,
  });
  const users = response.data;
  if (
    !Array.isArray(users) ||
    !users.every(
      (user) =>
        user &&
        typeof user.id === "string" &&
        user.id.trim() &&
        typeof user.userName === "string" &&
        (user.mobileNumber == null || typeof user.mobileNumber === "string"),
    )
  ) {
    throw new Error("The server returned an unexpected user search response.");
  }
  return users;
}

/**
 * Reuses an existing conversation or creates one through the existing endpoint.
 */
export async function getOrCreateConversation(receiverId, signal) {
  const response = await api.post("/conversations", { receiverId }, { signal });
  const conversation = response.data;
  if (
    !conversation ||
    !Number.isInteger(conversation.conversationId) ||
    conversation.conversationId <= 0 ||
    typeof conversation.otherUserId !== "string" ||
    !conversation.otherUserId.trim() ||
    typeof conversation.otherUserName !== "string" ||
    !(
      conversation.otherUserMobileNumber == null ||
      typeof conversation.otherUserMobileNumber === "string"
    )
  ) {
    throw new Error("The server returned an unexpected conversation response.");
  }
  return conversation;
}

export function getNewChatErrorMessage(error) {
  const status = error?.response?.status;
  if (status === 401)
    return "Your session could not be authorized. Please log out and sign in again.";
  if (status === 403)
    return "You do not have permission to start this conversation.";
  if (status === 429)
    return "Too many requests. Please wait before trying again.";
  if (status >= 500)
    return "The server could not complete this request. Please try again later.";
  if (error?.code === "ECONNABORTED")
    return "The request timed out. Please try again.";
  if (status === 400 || status === 404 || status === 409) {
    // These endpoints return either a message object or a plain client-error string.
    const data = error.response.data;
    const message = typeof data === "string" ? data : data?.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error?.isAxiosError && !error.response)
    return "Unable to connect to the server. Please try again.";
  if (error?.isAxiosError)
    return "The request could not be completed. Please try again.";
  return (
    error?.message || "The request could not be completed. Please try again."
  );
}

export async function previewInvitation(mobileNumber, signal) {
  const response = await api.post(
    "/invitations/preview",
    { mobileNumber: mobileNumber.trim() },
    { signal },
  );

  if (
    response.data?.status !== "previewed" ||
    typeof response.data?.message !== "string"
  ) {
    throw new Error("Unexpected invitation preview response.");
  }

  return response.data;
}
