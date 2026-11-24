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
 * 6. Preserve drafts, coordinate shared messaging, and open created conversations.
 * 7. Coordinate recipient activity, typing, and visible-chat reads through the shared session.
 * 8. Coordinate startup, welcome, and confirmed-outage views in the center panel.
 */

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ShieldCheck, LoaderCircle, MessageCircleMore, Moon, ServerOff, SquarePen, Sun } from "lucide-react";
import api from "../../../shared/lib/api";
import { clearPrivacy, getPrivacySnapshot, getPrivacyToken, setPrivacyAccess, subscribePrivacy } from "../../../shared/lib/privacyAccess";
import PrivacyPinDialog from "../Components/PrivacyPinDialog";
import { ThemeContext } from "../../../app/ThemeContext";
import ProfileMenu from "../Components/ProfileMenu";
import ConversationList from "../Components/ConversationList";
import NewChatDialog from "../Components/NewChatDialog";
import { getConversations, getConversationSections } from "../Services/ConversationService";
import usePrivacyIdleSession from "../Hooks/usePrivacyIdleSession";
import ChatPanel from "../../Messages/components/ChatPanel";
import useMessageHistory from "../../Messages/hooks/useMessageHistory";
import useChatSession from "../../Messages/hooks/useChatSession";
import useConversationActivity from "../../Messages/hooks/useConversationActivity";

const isGatewayFailure = (status) => status === 502 || status === 503 || status === 504;
const browserIsOnline = () => navigator.onLine !== false;

function isUnavailableApiError(error) {
  if (error?.response) return isGatewayFailure(error.response.status);
  return error?.isAxiosError === true && (
    error.code === "ERR_NETWORK" || error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" || (error.code == null && Boolean(error.request))
  );
}

function subscribeBrowserOnline(listener) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function ServerUnavailable({ colors, className }) {
  return (
    <section role="status" className={`items-center justify-center gap-3 text-center md:flex-col md:gap-5 ${className}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl md:size-16 ${colors.outageIcon}`}>
        <ServerOff size={26} aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-semibold md:text-2xl">Server unavailable</h2>
        <p className={`mt-1 flex items-center justify-center gap-2 text-sm md:mt-3 ${colors.muted}`}>
          <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Reconnecting automatically
        </p>
      </div>
    </section>
  );
}

export default function ChatPage() {
  const privacy = useSyncExternalStore(subscribePrivacy, getPrivacySnapshot);
  // A privacy boundary change destroys every private draft, buffer and pending view.
  return <ChatDashboard key={privacy.version} privacy={privacy} />;
}

