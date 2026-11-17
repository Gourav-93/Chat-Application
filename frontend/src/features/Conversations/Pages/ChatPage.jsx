/**
 * File: ChatPage.jsx
 *
 * Purpose:
 * Provides the responsive Sandesh dashboard and selected conversation history.
 *
 * Responsibilities:
 * 1. Display searchable conversation summaries and request status.
 * 2. Support Dark and Light themes.
 * 3. Provide an accessible theme toggle.
 * 4. Integrate the signed-in user's profile and logout control.
 * 5. Manage conversation selection, successful list snapshots, and mobile Back focus.
 * 6. Search verified users in a New Chat dialog and open created conversations.
 */

import { useCallback, useContext, useRef, useState } from "react";
import { MessageCircleMore, Moon, SquarePen, Sun } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";
import ProfileMenu from "../Components/ProfileMenu";
import ConversationList from "../Components/ConversationList";
import NewChatDialog from "../Components/NewChatDialog";
import ChatPanel from "../../Messages/components/ChatPanel";
import useMessageHistory from "../../Messages/hooks/useMessageHistory";

export default function ChatPage() {
  const themeContext = useContext(ThemeContext);
  const isDark = themeContext?.isDark ?? true;
  const [selection, setSelection] = useState({
    conversation: null,
    generation: 0,
    focusRequest: null,
  });

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshVersionRef = useRef(0);
  const pendingCreatedRef = useRef(null);

  const openNewChat = useCallback(() => setNewChatOpen(true), []);
  const closeNewChat = useCallback(() => setNewChatOpen(false), []);

  // One dashboard-owned history hook; the sidebar retains its own list fetching.
  const history = useMessageHistory(selection);

  const handleSelect = useCallback((conversation) => {
    if (!Number.isInteger(conversation?.conversationId) ||
        conversation.conversationId <= 0) return;

    pendingCreatedRef.current = null;
    setSelection((previous) => ({
      conversation,
      generation: previous.generation + 1,
      focusRequest: null,
    }));
  }, []);

  const handleBack = useCallback(() => {
    pendingCreatedRef.current = null;
    setSelection((previous) => {
      if (!previous.conversation) return previous;
      const generation = previous.generation + 1;
      return {
        conversation: null,
        generation,
        focusRequest: {
          conversationId: previous.conversation.conversationId,
          generation,
        },
      };
    });
  }, []);

  const handleConversationStarted = useCallback((conversation) => {
    // Advance synchronously before any older response can reconcile selection.
    const version = refreshVersionRef.current + 1;
    refreshVersionRef.current = version;
    handleSelect(conversation);
    pendingCreatedRef.current = conversation.conversationId;
    setRefreshKey(version);
    setNewChatOpen(false);
  }, [handleSelect]);

  const handleConversationsLoaded = useCallback((conversations, snapshotVersion = 0) => {
    if (!Array.isArray(conversations) ||
        snapshotVersion !== refreshVersionRef.current) return;

    // Wait for server confirmation before a list snapshot can remove a new chat.
    const pendingId = pendingCreatedRef.current;
    if (pendingId !== null) {
      if (!conversations.some((conversation) => conversation.conversationId === pendingId)) return;
      pendingCreatedRef.current = null;
    }

    // Only successful unfiltered snapshots reach this callback.
    // Search changes and failed list requests must not close the active chat.
    setSelection((previous) => {
      if (!previous.conversation) return previous;
      const current = conversations.find((conversation) =>
        conversation.conversationId === previous.conversation.conversationId,
      );

      if (!current) {
        const generation = previous.generation + 1;
        return {
          conversation: null,
          generation,
          focusRequest: {
            conversationId: previous.conversation.conversationId,
            generation,
          },
        };
      }

      if (JSON.stringify(current) === JSON.stringify(previous.conversation)) {
        return previous;
      }

      // Metadata updates keep loaded history; a changed participant starts fresh.
      const participantChanged =
        String(current.otherUserId).toLowerCase() !==
        String(previous.conversation.otherUserId).toLowerCase();
      return {
        ...previous,
        conversation: current,
        generation: previous.generation + (participantChanged ? 1 : 0),
      };
    });
  }, []);

  const colors = {
    page: isDark ? "bg-[#080e1c] text-white" : "bg-slate-50 text-slate-900",
    sidebar: isDark
      ? "border-[#293854] bg-[#111d31]"
      : "border-slate-200 bg-white",
    border: isDark ? "border-[#293854]" : "border-slate-200",
    search: isDark
      ? "border-[#293854] bg-[#080e1c] text-slate-400"
      : "border-slate-200 bg-slate-100 text-slate-500",
    muted: isDark ? "text-slate-400" : "text-slate-500",
    icon: isDark ? "text-blue-400" : "text-blue-600",
    hover: isDark ? "hover:bg-white/10" : "hover:bg-slate-100",
  };

  return (
    <main className={`flex h-dvh overflow-hidden ${colors.page}`}>
      {/* Conversation sidebar */}
      <aside
        className={`${selection.conversation ? "hidden md:flex" : "flex"} min-h-0 w-full shrink-0 flex-col border-r md:w-[360px] lg:w-[400px] ${colors.sidebar}`}
      >
        <header
          className={`flex items-center justify-between gap-2 border-b px-3 py-5 sm:px-5 ${colors.border}`}
        >
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <MessageCircleMore className={`shrink-0 ${colors.icon}`} size={26} />
            <h1 className="truncate text-xl font-bold">Sandesh</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* Theme toggle */}
            <button
              type="button"
              onClick={themeContext?.toggleTheme}
              aria-label={
                isDark ? "Switch to light mode" : "Switch to dark mode"
              }
              title={isDark ? "Light mode" : "Dark mode"}
              className={`rounded-xl p-2 transition-colors ${colors.muted} ${colors.hover}`}
            >
              {isDark ? <Sun size={21} /> : <Moon size={21} />}
            </button>

            {/* Search registered users and create or reuse a conversation. */}
            <button
              type="button"
              aria-label="New conversation"
              aria-haspopup="dialog"
              aria-expanded={newChatOpen}
              onClick={openNewChat}
              className={`rounded-xl p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${colors.muted} ${colors.hover}`}
            >
              <SquarePen size={21} />
            </button>

            <ProfileMenu />
          </div>
        </header>

        <ConversationList
          onSelect={handleSelect}
          selectedConversationId={selection.conversation?.conversationId}
          onConversationsLoaded={handleConversationsLoaded}
          focusRequest={selection.focusRequest}
          refreshKey={refreshKey}
        />
      </aside>

      {selection.conversation ? (
        <ChatPanel selection={selection} history={history} onBack={handleBack} />
      ) : (
      <section className="hidden min-w-0 flex-1 items-center justify-center md:flex">
        <div className="max-w-sm px-6 text-center">
          <div
            className={`mx-auto mb-6 flex size-20 items-center justify-center rounded-3xl ${
              isDark ? "bg-blue-600/10" : "bg-blue-50"
            }`}
          >
            <MessageCircleMore size={38} className={colors.icon} />
          </div>

          <h2 className="text-2xl font-semibold">Welcome to Sandesh</h2>

          <p className={`mt-3 text-sm leading-7 ${colors.muted}`}>
            Select a conversation to view its messages.
          </p>
        </div>
      </section>
      )}
      {newChatOpen && (
        <NewChatDialog onClose={closeNewChat} onStarted={handleConversationStarted} />
      )}
    </main>
  );
}
