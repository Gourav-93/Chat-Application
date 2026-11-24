/**
 * File: ConversationList.jsx
 * Purpose: Displays searchable conversation summaries with username-first titles.
 * Responsibilities:
 * 1. Render selectable rows with generic avatars, username-first titles, and last-message details.
 * 2. Filter loaded conversations locally by username or mobile number.
 * 3. Keep cached rows and unread counts visible across outages and show access errors quietly.
 * 4. Keep list scrolling independent of the dashboard header and search input.
 * 5. Notify the parent of successful unfiltered list changes and restore focus.
 */

import { useContext, useEffect, useId, useRef, useState } from "react";
import { Archive, ChevronRight, EllipsisVertical, LoaderCircle, LockKeyhole, MessageCircleMore, Search, UserRound, X } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";
import { AuthContext } from "../../../app/AuthContext";
import useConversations from "../Hooks/useConversations";
import { getDisplayName } from "../../../shared/lib/displayIdentity";

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
  backendUnavailable = false,
  refreshKey = 0,
  section = "normal",
  onAction,
  sections,
  onSectionOpen,
  actionBusy = false,
} = {}) {
  const theme = useContext(ThemeContext);
  const auth = useContext(AuthContext);
  const userId = auth?.isAuthenticated ? auth.user?.userId : null;
  const isDark = theme?.isDark ?? true;
  const {
    conversations, isLoading, isRefreshing, snapshotReady, hasSnapshot, accessError, hasMore, loadMore,
  } = useConversations(refreshKey, section);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const listId = useId();
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const lastNotifiedRef = useRef(null);

  useEffect(() => {
    // Notify only after a successful server response, even when cached rows are visible.
    if (!userId || !snapshotReady ||
        typeof onConversationsLoaded !== "function") return;

    const signature = JSON.stringify(conversations);
    const previous = lastNotifiedRef.current;
    if (previous?.userId === userId && previous.refreshKey === refreshKey &&
        previous.signature === signature) return;

    // Record before notifying: callback identity changes cannot cause loops.
    // A refresh must notify even if an existing conversation produced identical data.
    lastNotifiedRef.current = { userId, signature, refreshKey };
    onConversationsLoaded(conversations, refreshKey);
  }, [userId, snapshotReady, conversations, onConversationsLoaded, refreshKey]);

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
  const mainHasFolders = section === "normal" && (sections?.hasArchivedChats || sections?.hasLockedChats);
  const searchQuery = query.trim().toLocaleLowerCase();
  const filtered = conversations.filter((conversation) =>
    conversation.otherUserName.toLocaleLowerCase().includes(searchQuery) ||
    (conversation.otherUserMobileNumber ?? "").toLocaleLowerCase().includes(searchQuery),
  );

  let content = null;
  if (accessError) {
    content = <p role="status" className={"px-6 py-8 text-center text-sm " + muted}>{accessError}</p>;
  } else if (isLoading && !backendUnavailable) {
    content = (
      <div role="status" className={"flex min-h-48 items-center justify-center gap-3 px-6 text-sm " + muted}>
        <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading conversations...
      </div>
    );
  } else if (conversations.length === 0 && hasSnapshot) {
    content = (
      <div role="status" className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
        <MessageCircleMore size={42} className={"mb-4 " + muted} aria-hidden="true" />
        <h2 className="font-semibold">{section === "locked" ? "No locked chats" : section === "archived" ? "No archived chats" : mainHasFolders ? "No other chats" : "No conversations yet"}</h2>
        <p className={"mt-2 max-w-xs text-sm leading-6 " + muted}>
          {section === "normal" ? mainHasFolders ? "Open a folder above to view your chats." : "Your conversations will appear here once you start chatting." : "Chats you move here will keep their messages and unread counts."}
        </p>
      </div>
    );
  } else if (conversations.length > 0 && filtered.length === 0) {
    content = (
      <div role="status" className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
        <h2 className="font-semibold">No matching conversations</h2>
        <p className={"mt-2 text-sm leading-6 " + muted}>
          Try another username or mobile number.
        </p>
      </div>
    );
  } else if (filtered.length > 0) {
    content = (
      <ul aria-label="Conversations" className="px-2 pb-3">
        {filtered.map((conversation) => {
          const displayName = getDisplayName(conversation.otherUserName, conversation.otherUserMobileNumber);
          const timestamp = formatTimestamp(conversation.lastMessageAt);
          const unreadCount = conversation.unreadCount;
          const showUnread = unreadCount > 0;
          const unreadLabel = showUnread
            ? `, ${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`
            : "";
          return (
            <li
              key={conversation.conversationId}
              className={"relative border-b pr-11 " + (isDark ? "border-[#293854]" : "border-slate-200")}
            >
              <button
                type="button"
                data-conversation-id={conversation.conversationId}
                aria-label={"Open conversation with " + displayName + unreadLabel}
                aria-pressed={selectedConversationId === conversation.conversationId}
                aria-disabled={backendUnavailable || undefined}
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
                <span className="mt-1 flex min-w-0 items-center gap-2">
                  <span className={"min-w-0 flex-1 truncate text-sm " + muted}>
                    {conversation.lastMessage?.trim() || "No messages yet"}
                  </span>
                  {showUnread && (
                    <span
                      aria-hidden="true"
                      className={"inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs leading-none font-semibold text-white tabular-nums " +
                        (isDark
                          ? "bg-[#3B82F6] [text-shadow:1px_0_#111827,-1px_0_#111827,0_1px_#111827,0_-1px_#111827]"
                          : "bg-[#2563EB]")}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
              </span>
              </button>
              <details className="absolute top-3 right-0 z-10" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary").focus(); } }}>
                <summary aria-label={`Actions for ${displayName}`} className={`ml-auto flex min-h-11 w-11 cursor-pointer list-none items-center justify-center rounded-xl ${muted} hover:bg-slate-500/10 [&::-webkit-details-marker]:hidden`}><EllipsisVertical size={18} /></summary>
                <div className={`absolute top-full right-0 min-w-40 rounded-xl border p-1 shadow-xl ${isDark ? "border-[#293854] bg-[#111d31]" : "border-slate-200 bg-white"}`}>
                <button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; onAction?.("archive", conversation); }} className={`min-h-11 w-full rounded-lg px-3 text-left text-sm ${muted} hover:bg-slate-500/10`}>
                  {conversation.isArchived ? "Unarchive" : "Archive"}
                </button>
                <button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; onAction?.(conversation.isLocked ? "unlock" : "lock", conversation); }} className={`min-h-11 w-full rounded-lg px-3 text-left text-sm ${muted} hover:bg-slate-500/10`}>
                  {conversation.isLocked ? "Unlock chat" : "Lock chat"}
                </button>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section ref={containerRef} aria-label="Conversation list and search" className="flex min-h-0 flex-1 flex-col overflow-clip">
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
      {isRefreshing && <p role="status" className="sr-only">Updating conversations...</p>}
      <div
        id={listId}
        role="region"
        aria-label="Conversation results"
        aria-busy={isLoading || isRefreshing}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500"
      >
        {section === "normal" && (
          <div className="px-2">
            {[["archived", "Archived", Archive, sections?.hasArchivedChats], ["locked", "Locked Chats", LockKeyhole, sections?.hasLockedChats]]
              .filter(([, , , visible]) => visible)
              .map(([value, label, Icon]) => (
                <button key={value} type="button" onClick={() => onSectionOpen?.(value)} disabled={backendUnavailable || actionBusy}
                  className={`flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 ${isDark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                  <span className={`flex size-11 shrink-0 items-center justify-center ${isDark ? "text-blue-300" : "text-blue-600"}`}><Icon size={22} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
                  <ChevronRight size={18} className={`shrink-0 ${muted}`} aria-hidden="true" />
                </button>
              ))}
          </div>
        )}
        {content}
        {hasMore && <button type="button" disabled={isRefreshing} onClick={loadMore} className="mx-4 mb-4 min-h-11 rounded-xl border px-4 text-sm">Load more chats</button>}
      </div>
    </section>
  );
}
