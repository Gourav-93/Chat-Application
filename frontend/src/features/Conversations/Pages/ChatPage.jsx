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
 * 9. Manage Chat Lock settings, PIN-authorized recovery, and private chat entry.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  LoaderCircle,
  MessageCircleMore,
  Moon,
  ServerOff,
  Settings,
  SquarePen,
  Sun,
  X,
} from "lucide-react";
import api from "../../../shared/lib/api";
import {
  clearPrivacy,
  getPrivacySnapshot,
  getPrivacyToken,
  setPrivacyAccess,
  subscribePrivacy,
} from "../../../shared/lib/privacyAccess";
import PrivacyPinDialog from "../Components/PrivacyPinDialog";
import ChatLockSettingsDialog from "../Components/ChatLockSettingsDialog";
import { AuthContext } from "../../../app/AuthContext";
import { ThemeContext } from "../../../app/ThemeContext";
import ProfileMenu from "../Components/ProfileMenu";
import ConversationList from "../Components/ConversationList";
import NewChatDialog from "../Components/NewChatDialog";
import {
  clearConversation,
  deleteConversationForMe,
  disableSecretCode,
  getChatLockSettings,
  getConversations,
  getConversationSections,
  setHideLockedChats,
  setSecretCode,
  withPrivacyToken,
} from "../Services/ConversationService";
import usePrivacyIdleSession from "../Hooks/usePrivacyIdleSession";
import ChatPanel from "../../Messages/components/ChatPanel";
import useMessageHistory from "../../Messages/hooks/useMessageHistory";
import useChatSession from "../../Messages/hooks/useChatSession";
import useConversationActivity from "../../Messages/hooks/useConversationActivity";
import useUserBlocks from "../Hooks/useUserBlocks";
import UserBlockingDialog from "../Components/UserBlockingDialog";

const isGatewayFailure = (status) =>
  status === 502 || status === 503 || status === 504;
const browserIsOnline = () => navigator.onLine !== false;

const settingsPinPurpose = {
  title: "Verify your Privacy PIN",
  description: "Enter your existing PIN to update Chat Lock settings.",
  submitLabel: "Verify and save",
  error: "Unable to update Chat Lock settings. Try again.",
};

const unlockPinPurpose = {
  title: "Remove chat lock",
  description: "Enter your existing Privacy PIN to remove this chat lock.",
  submitLabel: "Remove lock",
  error: "Unable to remove this chat lock. Try again.",
};

function settingsError(error) {
  const code = error.response?.data?.code;
  if (code === "privacy_secret_code_format")
    return "Enter a non-blank Secret Code of up to 100 Unicode characters.";
  if (code === "privacy_secret_code_mismatch")
    return "The Secret Codes do not match.";
  if (code === "privacy_setup_required")
    return "Set your Privacy PIN before changing Chat Lock settings.";
  if (code === "privacy_conflict" || code === "privacy_secret_code_required")
    return "Chat Lock settings changed. Review them and try again.";
  if (error.response?.status === 429)
    return "Too many requests. Wait before trying again.";
  if (error.response?.status === 401)
    return "Your login has expired. Sign in again.";
  return "Unable to save Chat Lock settings. Check your connection and try again.";
}

function privacyNotice(reason, showLockedFolder) {
  if (!showLockedFolder) {
    if (reason === "Chat locked. Find it in Locked Chats.")
      return "Chat locked";
    if (reason === "Privacy PIN changed. Your private chats are protected.")
      return "PIN changed";
    if (reason === "Chat unlocked. Its archive setting has been preserved.")
      return "Chat lock removed";
    return "";
  }
  switch (reason) {
    case "Privacy PIN changed. Your private chats are protected.":
      return "PIN changed";
    case "Chat locked. Find it in Locked Chats.":
      return "Chat moved to Locked Chats";
    case "Chat unlocked. Its archive setting has been preserved.":
      return "Chat lock removed";
    case "Your privacy session expired. Enter your PIN again.":
      return "Locked Chats access expired. Enter your PIN again.";
    case "Privacy access could not be renewed. Enter your PIN again.":
      return "Locked Chats closed. Enter your PIN again.";
    case "":
    case "Locked Chats are protected.":
      return "";
    default:
      return "Locked Chats closed. Enter your PIN again.";
  }
}

