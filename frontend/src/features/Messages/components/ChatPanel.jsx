/**
 * File: ChatPanel.jsx
 * Purpose: Presents the selected conversation and its existing message history.
 * Responsibilities:
 * 1. Render mobile identity and chronological sent/received message bubbles.
 * 2. Show loading, empty, session guidance, retryable error, and older-page loading states.
 * 3. Support both themes, mobile Back navigation, and accessible focus.
 * 4. Preserve scroll position and keyboard focus during older-message pagination.
 */

import { useContext, useEffect, useId, useLayoutEffect, useRef } from "react";
import { ArrowLeft, LoaderCircle, MessageCircleMore, UserRound } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";

function formatMessageTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    label: date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    full: date.toLocaleString(),
  };
}

// History comes from the dashboard-owned hook; this component never fetches.
export default function ChatPanel({ selection, history, onBack }) {
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const headingId = useId();
  const headingRef = useRef(null);
  const viewportRef = useRef(null);
  const anchorRef = useRef(null);
  const positionedRef = useRef(null);
  const paginationFocusRef = useRef(null);
  const retryButtonRef = useRef(null);

  const conversation = selection?.conversation;
  const selectionKey = conversation
    ? conversation.conversationId + ":" + (selection.generation ?? 0)
    : null;
  const mobile = conversation?.otherUserMobileNumber?.trim() || "Sandesh user";
  const messages = history.messages;
  const busy = history.isLoading || history.isLoadingOlder;
  const muted = isDark ? "text-slate-400" : "text-slate-500";
  const showOlder = history.isLoadingOlder ||
    (!history.isLoading && !history.error && history.hasMore);

  useEffect(() => {
    paginationFocusRef.current = null;
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
  }, [messages, history.error, history.requiresSignIn, busy, selectionKey]);

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
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          title={mobile}
          className="min-w-0 truncate rounded text-base font-semibold focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          {mobile}
        </h2>
      </header>

      <div
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

        <ol aria-label="Messages" className="space-y-3">
          {messages.map((message) => {
            const own = Boolean(history.userId) &&
              message.senderId.toLowerCase() ===
                String(history.userId).toLowerCase();
            const timestamp = formatMessageTimestamp(message.sentAt);

            return (
              <li
                key={message.id}
                data-message-id={message.id}
                className={"flex " + (own ? "justify-end" : "justify-start")}
              >
                <div
                  className={"min-w-0 max-w-[90%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[80%] lg:max-w-[70%] " +
                    (own
                      ? "rounded-br-md bg-blue-600 text-white"
                      : isDark
                        ? "rounded-bl-md bg-[#1b2b45] text-slate-100"
                        : "rounded-bl-md border border-slate-200 bg-white text-slate-900")}
                >
                  <span className="sr-only">{own ? "You" : mobile}: </span>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6">
                    {message.text}
                  </p>
                  {timestamp ? (
                    <time
                      dateTime={timestamp.iso}
                      title={timestamp.full}
                      className={"mt-2 block text-right text-xs " +
                        (own ? "text-blue-100" : muted)}
                    >
                      {timestamp.label}
                    </time>
                  ) : (
                    <span className={"mt-2 block text-right text-xs " +
                      (own ? "text-blue-100" : muted)}>
                      Time unavailable
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
