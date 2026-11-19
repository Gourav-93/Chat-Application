/**
 * File: NewChatDialog.jsx
 * Purpose: Finds verified users by mobile, displays their names, and creates or reuses chats.
 * Responsibilities: Provide an accessible themed dialog, validate international
 * numbers, cancel stale requests, and return the selected conversation to the page.
 */

import { useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search, UserRound, X } from "lucide-react";
import { AuthContext } from "../../../app/AuthContext";
import { ThemeContext } from "../../../app/ThemeContext";
import { getDisplayName } from "../../../shared/lib/displayIdentity";
import {
  getNewChatErrorMessage,
  getOrCreateConversation,
  searchUsersByMobileNumber,
} from "../Services/ConversationService";

export default function NewChatDialog({ onClose, onStarted }) {
  const auth = useContext(AuthContext);
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const token = auth?.user?.token;
  const userId = auth?.user?.userId;
  const authenticated = Boolean(auth?.isAuthenticated);
  const initialSession = useRef({ token, userId });
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const mountedRef = useRef(false);
  const requestRef = useRef({ id: 0, controller: null });
  const creatingRef = useRef(false);
  const id = useId();
  const [mobileNumber, setMobileNumber] = useState("");
  const [users, setUsers] = useState(null);
  const [validationError, setValidationError] = useState("");
  const [apiError, setApiError] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(null);
  const muted = isDark ? "text-slate-400" : "text-slate-500";

  useEffect(() => {
    const dialog = dialogRef.current;
    // This tracker object belongs to this mount; handlers mutate its fields.
    const requests = requestRef.current;
    const previousFocus = document.activeElement;
    mountedRef.current = true;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      mountedRef.current = false;
      requests.id++;
      requests.controller?.abort();
      dialog.close();
      // On mobile a newly opened chat hides the Pencil; its heading owns focus.
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
          previousFocus.getClientRects().length > 0) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const initial = initialSession.current;
    if (!authenticated || token !== initial.token || userId !== initial.userId) {
      onClose();
    }
  }, [authenticated, token, userId, onClose]);

  const beginRequest = () => {
    requestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = ++requestRef.current.id;
    requestRef.current.controller = controller;
    return { controller, requestId };
  };
  const isCurrent = (request) => mountedRef.current &&
    requestRef.current.id === request.requestId &&
    !request.controller.signal.aborted;

  const handleChange = (event) => {
    if (creatingRef.current) return;
    requestRef.current.id++;
    requestRef.current.controller?.abort();
    setMobileNumber(event.target.value);
    setUsers(null);
    setSearching(false);
    setValidationError("");
    setApiError("");
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    if (creatingRef.current) return;
    const number = mobileNumber.trim();
    setApiError("");
    setUsers(null);
    if (!/^[+][1-9][0-9]{7,14}$/.test(number)) {
      setValidationError("Enter a full international mobile number, for example +919876543210.");
      inputRef.current?.focus();
      return;
    }
    setValidationError("");
    const request = beginRequest();
    setSearching(true);
    try {
      const results = await searchUsersByMobileNumber(number, request.controller.signal);
      if (isCurrent(request)) setUsers(results);
    } catch (error) {
      if (isCurrent(request)) setApiError(getNewChatErrorMessage(error));
    } finally {
      if (isCurrent(request)) setSearching(false);
    }
  };

  const handleStart = async (user) => {
    // Ref guard prevents duplicate POSTs before the disabled state renders.
    if (creatingRef.current || searching) return;
    creatingRef.current = true;
    setCreating(user.id);
    setApiError("");
    const request = beginRequest();
    try {
      const conversation = await getOrCreateConversation(user.id, request.controller.signal);
      if (isCurrent(request)) onStarted(conversation);
    } catch (error) {
      if (isCurrent(request)) setApiError(getNewChatErrorMessage(error));
    } finally {
      if (isCurrent(request)) {
        creatingRef.current = false;
        setCreating(null);
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-description"}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={"fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border p-0 shadow-2xl backdrop:bg-slate-950/70 " +
        (isDark ? "border-[#293854] bg-[#111d31] text-white" : "border-slate-200 bg-white text-slate-900")}
    >
      <div className="p-5 sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 id={id + "-title"} className="text-xl font-semibold">New chat</h2>
          <button type="button" onClick={onClose} aria-label="Close new chat"
            className={"flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500 " +
              (isDark ? "hover:bg-white/10" : "hover:bg-slate-100")}>
            <X size={21} aria-hidden="true" />
          </button>
        </header>
        <p id={id + "-description"} className={"mt-2 text-sm leading-6 " + muted}>
          Find a registered user by their full international mobile number.
        </p>
        <form onSubmit={handleSearch} className="mt-5" noValidate>
          <label htmlFor={id + "-mobile"} className="mb-2 block text-sm font-medium">Mobile number</label>
          <input
            ref={inputRef}
            id={id + "-mobile"}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={16}
            value={mobileNumber}
            onChange={handleChange}
            disabled={creating !== null}
            placeholder="+919876543210"
            aria-invalid={Boolean(validationError)}
            aria-describedby={id + "-help" + (validationError ? " " + id + "-validation" : "")}
            className={"min-h-11 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 " +
              (isDark ? "border-[#293854] bg-[#080e1c] text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400")}
          />
          <p id={id + "-help"} className={"mt-2 text-xs leading-5 " + muted}>
            Include the + country code. Search uses an exact mobile-number match.
          </p>
          {validationError && <p id={id + "-validation"} role="alert"
            className={"mt-2 text-sm " + (isDark ? "text-red-300" : "text-red-600")}>{validationError}</p>}
          <button type="submit" disabled={searching || creating !== null}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60">
            {searching
              ? <LoaderCircle size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              : <Search size={18} aria-hidden="true" />}
            {searching ? "Searching..." : "Search user"}
          </button>
        </form>
        {searching && <p role="status" className="sr-only">Searching registered users</p>}
        {apiError && <p role="alert" className={"mt-4 rounded-xl border px-3 py-3 text-sm leading-6 " +
          (isDark ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-700")}>{apiError}</p>}
        {users?.length === 0 && <p role="status" className={"mt-5 text-center text-sm leading-6 " + muted}>
          No other verified user found for this mobile number.
        </p>}
        {users && users.length > 0 && <ul aria-label="Matching users" className="mt-5 space-y-3">
          {users.map((user) => (
            <li key={user.id} className={"rounded-2xl border p-3 " + (isDark ? "border-[#293854]" : "border-slate-200")}>
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className={"flex size-11 shrink-0 items-center justify-center rounded-full " +
                  (isDark ? "bg-blue-600/20 text-blue-200" : "bg-blue-50 text-blue-700")}><UserRound size={22} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={getDisplayName(user.userName, user.mobileNumber)}>
                    {getDisplayName(user.userName, user.mobileNumber)}
                  </p>
                  {user.mobileNumber && (
                    <p className={"mt-1 truncate text-xs " + muted} title={user.mobileNumber}>
                      {user.mobileNumber}
                    </p>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => handleStart(user)} disabled={creating !== null || searching}
                aria-label={"Start chat with " + getDisplayName(user.userName, user.mobileNumber)}
                className="mt-3 min-h-11 w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60">
                {creating === user.id ? "Opening chat..." : "Start Chat"}
              </button>
            </li>
          ))}
        </ul>}
        {creating !== null && <p role="status" className="sr-only">Opening conversation</p>}
      </div>
    </dialog>
  );
}
