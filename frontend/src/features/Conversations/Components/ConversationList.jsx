/**
 * File: ConversationList.jsx
 * Purpose: Displays searchable conversation summaries with mobile-number titles.
 * Responsibilities:
 * 1. Render accessible selectable rows with generic avatars, mobile numbers, and last-message details.
 * 2. Filter loaded conversations locally by username or mobile number.
 * 3. Distinguish loading, retryable errors, empty lists, and no search matches.
 * 4. Keep list scrolling independent of the dashboard header and search input.
 * 5. Notify the parent of successful unfiltered list changes and restore focus.
 */

import { useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MessageCircleMore, Search, UserRound, X } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";
import { AuthContext } from "../../../app/AuthContext";
import useConversations from "../Hooks/useConversations";

function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  // Missing or malformed timestamps should never crash the entire sidebar.
  if (!Number.isFinite(date.getTime())) return null;
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(undefined, isToday
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) },
    ).format(date),
    full: date.toLocaleString(),
  };
}

export default function ConversationList({
  onSelect,
  selectedConversationId,
  onConversationsLoaded,
  focusRequest,
  refreshKey = 0,
} = {}) {
  const theme = useContext(ThemeContext);
  const auth = useContext(AuthContext);
  const userId = auth?.isAuthenticated ? auth.user?.userId : null;
  const isDark = theme?.isDark ?? true;
  const { conversations, isLoading, error, retry } = useConversations(refreshKey);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const listId = useId();
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const lastNotifiedRef = useRef(null);

  useEffect(() => {
    // The hook reports loading until an authenticated response has settled.
    // Errors and local search results must never be reported as list snapshots.
    if (!userId || isLoading || error ||
        typeof onConversationsLoaded !== "function") return;

    const signature = JSON.stringify(conversations);
    const previous = lastNotifiedRef.current;
    if (previous?.userId === userId && previous.refreshKey === refreshKey &&
        previous.signature === signature) return;

    // Record before notifying: callback identity changes cannot cause loops.
    // A refresh must notify even if an existing conversation produced identical data.
    lastNotifiedRef.current = { userId, signature, refreshKey };
    onConversationsLoaded(conversations, refreshKey);
  }, [userId, isLoading, error, conversations, onConversationsLoaded, refreshKey]);

  useEffect(() => {
    if (!focusRequest) return;
    const rows = containerRef.current?.querySelectorAll("[data-conversation-id]");
    const row = Array.from(rows || []).find((button) =>
      !button.disabled &&
      button.dataset.conversationId === String(focusRequest.conversationId),
    );
    // A filtered-out or removed row falls back to the preserved search input.
    (row || searchRef.current)?.focus();
  }, [focusRequest]);
  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const searchQuery = query.trim().toLocaleLowerCase();
  const filtered = conversations.filter((conversation) =>
    conversation.otherUserName.toLocaleLowerCase().includes(searchQuery) ||
    (conversation.otherUserMobileNumber ?? "").toLocaleLowerCase().includes(searchQuery),
  );

  let content;
  if (isLoading) {
    content = (
      <div role="status" className={"flex min-h-48 items-center justify-center gap-3 px-6 text-sm " + muted}>
        <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading conversations...
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
        <p role="alert" className={"text-sm " + (isDark ? "text-red-300" : "text-red-600")}>
          {error}
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Try again
        </button>
      </div>
    );
  } else if (conversations.length === 0) {
    content = (
      <div role="status" className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
        <MessageCircleMore size={42} className={"mb-4 " + muted} aria-hidden="true" />
        <h2 className="font-semibold">No conversations yet</h2>
        <p className={"mt-2 max-w-xs text-sm leading-6 " + muted}>
          Your conversations will appear here once you start chatting.
        </p>
      </div>
    );
  } else if (filtered.length === 0) {
    content = (
      <div role="status" className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
        <h2 className="font-semibold">No matching conversations</h2>
        <p className={"mt-2 text-sm leading-6 " + muted}>
          Try another username or mobile number.
        </p>
      </div>
    );
  } else {
    content = (
      <ul aria-label="Conversations" className="px-2 pb-3">
        {filtered.map((conversation) => {
          const mobile = conversation.otherUserMobileNumber?.trim() || "";
          const displayName = mobile || "Sandesh user";
          const timestamp = formatTimestamp(conversation.lastMessageAt);
          return (
            <li
              key={conversation.conversationId}
              className={"border-b " + (isDark ? "border-[#293854]" : "border-slate-200")}
            >
              <button
                type="button"
                data-conversation-id={conversation.conversationId}
                aria-label={"Open conversation with " + displayName}
                aria-pressed={selectedConversationId === conversation.conversationId}
                disabled={typeof onSelect !== "function"}
                onClick={() => onSelect?.(conversation)}
                className={"flex w-full min-w-0 gap-3 rounded-xl px-3 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 disabled:cursor-default " +
                  (selectedConversationId === conversation.conversationId
                    ? isDark ? "bg-blue-600/20" : "bg-blue-50"
                    : isDark ? "enabled:hover:bg-white/5" : "enabled:hover:bg-slate-50")}
              >
              <span
                aria-hidden="true"
                className={"flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold " +
                  (isDark ? "bg-blue-600/20 text-blue-200" : "bg-blue-50 text-blue-700")}
              >
                <UserRound size={22} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span title={displayName} className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName}</span>
                  {timestamp && (
                    <time dateTime={timestamp.iso} title={timestamp.full} className={"shrink-0 text-xs " + muted}>
                      {timestamp.label}
                    </time>
                  )}
                </span>
                <span className={"mt-1 block truncate text-sm " + muted}>
                  {conversation.lastMessage?.trim() || "No messages yet"}
                </span>
              </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section ref={containerRef} aria-label="Conversation list and search" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 py-4">
        <label htmlFor={searchId} className="sr-only">Search conversations by username or mobile number</label>
        <div className={"flex items-center gap-3 rounded-xl border px-3 focus-within:ring-2 focus-within:ring-blue-500 " +
          (isDark ? "border-[#293854] bg-[#080e1c] text-slate-400" : "border-slate-200 bg-slate-100 text-slate-500")}>
          <Search size={19} className="shrink-0" aria-hidden="true" />
          <input
            ref={searchRef}
            id={searchId}
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-controls={listId}
            placeholder="Search conversations"
            className={"min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 " +
              (isDark ? "text-white" : "text-slate-900")}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear conversation search"
              onClick={() => { setQuery(""); document.getElementById(searchId)?.focus(); }}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div
        id={listId}
        role="region"
        aria-label="Conversation results"
        aria-busy={isLoading}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500"
      >
        {content}
      </div>
    </section>
  );
}
