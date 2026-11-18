/**
 * File: ChatPanel.jsx
 * Purpose: Presents conversation history, live messages, and the controlled composer.
 * Responsibilities:
 * 1. Render recipient activity, confirmed outgoing receipts, and date-grouped messages.
 * 2. Show loading, empty, session guidance, retryable error, and older-page loading states.
 * 3. Support both themes, mobile Back navigation, and accessible focus.
 * 4. Preserve scroll position and keyboard focus during older-message pagination.
 */

import { Fragment, useContext, useEffect, useId, useLayoutEffect, useRef } from "react";
import { ArrowLeft, Check, CheckCheck, LoaderCircle, MessageCircleMore, UserRound } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";
import { getDisplayName } from "../../../shared/lib/displayIdentity";
import MessageComposer from "./MessageComposer";

// Compare local calendar dates, including across DST changes and pagination.
function getLocalDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatMessageTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayKey = getLocalDateKey(date);
  return {
    iso: date.toISOString(),
    label: date.toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", hour12: true,
    }),
    full: date.toLocaleString(),
    dayKey,
    dayLabel: dayKey === getLocalDateKey(today) ? "Today" :
      dayKey === getLocalDateKey(yesterday) ? "Yesterday" :
        date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
  };
}

// Presence never determines receipts: only valid persisted/event timestamps do.
function getReceiptStatus(message) {
  const confirmed = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (confirmed(message.readAt)) return "Read";
  if (confirmed(message.deliveredAt)) return "Delivered";
  return "Sent";
}