function ChatDashboard({ privacy }) {
  const [section, setSection] = useState(getPrivacyToken() ? "locked" : "normal");
  const dashboardRef = useRef(null);
  const lockCurrentPrivacy = usePrivacyIdleSession(section === "locked", dashboardRef);
  const [sections, setSections] = useState(null);
  const [sectionsError, setSectionsError] = useState("");
  const [pinDialog, setPinDialog] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const themeContext = useContext(ThemeContext);
  const isDark = themeContext?.isDark ?? true;
  const [selection, setSelection] = useState({
    conversation: null,
    generation: 0,
    focusRequest: null,
  });

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [creationVersion, setCreationVersion] = useState(0);
  const creationVersionRef = useRef(0);
  const pendingCreatedRef = useRef(null);
  const outageEvidenceRef = useRef(null);
  const [confirmedOutage, setConfirmedOutage] = useState(null);
  const [toastOutage, setToastOutage] = useState(null);
  const browserOnline = useSyncExternalStore(subscribeBrowserOnline, browserIsOnline);

  // Messaging and history share exactly one session-owned transport.
  const session = useChatSession();
  const { owner, failure, status, requiresSignIn } = session;
  const gatewayFailure = failure?.kind === "http" && isGatewayFailure(failure.status);
  const failedAvailabilityCheck = gatewayFailure ||
    (failure?.kind === "network" && failure.status == null);
  const serverResponded = status === "connected" || failure?.kind === "auth" ||
    failure?.kind === "signalr-start" || failure?.kind === "signalr-setup" ||
    (failure?.kind === "http" && !gatewayFailure);
  const canShowOutage = browserOnline && owner && !requiresSignIn &&
    !serverResponded && failure?.kind !== "cleanup";
  const backendUnavailable = Boolean(canShowOutage && confirmedOutage?.owner === owner);
  const showOutageToast = backendUnavailable && toastOutage === confirmedOutage;
  const showWelcome = browserOnline && !requiresSignIn && status === "connected";
  const waitingForConnection = browserOnline && !requiresSignIn &&
    (status === "connecting" || failure?.retryable);
  const getBlockedOutage = useCallback(() => {
    const evidence = outageEvidenceRef.current;
    return evidence?.owner === owner && browserIsOnline() ? evidence.outage : null;
  }, [owner]);
  const openNewChat = useCallback(() => {
    if (!getBlockedOutage()) setNewChatOpen(true);
  }, [getBlockedOutage]);
  const closeNewChat = useCallback(() => setNewChatOpen(false), []);
  const refreshKey = `${creationVersion}:${session.revision}`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getConversationSections(controller.signal).then((flags) => {
        if (!controller.signal.aborted) { setSections(flags); setSectionsError(""); }
      }).catch(() => {
        if (!controller.signal.aborted) setSectionsError("Unable to update chat folders. Try again.");
      });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [refreshKey]);
  const history = useMessageHistory(selection, session);
  // An open New Chat dialog pauses selected-chat typing and read acknowledgements.
  const activity = useConversationActivity(selection, session, history, !newChatOpen && !pinDialog);
  const { onTypingInput, stopTyping, isTyping } = activity;
  const [drafts, setDrafts] = useState({});
  const draftsRef = useRef({});
  const submittedRef = useRef(null);
  const conversationId = selection.conversation?.conversationId;
  const draft = drafts[conversationId]?.text || "";
  const changeDraft = (text) => {
    if (!conversationId) return;
    const previous = draftsRef.current[conversationId];
    const next = { text, revision: (previous?.revision || 0) + 1 };
    draftsRef.current = { ...draftsRef.current, [conversationId]: next };
    setDrafts(draftsRef.current);
  };
  const sendDraft = async () => {
    const submitted = draftsRef.current[conversationId];
    if (!submitted?.text.trim() || session.sending?.pending ||
        submittedRef.current?.draft === submitted) return;
    const operation = { conversationId, draft: submitted };
    submittedRef.current = operation;
    const success = await session.send(conversationId, submitted.text);
    if (success && draftsRef.current[conversationId] === submitted) {
      // Do not erase text typed during the request or another conversation's draft.
      draftsRef.current = { ...draftsRef.current,
        [conversationId]: { text: "", revision: submitted.revision + 1 } };
      setDrafts(draftsRef.current);
    }
    if (submittedRef.current === operation) submittedRef.current = null;
  };

  const handleSelect = useCallback((conversation) => {
    if (!Number.isInteger(conversation?.conversationId) ||
        conversation.conversationId <= 0) return;

    const outage = getBlockedOutage();
    if (outage) {
      setToastOutage(outage);
      return;
    }

    pendingCreatedRef.current = null;
    setSelection((previous) => ({
      conversation,
      generation: previous.generation + 1,
      focusRequest: null,
    }));
  }, [getBlockedOutage]);

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

  useLayoutEffect(() => {
    const previous = outageEvidenceRef.current;
    if (!canShowOutage) {
      outageEvidenceRef.current = { owner, failure, count: 0, outage: null };
      if (previous?.outage) {
        queueMicrotask(() => setConfirmedOutage((current) => current === previous.outage ? null : current));
      }
      return undefined;
    }

    const recent = previous?.owner === owner ? previous : null;
    let count = recent?.count ?? 0;
    if (!failedAvailabilityCheck) count = 0;
    else if (recent?.failure !== failure) count += 1;
    const evidence = { owner, failure, count, outage: recent?.outage ?? null };
    outageEvidenceRef.current = evidence;
    if (!failedAvailabilityCheck || evidence.count < 2 || evidence.outage) return undefined;

    // Corroborate repeated session-check failures through a separate API route.
    const controller = new AbortController();
    void getConversations(controller.signal).catch((error) => {
      if (controller.signal.aborted || !browserIsOnline() ||
          !isUnavailableApiError(error)) return;

      const outage = { owner };
      outageEvidenceRef.current = { ...evidence, outage };
      setConfirmedOutage(outage);
      handleBack();
      setNewChatOpen(false);
    });
    return () => controller.abort();
  }, [owner, failure, failedAvailabilityCheck, canShowOutage, handleBack]);

  useEffect(() => {
    if (!showOutageToast) return undefined;
    const timer = window.setTimeout(() => setToastOutage(null), 4500);
    return () => window.clearTimeout(timer);
  }, [showOutageToast]);

  const handleConversationStarted = useCallback((conversation) => {
    if (outageEvidenceRef.current?.owner !== owner || getBlockedOutage()) return;

    // Advance synchronously before any older response can reconcile selection.
    const version = ++creationVersionRef.current;
    setSection(conversation.isLocked ? "locked" : conversation.isArchived ? "archived" : "normal");
    handleSelect(conversation);
    pendingCreatedRef.current = conversation.conversationId;
    setCreationVersion(version);
    setNewChatOpen(false);
  }, [getBlockedOutage, handleSelect, owner]);

  const handleConversationsLoaded = useCallback((conversations, snapshotVersion = 0) => {
    if (!Array.isArray(conversations) || snapshotVersion !== refreshKey ||
        creationVersion !== creationVersionRef.current) return;

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
  }, [creationVersion, refreshKey]);

  async function openPinDialog(action, conversation = null) {
    if (actionBusy) return;
    setActionBusy(true); setActionMessage("");
    try {
      const { data } = await api.get("/privacy");
      const nextAction = !data.pinConfigured && action === "change" ? "verify" : action;
      setPinDialog({ mode: data.pinConfigured ? action : "setup", action: nextAction, conversation });
    } catch (error) { setActionMessage(error.response?.data?.message || "Unable to load privacy settings. Try again."); }
    finally { setActionBusy(false); }
  }

  async function submitPin(values, signal) {
    if (pinDialog.mode === "setup") {
      await api.put("/privacy/pin", { pin: values.pin, confirmPin: values.confirmPin }, { signal });
      if (!signal.aborted) setPinDialog((current) => current ? { ...current, mode: current.action } : null);
    }
    if (pinDialog.action === "lock") {
      await api.put(`/conversations/${pinDialog.conversation.conversationId}/lock`, { pin: values.pin }, { signal });
      if (!signal.aborted) clearPrivacy("Chat locked. Find it in Locked Chats.");
    } else if (pinDialog.action === "change" && pinDialog.mode !== "setup") {
      await api.post("/privacy/pin/change", { currentPin: values.currentPin, newPin: values.pin, confirmPin: values.confirmPin }, { signal });
      if (!signal.aborted) clearPrivacy("Privacy PIN changed. Your private chats are protected.");
    } else {
      const { data } = await api.post("/privacy/locked-list-access", { pin: values.pin }, { signal });
      if (!signal.aborted) setPrivacyAccess(data);
    }
  }

  async function conversationAction(action, conversation) {
    if (actionBusy) return;
    if (action === "lock") { await openPinDialog("lock", conversation); return; }
    setActionBusy(true); setActionMessage("");
    try {
      const route = `/conversations/${conversation.conversationId}`;
      if (action === "unlock") {
        await api.post(`${route}/remove-lock`);
        clearPrivacy("Chat unlocked. Its archive setting has been preserved.");
      } else {
        if (conversation.isArchived) await api.delete(`${route}/archive`);
        else await api.put(`${route}/archive`);
        setActionMessage(conversation.isArchived ? "Chat unarchived." : "Chat archived. New messages will stay here.");
        handleBack();
        setCreationVersion((value) => value + 1);
        creationVersionRef.current++;
      }
    } catch (error) { setActionMessage(error.response?.data?.message || "Unable to update this chat. Try again."); }
    finally { setActionBusy(false); }
  }

  function leaveSection() {
    if (section === "locked") {
      void lockCurrentPrivacy().catch(() => {});
    } else {
      handleBack();
      setSection("normal");
    }
  }

  function openSection(nextSection) {
    if (nextSection === "locked") { void openPinDialog("verify"); return; }
    handleBack();
    setSection(nextSection);
  }

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
    outageIcon: isDark ? "bg-blue-500/15 text-blue-300" : "bg-blue-100 text-blue-700",
    hover: isDark ? "hover:bg-white/10" : "hover:bg-slate-100",
  };

  return (
    <main ref={dashboardRef} data-chat-dashboard className={`flex h-dvh overflow-hidden ${colors.page}`}>
      {/* Conversation sidebar */}
      <aside
        className={`${selection.conversation ? "hidden md:flex" : "flex"} min-h-0 w-full shrink-0 flex-col border-r md:w-[360px] lg:w-[400px] ${colors.sidebar}`}
      >
        <header
          className={`flex shrink-0 items-center justify-between gap-2 border-b px-3 py-5 sm:px-5 md:h-17 md:py-0 ${colors.border}`}
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
              title={section === "locked" ? "Return to main chats to start a conversation" : "New conversation"}
              aria-haspopup="dialog"
              aria-expanded={newChatOpen && !backendUnavailable}
              disabled={backendUnavailable || section === "locked"}
              onClick={openNewChat}
              className={`rounded-xl p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${colors.muted} ${colors.hover}`}
            >
              <SquarePen size={21} />
            </button>

            <ProfileMenu />
          </div>
        </header>

        <nav aria-label="Chat sections" className="shrink-0 border-b border-slate-500/15 px-3 py-2">
          {section !== "normal" && (
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={leaveSection} aria-label="Back to main chats" className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${colors.hover}`}><ArrowLeft size={21} /></button>
              <h2 className="min-w-0 truncate font-semibold">{section === "locked" ? "Locked Chats" : "Archived"}</h2>
            </div>
          )}
          <div className={`mt-1 flex items-center justify-between gap-2 text-xs ${colors.muted}`}>
            <button type="button" disabled={actionBusy} onClick={() => openPinDialog("change")} className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-slate-500/10"><ShieldCheck size={15} /> Privacy PIN</button>
            {privacy.token && <button type="button" onClick={leaveSection} className="min-h-11 rounded-lg px-2 hover:bg-slate-500/10">Lock now</button>}
          </div>
          {privacy.token && <p className={`px-2 pb-1 text-xs ${colors.muted}`}>Locks after 5 minutes of inactivity.</p>}
          {sectionsError && <p role="status" className={`px-2 py-2 text-xs ${colors.muted}`}>{sectionsError}</p>}
          {(actionMessage || privacy.reason) && <p role="status" className={`px-2 py-2 text-xs leading-5 ${colors.muted}`}>{actionMessage || privacy.reason}</p>}
        </nav>

        {backendUnavailable && (
          <ServerUnavailable colors={colors} className={`flex shrink-0 border-b px-4 py-4 md:hidden ${colors.border}`} />
        )}
        {!backendUnavailable && !selection.conversation && session.error && !failure?.retryable && (
          <p role="alert" className={`shrink-0 px-4 py-2 text-xs ${colors.muted}`}>{session.error}</p>
        )}
        <ConversationList
          key={section}
          section={section}
          sections={sections}
          onSectionOpen={openSection}
          actionBusy={actionBusy}
          onAction={conversationAction}
          backendUnavailable={backendUnavailable}
          onSelect={handleSelect}
          selectedConversationId={selection.conversation?.conversationId}
          onConversationsLoaded={handleConversationsLoaded}
          focusRequest={selection.focusRequest}
          refreshKey={refreshKey}
        />
      </aside>

      {backendUnavailable ? (
        <ServerUnavailable colors={colors} className="hidden min-w-0 flex-1 px-6 md:flex" />
      ) : selection.conversation ? (
        <ChatPanel selection={selection} history={history} onBack={handleBack}
          onConversationAction={conversationAction}
          session={session} activity={activity} draft={draft} onDraftChange={changeDraft} onSend={sendDraft}
          onTypingInput={onTypingInput} stopTyping={stopTyping} isTyping={isTyping} />
      ) : (
        <section className="hidden min-w-0 flex-1 items-center justify-center md:flex">
          {showWelcome ? (
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
          ) : waitingForConnection && (
            <p role="status" className={`flex items-center gap-2 text-sm ${colors.muted}`}>
              <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Connecting to Sandesh...
            </p>
          )}
        </section>
      )}
      {newChatOpen && !backendUnavailable && (
        <NewChatDialog onClose={closeNewChat} onStarted={handleConversationStarted} />
      )}
      {pinDialog && <PrivacyPinDialog mode={pinDialog.mode} onSubmit={submitPin} onClose={() => setPinDialog(null)} />}
      <div role="status" className="pointer-events-none fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm">
        {showOutageToast && (
          <p className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${colors.border} ${colors.sidebar}`}>
            Server unavailable. Please wait for the connection to return.
          </p>
        )}
      </div>
    </main>
  );
}