function isUnavailableApiError(error) {
  if (error?.response) return isGatewayFailure(error.response.status);
  return (
    error?.isAxiosError === true &&
    (error.code === "ERR_NETWORK" ||
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT" ||
      (error.code == null && Boolean(error.request)))
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
    <section
      role="status"
      className={`items-center justify-center gap-3 text-center md:flex-col md:gap-5 ${className}`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-2xl md:size-16 ${colors.outageIcon}`}
      >
        <ServerOff size={26} aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-semibold md:text-2xl">Server unavailable</h2>
        <p
          className={`mt-1 flex items-center justify-center gap-2 text-sm md:mt-3 ${colors.muted}`}
        >
          <LoaderCircle
            size={15}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Reconnecting automatically
        </p>
      </div>
    </section>
  );
}

function ClearConversationDialog({ kind, isDark, busy, error, onCancel, onConfirm }) {
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    (busy ? dialogRef.current : cancelRef.current)?.focus();
    const onKey = (event) => { if (event.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  const media = kind === "media";
  const chat = kind === "chat";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
    <div ref={dialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="clear-dialog-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
        if (!controls.length) { event.preventDefault(); dialogRef.current.focus(); return; }
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }}
      className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${isDark ? "border-[#293854] bg-[#111d31] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
      <h2 id="clear-dialog-title" className="text-lg font-semibold">{chat ? "Delete chat?" : media ? "Clear media?" : "Clear messages?"}</h2>
      <p className="mt-3 text-sm leading-6 opacity-80">{chat ? "This chat and its existing history will disappear from your view only. The other participant keeps the conversation. A new message will make it appear again." : media ? "Existing shared images and files will be removed from your view only. Text messages will stay visible. The other participant keeps their attachments." : "Existing messages will be removed from your view only. The conversation and the other participant’s messages are not affected."}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl px-4 text-sm hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-blue-500">Cancel</button><button type="button" disabled={busy} onClick={onConfirm} className={`min-h-11 rounded-xl px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60 ${chat ? "bg-red-600" : "bg-blue-600"}`}>{busy ? "Working…" : chat ? "Delete chat" : media ? "Clear media" : "Clear messages"}</button></div>
    </div>
  </div>;
}

export default function ChatPage() {
  const auth = useContext(AuthContext);
  const privacy = useSyncExternalStore(subscribePrivacy, getPrivacySnapshot);
  const accountToken = auth?.user?.token;
  const previousAccount = useRef(accountToken);
  useLayoutEffect(() => {
    if (previousAccount.current === accountToken) return;
    previousAccount.current = accountToken;
    if (getPrivacySnapshot().token) clearPrivacy("");
  }, [accountToken]);
  if (!auth?.isAuthenticated || !accountToken) return null;
  return <ChatLockDashboard key={accountToken} privacy={privacy} />;
}

function ChatLockDashboard({ privacy }) {
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const [modal, setModal] = useState(null);
  const requestRef = useRef(null);
  const reloadSettings = useCallback(
    () => setSettingsVersion((value) => value + 1),
    [],
  );
  const latest =
    snapshot?.version === privacy.version &&
    snapshot.refresh === settingsVersion
      ? snapshot
      : null;
  const settings = latest?.settings ?? null;
  // A settings write revokes the current grant before its HTTP response may arrive.
  const currentModal =
    modal &&
    (modal.version === privacy.version || (modal.saving && !privacy.reason))
      ? modal
      : null;

  useEffect(() => {
    const controller = new AbortController();
    void getChatLockSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted)
          setSnapshot({
            version: privacy.version,
            refresh: settingsVersion,
            settings,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSnapshot({
            version: privacy.version,
            refresh: settingsVersion,
            settings: null,
          });
      });
    return () => controller.abort();
  }, [privacy.version, settingsVersion]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function openSettings(view, returnFocus) {
    if (currentModal) return;
    setModal({
      view,
      returnFocus,
      version: privacy.version,
      formVersion: 0,
      authorization: null,
      saving: false,
      error: "",
    });
  }

  function closeSettings() {
    if (requestRef.current) return;
    const trigger = currentModal?.returnFocus;
    setModal(null);
    window.requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const target = trigger?.isConnected
        ? trigger
        : document.querySelector('[aria-label="Your profile"]');
      target?.focus({ preventScroll: true });
    });
  }

  async function saveSettings(action, currentPin, signal) {
    if (
      !currentModal ||
      requestRef.current ||
      getPrivacySnapshot().version !== currentModal.version
    )
      return;
    if (action.recovery && !currentPin) {
      setModal({ ...currentModal, authorization: action, error: "" });
      return;
    }

    const controller = new AbortController();
    const operationSignal = signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal;
    const version = currentModal.version;
    requestRef.current = controller;
    setModal({ ...currentModal, saving: true, error: "" });
    try {
      const values = currentPin
        ? { ...action.values, currentPin }
        : action.values;
      if (action.type === "code") await setSecretCode(values, operationSignal);
      else if (action.type === "hide")
        await setHideLockedChats(values, operationSignal);
      else await disableSecretCode(values, operationSignal, action.recovery);
      if (operationSignal.aborted) return;

      // Apply local revocation only while the original grant boundary is current.
      if (getPrivacySnapshot().version === version && getPrivacyToken())
        clearPrivacy("");
      reloadSettings();
      if (action.recovery) {
        setModal(null);
        window.requestAnimationFrame(() => {
          if (document.activeElement === document.body) {
            document
              .querySelector('[aria-label="Your profile"]')
              ?.focus({ preventScroll: true });
          }
        });
      } else {
        setModal({
          ...currentModal,
          view: "settings",
          version: getPrivacySnapshot().version,
          authorization: null,
          saving: false,
          error: "",
          formVersion: currentModal.formVersion + 1,
        });
      }
    } catch (error) {
      if (operationSignal.aborted) return;
      const code = error.response?.data?.code;
      const needsPin = !currentPin && code === "privacy_pin_required";
      if (
        code === "privacy_conflict" ||
        code === "privacy_secret_code_required" ||
        error.response?.status >= 500 ||
        !error.response
      )
        reloadSettings();
      setModal({
        ...currentModal,
        saving: false,
        authorization: needsPin ? action : currentModal.authorization,
        error: needsPin || currentPin ? "" : settingsError(error),
      });
      if (currentPin) throw error;
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <>
      {/* A boundary change destroys private drafts, history buffers, and the selected view. */}
      <ChatDashboard
        key={privacy.version}
        privacy={privacy}
        chatLockSettings={settings}
        reloadChatLockSettings={reloadSettings}
        openChatLockSettings={openSettings}
        settingsOpen={!!currentModal}
      />
      {currentModal && (
        <ChatLockSettingsDialog
          key={currentModal.formVersion}
          initialView={currentModal.view}
          settings={settings}
          settingsFailed={latest !== null && settings === null}
          suspended={!!currentModal.authorization}
          busy={currentModal.saving}
          error={currentModal.error}
          onClose={closeSettings}
          onReload={reloadSettings}
          onSave={saveSettings}
        />
      )}
      {currentModal?.authorization && (
        <PrivacyPinDialog
          mode="verify"
          purpose={settingsPinPurpose}
          onSubmit={({ pin }, signal) =>
            saveSettings(currentModal.authorization, pin, signal)
          }
          onClose={() => setModal({ ...currentModal, authorization: null })}
        />
      )}
    </>
  );
}

function ChatDashboard({
  privacy,
  chatLockSettings,
  reloadChatLockSettings,
  openChatLockSettings,
  settingsOpen,
}) {
  const [blockDialog, setBlockDialog] = useState(null);
  const [pinConfigured, setPinConfigured] = useState(null);
  const [section, setSection] = useState(
    getPrivacyToken() ? "locked" : "normal",
  );
  const dashboardRef = useRef(null);
  useLayoutEffect(() => {
    if (!privacy.version || document.activeElement !== document.body) return;
    const target = privacy.token
      ? "[data-section-heading]"
      : privacy.reason ===
          "Privacy PIN changed. Your private chats are protected."
        ? '[aria-label="Your profile"]'
        : '[role="searchbox"]';
    dashboardRef.current?.querySelector(target)?.focus({ preventScroll: true });
  }, [privacy.version, privacy.token, privacy.reason]);
  const lockCurrentPrivacy = usePrivacyIdleSession(
    section === "locked",
    dashboardRef,
  );
  const [sections, setSections] = useState(null);
  const [sectionsError, setSectionsError] = useState("");
  const [pinDialog, setPinDialog] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const handledPrivacyNotice = useRef(false);
  useEffect(() => {
    if (handledPrivacyNotice.current || !privacy.reason) return undefined;
    const text = privacyNotice(
      privacy.reason,
      chatLockSettings?.hideLockedChats === false,
    );
    if (!text && !chatLockSettings) return undefined;
    const timer = window.setTimeout(() => {
      handledPrivacyNotice.current = true;
      if (text)
        setActionMessage((current) => current || { text, error: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [privacy.reason, chatLockSettings]);
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingConversationId, setPendingConversationId] = useState(null);
  const [clearDialog, setClearDialog] = useState(null);
  const actionRequestRef = useRef(null);
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
  const browserOnline = useSyncExternalStore(
    subscribeBrowserOnline,
    browserIsOnline,
  );

  // Messaging and history share exactly one session-owned transport.
  const session = useChatSession();
  const blocks = useUserBlocks(session.userId, selection.conversation?.otherUserId, session.blockRevision, session.status);
  const { owner, failure, status, requiresSignIn } = session;
  useLayoutEffect(() => {
    if (status === "connected" || status === "disconnected")
      reloadChatLockSettings();
  }, [status, reloadChatLockSettings]);
  const gatewayFailure =
    failure?.kind === "http" && isGatewayFailure(failure.status);
  const failedAvailabilityCheck =
    gatewayFailure || (failure?.kind === "network" && failure.status == null);
  const serverResponded =
    status === "connected" ||
    failure?.kind === "auth" ||
    failure?.kind === "signalr-start" ||
    failure?.kind === "signalr-setup" ||
    (failure?.kind === "http" && !gatewayFailure);
  const canShowOutage =
    browserOnline &&
    owner &&
    !requiresSignIn &&
    !serverResponded &&
    failure?.kind !== "cleanup";
  const backendUnavailable = Boolean(
    canShowOutage && confirmedOutage?.owner === owner,
  );
  const showOutageToast = backendUnavailable && toastOutage === confirmedOutage;
  const showWelcome =
    browserOnline && !requiresSignIn && status === "connected";
  const waitingForConnection =
    browserOnline &&
    !requiresSignIn &&
    (status === "connecting" || failure?.retryable);
  const getBlockedOutage = useCallback(() => {
    const evidence = outageEvidenceRef.current;
    return evidence?.owner === owner && browserIsOnline()
      ? evidence.outage
      : null;
  }, [owner]);
  const openNewChat = useCallback(() => {
    if (!getBlockedOutage()) setNewChatOpen(true);
  }, [getBlockedOutage]);
  const closeNewChat = useCallback(() => setNewChatOpen(false), []);
  const refreshKey = `${creationVersion}:${session.revision}`;
  const refreshConversations = () =>
    setCreationVersion(++creationVersionRef.current);
  useEffect(() => () => actionRequestRef.current?.abort(), []);
  useEffect(() => {
    if (!actionMessage || actionMessage.error) return undefined;
    const timer = window.setTimeout(() => setActionMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getConversationSections(controller.signal)
        .then((flags) => {
          if (!controller.signal.aborted) {
            setSections(flags);
            setSectionsError("");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSectionsError("Unable to update chat folders. Try again.");
        });
      void api
        .get("/privacy", { signal: controller.signal })
        .then(({ data }) => {
          if (!controller.signal.aborted) {
            setPinConfigured(data?.pinConfigured === true);
          }
        })
        .catch(() => {});
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [refreshKey]);
  const history = useMessageHistory(selection, session);
 // Modal workflows pause selected-chat typing and read acknowledgements.
const activity = useConversationActivity(
  selection,
  session,
  history,
  !newChatOpen && !pinDialog && !blockDialog && !settingsOpen,
);
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
  const sendDraft = async (attachmentIds = [], clientMessageId = null, caption = null, location = null) => {
    if (blocks.loading || blocks.busy || blocks.isBlocked(selection.conversation?.otherUserId)) return false;
    const submitted = draftsRef.current[conversationId];
    const text = caption ?? submitted?.text ?? "";
    if ((!text.trim() && !attachmentIds.length && !location) || session.sending?.pending ||
        submittedRef.current) return false;
    const operation = { conversationId, draft: submitted };
    submittedRef.current = operation;
    const success = await session.send(conversationId, text, attachmentIds, clientMessageId, location);
    if (success && submitted && draftsRef.current[conversationId] === submitted && submitted.text === text) {
      // Do not erase text typed during the request or another conversation's draft.
      draftsRef.current = {
        ...draftsRef.current,
        [conversationId]: { text: "", revision: submitted.revision + 1 },
      };
      setDrafts(draftsRef.current);
    }
    if (submittedRef.current === operation) submittedRef.current = null;
    return success;
  };

  const handleSelect = useCallback(
    (conversation) => {
      if (
        !Number.isInteger(conversation?.conversationId) ||
        conversation.conversationId <= 0
      )
        return;

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
    },
    [getBlockedOutage],
  );

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
        queueMicrotask(() =>
          setConfirmedOutage((current) =>
            current === previous.outage ? null : current,
          ),
        );
      }
      return undefined;
    }

    const recent = previous?.owner === owner ? previous : null;
    let count = recent?.count ?? 0;
    if (!failedAvailabilityCheck) count = 0;
    else if (recent?.failure !== failure) count += 1;
    const evidence = { owner, failure, count, outage: recent?.outage ?? null };
    outageEvidenceRef.current = evidence;
    if (!failedAvailabilityCheck || evidence.count < 2 || evidence.outage)
      return undefined;

    // Corroborate repeated session-check failures through a separate API route.
    const controller = new AbortController();
    void getConversations(controller.signal).catch((error) => {
      if (
        controller.signal.aborted ||
        !browserIsOnline() ||
        !isUnavailableApiError(error)
      )
        return;

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

  const handleConversationStarted = useCallback(
    (conversation) => {
      if (outageEvidenceRef.current?.owner !== owner || getBlockedOutage())
        return;

      // Advance synchronously before any older response can reconcile selection.
      const version = ++creationVersionRef.current;
      setSection(
        conversation.isLocked
          ? "locked"
          : conversation.isArchived
            ? "archived"
            : "normal",
      );
      handleSelect(conversation);
      pendingCreatedRef.current = conversation.conversationId;
      setCreationVersion(version);
      setNewChatOpen(false);
    },
    [getBlockedOutage, handleSelect, owner],
  );

  const handleConversationsLoaded = useCallback(
    (conversations, snapshotVersion = 0) => {
      if (
        !Array.isArray(conversations) ||
        snapshotVersion !== refreshKey ||
        creationVersion !== creationVersionRef.current
      )
        return;

      // Wait for server confirmation before a list snapshot can remove a new chat.
      const pendingId = pendingCreatedRef.current;
      if (pendingId !== null) {
        if (
          !conversations.some(
            (conversation) => conversation.conversationId === pendingId,
          )
        )
          return;
        pendingCreatedRef.current = null;
      }

      // Only successful unfiltered snapshots reach this callback.
      // Search changes and failed list requests must not close the active chat.
      setSelection((previous) => {
        if (!previous.conversation) return previous;
        const current = conversations.find(
          (conversation) =>
            conversation.conversationId ===
            previous.conversation.conversationId,
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
    },
    [creationVersion, refreshKey],
  );
  function restoreActionFocus(previousFocus, conversationId) {
    window.requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const target =
        previousFocus?.isConnected && !previousFocus.disabled
          ? previousFocus
          : dashboardRef.current?.querySelector(
              `[data-conversation-id="${conversationId}"]`,
            ) || dashboardRef.current?.querySelector('[role="searchbox"]');
      target?.focus({ preventScroll: true });
    });
  }

  async function openPinDialog(action, conversation = null) {
    if (actionRequestRef.current || pinDialog) return;
    const returnFocus = document.activeElement;
    const controller = new AbortController();
    actionRequestRef.current = controller;
    setActionBusy(true);
    setPendingConversationId(conversation?.conversationId ?? null);
    setActionMessage(null);
    try {
      const { data } = await api.get("/privacy", { signal: controller.signal });
      if (controller.signal.aborted) return;
      const configured = data?.pinConfigured === true;
      setPinConfigured(configured);
      setPinDialog({
        mode: !configured ? "setup" : action === "manage" ? "change" : action,
        conversation,
        retryAt: data?.retryAt,
        returnFocus,
      });
    } catch {
      if (!controller.signal.aborted)
        setActionMessage({
          text: "Unable to load privacy settings. Try again.",
          error: true,
        });
    } finally {
      if (actionRequestRef.current === controller)
        actionRequestRef.current = null;
      if (!controller.signal.aborted) {
        setActionBusy(false);
        setPendingConversationId(null);
        restoreActionFocus(returnFocus, conversation?.conversationId);
      }
    }
  }

  async function submitPin(values, signal) {
    if (pinDialog.mode === "setup") {
      await api.put(
        "/privacy/pin",
        { pin: values.pin, confirmPin: values.confirmPin },
        { signal },
      );
      if (!signal.aborted) {
        setPinConfigured(true);
        setPinDialog(null);
        setActionMessage({ text: "Privacy PIN set", error: false });
      }
      return;
    }
    if (pinDialog.mode === "lock") {
      await api.put(
        `/conversations/${pinDialog.conversation.conversationId}/lock`,
        { pin: values.pin },
        { signal },
      );
      if (!signal.aborted)
        clearPrivacy("Chat locked. Find it in Locked Chats.");
    } else if (pinDialog.mode === "unlock") {
      const { data } = await api.post(
        "/privacy/locked-list-access",
        { pin: values.pin },
        { signal },
      );
      try {
        await api.post(
          `/conversations/${pinDialog.conversation.conversationId}/remove-lock`,
          null,
          withPrivacyToken(data.token, signal),
        );
        if (!signal.aborted)
          clearPrivacy(
            "Chat unlocked. Its archive setting has been preserved.",
          );
      } finally {
        void api
          .post("/privacy/session/lock", { token: data.token })
          .catch(() => {});
      }
    } else if (pinDialog.mode === "change") {
      await api.post(
        "/privacy/pin/change",
        {
          currentPin: values.currentPin,
          newPin: values.pin,
          confirmPin: values.confirmPin,
        },
        { signal },
      );
      if (!signal.aborted)
        clearPrivacy("Privacy PIN changed. Your private chats are protected.");
    } else {
      const { data } = await api.post(
        "/privacy/locked-list-access",
        { pin: values.pin },
        { signal },
      );
      if (!signal.aborted) setPrivacyAccess(data);
    }
  }

  async function conversationAction(action, conversation) {
    if (action === "block") { if (!blocks.busy) setBlockDialog({ contact: conversation }); return; }
    if (action === "clear-messages" || action === "clear-media" || action === "delete-chat") {
      if (!actionRequestRef.current) setClearDialog({ kind: action === "clear-media" ? "media" : action === "delete-chat" ? "chat" : "messages", conversation, returnFocus: document.activeElement });
      return;
    }
    if (actionRequestRef.current || pinDialog) return;
    if (action === "lock") {
      await openPinDialog("lock", conversation);
      return;
    }
    const returnFocus = document.activeElement;
    const controller = new AbortController();
    actionRequestRef.current = controller;
    setActionBusy(true);
    setPendingConversationId(conversation.conversationId);
    setActionMessage(null);
    try {
      const route = `/conversations/${conversation.conversationId}`;
      if (action === "unlock") {
        await api.post(`${route}/remove-lock`, null, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          clearPrivacy(
            "Chat unlocked. Its archive setting has been preserved.",
          );
      } else {
        const { data } = conversation.isArchived
          ? await api.delete(`${route}/archive`, { signal: controller.signal })
          : await api.put(`${route}/archive`, null, {
              signal: controller.signal,
            });
        if (controller.signal.aborted) return;
        setActionMessage({
          text: data.isArchived ? "Chat archived" : "Chat unarchived",
          error: false,
        });
        const destination = data.isLocked
          ? "locked"
          : data.isArchived
            ? "archived"
            : "normal";
        setSelection((previous) => {
          if (
            previous.conversation?.conversationId !==
            conversation.conversationId
          )
            return previous;
          if (destination === section)
            return {
              ...previous,
              conversation: {
                ...previous.conversation,
                isArchived: data.isArchived,
                isLocked: data.isLocked,
              },
            };
          const generation = previous.generation + 1;
          return {
            conversation: null,
            generation,
            focusRequest: {
              conversationId: conversation.conversationId,
              generation,
            },
          };
        });
        refreshConversations();
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        action === "unlock" &&
        error.response?.data?.code === "privacy_pin_required"
      ) {
        setPinDialog({ mode: "unlock", conversation, returnFocus });
      } else if (!controller.signal.aborted) {
        setActionMessage({
          text: "Unable to update this chat. Try again.",
          error: true,
        });
      }
    } finally {
      if (actionRequestRef.current === controller)
        actionRequestRef.current = null;
      if (!controller.signal.aborted) {
        setActionBusy(false);
        setPendingConversationId(null);
        restoreActionFocus(returnFocus, conversation.conversationId);
      }
    }
  }

  async function confirmClear() {
    if (!clearDialog || actionRequestRef.current) return;
    const dialog = clearDialog;
    const controller = new AbortController();
    actionRequestRef.current = controller;
    setActionBusy(true); setPendingConversationId(dialog.conversation.conversationId); setActionMessage(null);
    try {
      if (dialog.kind === "chat") await deleteConversationForMe(dialog.conversation.conversationId, controller.signal);
      else await clearConversation(dialog.conversation.conversationId, dialog.kind, controller.signal);
      if (controller.signal.aborted) return;
      session.clearCachedVisibility(dialog.conversation.conversationId, dialog.kind === "media");
      setClearDialog(null);
      window.requestAnimationFrame(() => dialog.returnFocus?.focus?.({ preventScroll: true }));
      setActionMessage({ text: dialog.kind === "chat" ? "Chat deleted from your view" : dialog.kind === "media" ? "Media cleared from your view" : "Messages cleared from your view", error: false });
      setSelection((previous) => previous.conversation?.conversationId === dialog.conversation.conversationId
        ? { ...previous, conversation: dialog.kind === "chat" ? null : previous.conversation,
            generation: previous.generation + 1, focusRequest: dialog.kind === "chat"
              ? { conversationId: dialog.conversation.conversationId, generation: previous.generation + 1 }
              : previous.focusRequest } : previous);
      refreshConversations();
    } catch (error) {
      if (!controller.signal.aborted) setActionMessage({ text: error?.response?.data?.message || "Unable to clear this chat. Try again.", error: true });
    } finally {
      if (actionRequestRef.current === controller) actionRequestRef.current = null;
      if (!controller.signal.aborted) { setActionBusy(false); setPendingConversationId(null); }
    }
  }

  function leaveSection() {
    if (section === "locked") {
      void lockCurrentPrivacy().catch(() => {});
    } else {
      handleBack();
      setSection("normal");
      window.requestAnimationFrame(() =>
        dashboardRef.current?.querySelector('[role="searchbox"]')?.focus(),
      );
    }
  }

  function openSection(nextSection) {
    if (nextSection === "locked") {
      void openPinDialog("verify");
      return;
    }
    handleBack();
    setSection(nextSection);
    window.requestAnimationFrame(() =>
      dashboardRef.current?.querySelector("[data-section-heading]")?.focus(),
    );
  }

  function openRevealed(grant) {
    if (
      backendUnavailable ||
      actionBusy ||
      settingsOpen ||
      chatLockSettings?.hideLockedChats !== true ||
      getPrivacySnapshot().version !== privacy.version ||
      Date.parse(grant.expiresAt) <= Date.now()
    )
      return;
    setPrivacyAccess(grant);
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
    outageIcon: isDark
      ? "bg-blue-500/15 text-blue-300"
      : "bg-blue-100 text-blue-700",
    hover: isDark ? "hover:bg-white/10" : "hover:bg-slate-100",
  };

  return (
    <main
      ref={dashboardRef}
      data-chat-dashboard
      className={`flex h-dvh overflow-hidden ${colors.page}`}
    >
      {/* Conversation sidebar */}
      <aside
        className={`${selection.conversation ? "hidden md:flex" : "flex"} min-h-0 w-full shrink-0 flex-col border-r md:w-[360px] lg:w-[400px] ${colors.sidebar}`}
      >
        <header
          className={`flex shrink-0 items-center justify-between gap-2 border-b px-3 py-5 sm:px-5 md:h-17 md:py-0 ${colors.border}`}
        >
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <MessageCircleMore
              className={`shrink-0 ${colors.icon}`}
              size={26}
            />
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
              className={`flex size-11 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${colors.muted} ${colors.hover}`}
            >
              {isDark ? <Sun size={21} /> : <Moon size={21} />}
            </button>

            {/* Search registered users and create or reuse a conversation. */}
            <button
              type="button"
              aria-label="New conversation"
              title={
                section === "locked"
                  ? "Return to main chats to start a conversation"
                  : "New conversation"
              }
              aria-haspopup="dialog"
              aria-expanded={newChatOpen && !backendUnavailable}
              disabled={backendUnavailable || section === "locked"}
              onClick={openNewChat}
              className={`flex size-11 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${colors.muted} ${colors.hover}`}
            >
              <SquarePen size={21} />
            </button>

            <ProfileMenu
              onBlockedUsers={() => setBlockDialog({ contact: null })}
              pinConfigured={pinConfigured}
              actionBusy={actionBusy}
              onManagePrivacyPin={() => openPinDialog("manage")}
              onResetChatLockSettings={(trigger) =>
                openChatLockSettings("recovery", trigger)
              }
            />
          </div>
        </header>

        <nav aria-label="Chat sections" className="shrink-0 px-3 py-0">
          {section !== "normal" && (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={leaveSection}
                aria-label="Back to main chats"
                className={`flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500 ${colors.hover}`}
              >
                <ArrowLeft size={21} />
              </button>
              <h2
                data-section-heading
                tabIndex={-1}
                className="min-w-0 flex-1 truncate rounded font-semibold focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {section === "locked" ? "Locked Chats" : "Archived"}
              </h2>
              {section === "locked" && privacy.token && (
                <button
                  type="button"
                  aria-label="Chat Lock settings"
                  aria-haspopup="dialog"
                  disabled={
                    backendUnavailable || actionBusy || pinConfigured !== true
                  }
                  onClick={(event) =>
                    openChatLockSettings("settings", event.currentTarget)
                  }
                  className={`flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 ${colors.icon} ${colors.hover}`}
                >
                  <Settings size={20} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </nav>

        {backendUnavailable && (
          <ServerUnavailable
            colors={colors}
            className={`flex shrink-0 border-b px-4 py-4 md:hidden ${colors.border}`}
          />
        )}
        {!backendUnavailable &&
          !selection.conversation &&
          session.error &&
          !failure?.retryable && (
            <p
              role="alert"
              className={`shrink-0 px-4 py-2 text-xs ${colors.muted}`}
            >
              {session.error}
            </p>
          )}
        <ConversationList
          key={section}
          section={section}
          sections={sections}
          onSectionOpen={openSection}
          chatLockSettings={chatLockSettings}
          onOpenRevealed={openRevealed}
          actionBusy={actionBusy}
          pendingConversationId={pendingConversationId}
          sectionsError={sectionsError}
          onRetry={refreshConversations}
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
        <ServerUnavailable
          colors={colors}
          className="hidden min-w-0 flex-1 px-6 md:flex"
        />
      ) : selection.conversation ? (
        <ChatPanel selection={selection} history={history} onBack={handleBack}
          blocks={blocks}
          onConversationAction={conversationAction}
          actionBusy={actionBusy}
          pendingConversationId={pendingConversationId}
          session={session}
          activity={activity}
          draft={draft}
          onDraftChange={changeDraft}
          onSend={sendDraft}
          onTypingInput={onTypingInput}
          stopTyping={stopTyping}
          isTyping={isTyping}
        />
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
          ) : (
            waitingForConnection && (
              <p
                role="status"
                className={`flex items-center gap-2 text-sm ${colors.muted}`}
              >
                <LoaderCircle
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Connecting to Sandesh...
              </p>
            )
          )}
        </section>
      )}
      {newChatOpen && !backendUnavailable && (
        <NewChatDialog
          onClose={closeNewChat}
          onStarted={handleConversationStarted}
        />
      )}
      {pinDialog && (
        <PrivacyPinDialog
          mode={pinDialog.mode}
          retryAt={pinDialog.retryAt}
          returnFocus={pinDialog.returnFocus}
          onSubmit={submitPin}
          onClose={() => setPinDialog(null)}
          purpose={pinDialog.mode === "unlock" ? unlockPinPurpose : undefined}
        />
      )}
      {blockDialog && <UserBlockingDialog contact={blockDialog.contact} blocks={blocks} onClose={() => setBlockDialog(null)} />}
      {clearDialog && <ClearConversationDialog kind={clearDialog.kind} isDark={isDark} busy={actionBusy}
        error={actionMessage?.error ? actionMessage.text : ""}
        onCancel={() => { if (!actionBusy) { const focus = clearDialog.returnFocus; setClearDialog(null); setActionMessage(null); window.requestAnimationFrame(() => focus?.focus?.({ preventScroll: true })); } }}
        onConfirm={confirmClear} />}
      <div role="status" aria-atomic="true" className="pointer-events-none fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm">
        {(showOutageToast || actionMessage) && (
          <div
            className={`pointer-events-auto flex items-center gap-2 rounded-xl border py-2 pl-4 pr-1 text-sm shadow-lg ${colors.border} ${colors.sidebar}`}
          >
            <p className="min-w-0 flex-1">
              {showOutageToast
                ? "Server unavailable. Reconnecting automatically."
                : actionMessage.text}
            </p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => {
                setActionMessage(null);
                setToastOutage(null);
              }}
              className={`flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-blue-500 ${colors.hover}`}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