// History comes from the dashboard-owned hook; this component never fetches.
export default function ChatPanel({
  selection, history, onBack, session, activity, draft, onDraftChange, onSend,
  onTypingInput, stopTyping, isTyping = false,
}) {
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const headingId = useId();
  const headingRef = useRef(null);
  const viewportRef = useRef(null);
  const anchorRef = useRef(null);
  const positionedRef = useRef(null);
  const paginationFocusRef = useRef(null);
  const retryButtonRef = useRef(null);
  const followBottomRef = useRef(true);
  const lastMessageRef = useRef(null);

  const conversation = selection?.conversation;
  const selectionKey = conversation
    ? conversation.conversationId + ":" + (selection.generation ?? 0)
    : null;
  const mobile = conversation?.otherUserMobileNumber?.trim() || "";
  const displayName = getDisplayName(conversation?.otherUserName, mobile);
  const messages = history.messages;
  const busy = history.isLoading || history.isLoadingOlder;
  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const activityAvailable = session.status === "connected" && !session.requiresSignIn;
  const recipientActivity = activityAvailable ? activity.label : "Activity unavailable";
  const activityError = activity.error || session.receiptError;
  const showOlder = history.isLoadingOlder ||
    (!history.isLoading && !history.error && history.hasMore);

  useEffect(() => {
    paginationFocusRef.current = null;
    followBottomRef.current = true;
    if (selectionKey) headingRef.current?.focus();

    const handleFocusChange = (event) => {
      const pending = paginationFocusRef.current;
      // Leave intentional navigation alone, including controls outside this panel.
      if (pending && event.target !== pending.button &&
          event.target !== document.body &&
          event.target !== document.documentElement) {
        paginationFocusRef.current = null;
      }
    };
    document.addEventListener("focusin", handleFocusChange);
    return () => {
      paginationFocusRef.current = null;
      document.removeEventListener("focusin", handleFocusChange);
    };
  }, [selectionKey]);

  useLayoutEffect(() => {
    if (paginationFocusRef.current?.selectionKey !== selectionKey) {
      paginationFocusRef.current = null;
    }
    const viewport = viewportRef.current;
    if (!viewport || busy) return;

    const anchor = anchorRef.current;
    if (anchor?.selectionKey === selectionKey) {
      const item = Array.from(
        viewport.querySelectorAll("[data-message-id]"),
      ).find((node) => node.dataset.messageId === anchor.id);

      // Anchor to an existing bubble so status/control height changes are safe.
      if (item) {
        const offset = item.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top;
        viewport.scrollTop += offset - anchor.offset;
      } else {
        viewport.scrollTop = anchor.top;
      }
      anchorRef.current = null;
    } else if (messages.length > 0 && positionedRef.current !== selectionKey) {
      // Delay initial positioning until messages arrive, including after retry.
      viewport.scrollTop = viewport.scrollHeight;
      positionedRef.current = selectionKey;
    }
    const last = messages.at(-1);
    const previousLast = lastMessageRef.current;
    if (!anchor && positionedRef.current === selectionKey &&
        (followBottomRef.current || (
          previousLast?.selectionKey === selectionKey && previousLast.id !== last?.id &&
          last?.senderId.toLowerCase() === String(history.userId).toLowerCase()
        ))) {
      viewport.scrollTop = viewport.scrollHeight;
    }
    lastMessageRef.current = { selectionKey, id: last?.id };
    const pending = paginationFocusRef.current;
    paginationFocusRef.current = null;
    const activeElement = document.activeElement;
    const focusWasLost = !activeElement || activeElement === document.body ||
      activeElement === document.documentElement || activeElement === pending?.button;

    // Restore only a removed pagination control's focus, after scroll correction.
    if (pending && !pending.button.isConnected && focusWasLost) {
      const target = history.error && !history.requiresSignIn
        ? retryButtonRef.current
        : viewport;
      (target || viewport).focus({ preventScroll: true });
    }
  }, [messages, history.error, history.requiresSignIn, history.userId, busy, selectionKey]);

  const rememberPosition = (button) => {
    paginationFocusRef.current = document.activeElement === button
      ? { button, selectionKey }
      : null;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const item = Array.from(
      viewport.querySelectorAll("[data-message-id]"),
    ).find((node) => node.getBoundingClientRect().bottom > bounds.top);

    anchorRef.current = {
      selectionKey,
      id: item?.dataset.messageId,
      offset: item ? item.getBoundingClientRect().top - bounds.top : 0,
      top: viewport.scrollTop,
    };
  };

  const handleRetry = (event) => {
    if (busy || history.requiresSignIn) return;
    if (history.page > 1) rememberPosition(event.currentTarget);
    history.retry();
  };

  const handleLoadOlder = (event) => {
    if (busy) return;
    rememberPosition(event.currentTarget);
    history.loadOlder();
  };

  if (!conversation) return null;

  return (
    <section
      aria-labelledby={headingId}
      className={"flex h-full min-h-0 min-w-0 flex-1 flex-col " +
        (isDark ? "bg-[#080e1c] text-white" : "bg-slate-50 text-slate-900")}
    >
      <header
        className={"flex shrink-0 items-center gap-3 border-b px-4 py-4 sm:px-6 " +
          (isDark
            ? "border-[#293854] bg-[#111d31]"
            : "border-slate-200 bg-white")}
      >
        {typeof onBack === "function" && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversations"
            className={"flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 md:hidden " +
              (isDark ? "hover:bg-white/10" : "hover:bg-slate-100")}
          >
            <ArrowLeft size={21} aria-hidden="true" />
          </button>
        )}
        <span
          aria-hidden="true"
          className={"flex size-11 shrink-0 items-center justify-center rounded-full " +
            (isDark
              ? "bg-blue-600/20 text-blue-200"
              : "bg-blue-50 text-blue-700")}
        >
          <UserRound size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            title={displayName}
            className="truncate rounded text-base font-semibold focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            {displayName}
          </h2>
          {mobile && (
            <p title={mobile} className={"mt-1 truncate text-xs " + muted}>
              {mobile}
            </p>
          )}
          <p role="status" title={recipientActivity}
            className={"mt-1 text-xs [overflow-wrap:anywhere] " +
              (activityAvailable && isTyping ? "italic " : "") +
              (recipientActivity === "Online"
                ? isDark ? "text-blue-300" : "text-blue-600"
                : muted)}>
            {recipientActivity}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span role="status" aria-label={"Chat connection: " + session.status}
            className={"rounded-full border px-2.5 py-1 text-[11px] font-medium " +
              (session.status === "connected"
                ? isDark ? "border-blue-400/20 bg-blue-600/15 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-700"
                : isDark ? "border-slate-600 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-600")}>
            {session.status === "connected" ? "Connected" :
              session.status === "connecting" ? "Connecting..." : "Disconnected"}
          </span>
          {session.status === "disconnected" && !session.requiresSignIn && (
            <button type="button" onClick={session.start}
              className="min-h-11 rounded px-2 text-xs text-blue-500 focus-visible:outline-2 focus-visible:outline-blue-500">Connect</button>
          )}
        </div>
      </header>
      {session.error && <p role="alert" className={"px-4 pb-2 text-xs " + muted}>{session.error}</p>}
      {activityError && (
        <div className={"flex shrink-0 flex-wrap items-center gap-2 px-4 py-2 text-xs " + muted}>
          <p role="alert">{activityError}</p>
          <button type="button" disabled={!activityAvailable}
            onClick={() => {
              if (!activityAvailable) return;
              if (activity.error) activity.retry();
              if (session.receiptError) session.retryReceipts();
            }}
            className="min-h-11 rounded px-2 text-blue-500 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50">
            Retry activity updates
          </button>
        </div>
      )}

      <div
        onScroll={(event) => {
          const viewport = event.currentTarget;
          followBottomRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 80;
        }}
        ref={viewportRef}
        role="region"
        aria-label="Message history"
        aria-busy={busy}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 sm:px-6"
      >
        {history.isLoading && (
          <p
            role="status"
            className={"flex items-center justify-center gap-3 py-10 text-sm " + muted}
          >
            <LoaderCircle
              size={20}
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
            Loading messages...
          </p>
        )}

        {!history.isLoading && history.error && (
          <div className="mb-5 rounded-2xl px-4 py-5 text-center">
            <p
              role="alert"
              className={"text-sm leading-6 " +
                (isDark ? "text-red-300" : "text-red-600")}
            >
              {history.error}
            </p>
            {history.requiresSignIn ? (
              <p className={"mt-3 text-sm leading-6 " + muted}>
                Open your profile menu and choose Logout, then sign in again.
                On mobile, use Back to conversations first.
              </p>
            ) : (
              <button
                ref={retryButtonRef}
                type="button"
                onClick={handleRetry}
                disabled={busy}
                className="mt-3 min-h-11 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {showOlder && (
          <div className="mb-5 text-center">
            <button
              type="button"
              disabled={history.isLoadingOlder}
              aria-busy={history.isLoadingOlder}
              onClick={handleLoadOlder}
              className={"min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60 " +
                (isDark
                  ? "border-[#293854] text-blue-300 hover:bg-white/5"
                  : "border-slate-200 text-blue-700 hover:bg-blue-50")}
            >
              {history.isLoadingOlder
                ? "Loading older messages..."
                : "Load older messages"}
            </button>
            <span role="status" className="sr-only">
              {history.isLoadingOlder ? "Loading older messages" : ""}
            </span>
          </div>
        )}

        {!busy && !history.error && messages.length === 0 && (
          <div role="status" className="flex flex-col items-center py-12 text-center">
            <MessageCircleMore size={38} aria-hidden="true" className={"mb-4 " + muted} />
            <h3 className="font-semibold">No messages yet</h3>
            <p className={"mt-2 text-sm leading-6 " + muted}>
              This conversation has no messages.
            </p>
          </div>
        )}

        <ol aria-label="Messages" className="space-y-2">
          {messages.map((message, index) => {
            const own = Boolean(history.userId) &&
              message.senderId.toLowerCase() === String(history.userId).toLowerCase();
            const receiptStatus = own ? getReceiptStatus(message) : null;
            const ReceiptIcon = receiptStatus === "Sent" ? Check : CheckCheck;
            const timestamp = formatMessageTimestamp(message.sentAt);
            const previousTimestamp = index > 0
              ? formatMessageTimestamp(messages[index - 1].sentAt) : null;
            // Derive boundaries from the merged list, never from individual pages.
            const showDate = timestamp && timestamp.dayKey !== previousTimestamp?.dayKey;

            return (
              <Fragment key={message.id}>
                {showDate && (
                  <li className="flex justify-center py-2">
                    <time dateTime={timestamp.dayKey}
                      className={"rounded-full border px-3 py-1 text-[11px] font-medium " +
                        (isDark ? "border-[#293854] bg-[#111d31] text-slate-300" :
                          "border-slate-200 bg-slate-100 text-slate-600")}>
                      {timestamp.dayLabel}
                    </time>
                  </li>
                )}
                <li data-message-id={message.id}
                  className={"flex " + (own ? "justify-end" : "justify-start")}>
                  <div className="min-w-0 max-w-[90%] sm:max-w-[80%] lg:max-w-[70%]">
                    <div className={"rounded-2xl px-3 py-2 shadow-sm " +
                      (own ? "rounded-br-md bg-blue-600 text-white" :
                        isDark ? "rounded-bl-md bg-[#1b2b45] text-slate-100" :
                          "rounded-bl-md border border-slate-200 bg-white text-slate-900")}>
                      <span className="sr-only">{own ? "You" : displayName}: </span>
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-5">
                        {message.text}
                      </p>
                    </div>
                    <div className={"mt-1 flex items-center justify-end gap-1 px-1 text-[11px] " + muted}>
                      {timestamp ? (
                        <time dateTime={timestamp.iso} title={timestamp.full} aria-label={timestamp.full}>
                          {timestamp.label}
                        </time>
                      ) : <span>Time unavailable</span>}
                      {own && (
                        <span title={receiptStatus}
                          className={"inline-flex w-4 shrink-0 items-center justify-center " +
                            (receiptStatus === "Read"
                              ? isDark ? "text-blue-400" : "text-blue-600"
                              : muted)}>
                          <span className="sr-only">{receiptStatus}</span>
                          <ReceiptIcon size={15} aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
      <MessageComposer value={draft} onChange={onDraftChange} onSend={onSend}
        onTypingInput={onTypingInput} stopTyping={stopTyping}
        pending={Boolean(session.sending?.pending)}
        disabled={session.status !== "connected" || session.requiresSignIn || busy || Boolean(history.error)}
        error={session.sending?.conversationId === conversation.conversationId ? session.sending.error : ""} />
    </section>
  );
}
