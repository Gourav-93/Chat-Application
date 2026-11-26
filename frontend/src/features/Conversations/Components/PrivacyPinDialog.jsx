// Collects and verifies the existing Privacy PIN for chat access and privacy settings.
import { useContext, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole, LoaderCircle, X } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";

function retryDeadline(failure) {
  const deadline = Date.parse(failure.response?.data?.retryAt);
  if (Number.isFinite(deadline)) return deadline;
  const retryAfter = failure.response?.headers?.["retry-after"];
  if (retryAfter == null) return 0;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds)
    ? Date.now() + Math.max(0, seconds) * 1000
    : Date.parse(retryAfter) || 0;
}

function errorMessage(failure, purpose) {
  const code = failure.response?.data?.code;
  const messages = {
    privacy_pin_invalid: "Incorrect PIN. Try again.",
    privacy_pin_format: "Enter a 4-digit PIN.",
    privacy_pin_mismatch: "PINs do not match.",
    privacy_pin_configured:
      "A PIN is already set. Close this dialog and choose Change privacy PIN.",
    privacy_setup_required:
      "Set a privacy PIN first. Close this dialog and try again.",
    privacy_conflict:
      "Privacy settings changed. Close this dialog and try again.",
    privacy_locked_out: "Too many PIN attempts.",
    privacy_secret_code_required:
      "Set a Secret Code before hiding Locked Chats.",
    privacy_secret_code_mismatch: "The Secret Codes do not match.",
    privacy_secret_code_format:
      "Enter a non-blank Secret Code of up to 100 characters.",
    privacy_session_limit:
      "Too many open Locked Chats sessions. Close one and try again.",
  };
  if (messages[code]) return messages[code];
  if (failure.response?.status === 429)
    return "Too many requests. Please wait before trying again.";
  if (failure.response?.status === 401)
    return "Your login has expired. Sign in again.";
  if (failure.response?.status === 403)
    return (
      purpose?.error ??
      "Unable to access Locked Chats. Close this dialog and try again."
    );
  if (failure.response?.status >= 500)
    return "Privacy settings are temporarily unavailable. Try again shortly.";
  if (!failure.response)
    return "Unable to connect. Check your connection and try again.";
  return "Unable to update privacy settings. Try again.";
}

export default function PrivacyPinDialog({
  mode,
  onSubmit,
  onClose,
  retryAt: initialRetryAt,
  returnFocus,
  purpose,
}) {
  const { isDark = true } = useContext(ThemeContext) || {};
  const dialogRef = useRef(null);
  const requestRef = useRef(null);
  const fieldsRef = useRef({});
  const id = useId();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(() => Date.parse(initialRetryAt) || 0);
  const [now, setNow] = useState(Date.now);
  const setup = mode === "setup";
  const change = mode === "change";
  const title =
    purpose?.title ??
    (setup
      ? "Create a privacy PIN"
      : change
        ? "Change privacy PIN"
        : mode === "lock"
          ? "Lock this chat"
          : "Open Locked Chats");
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const waitingToRetry = remaining > 0;
  const countdown = `${Math.floor(remaining / 60)}:${String(
    remaining % 60,
  ).padStart(2, "0")}`;
  const close = () => {
    if (!requestRef.current) onClose();
  };

  useEffect(() => {
    const previousFocus = returnFocus || document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    fieldsRef.current[mode === "change" ? "currentPin" : "pin"]?.focus();
    return () => {
      requestRef.current?.abort();
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [mode, returnFocus]);
  useEffect(() => {
    if (!waitingToRetry) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitingToRetry]);

  async function submit(event) {
    event.preventDefault();
    if (requestRef.current || retryAt > Date.now()) return;
    const invalid = {};
    if (change && !/^[0-9]{4}$/.test(currentPin))
      invalid.currentPin = "Enter your current 4-digit PIN.";
    if (!/^[0-9]{4}$/.test(pin)) invalid.pin = "Enter a 4-digit PIN.";
    if ((setup || change) && (!confirmPin || pin !== confirmPin))
      invalid.confirmPin = "Enter the same PIN again.";
    setFieldErrors(invalid);
    setError("");
    if (Object.keys(invalid).length) {
      fieldsRef.current[Object.keys(invalid)[0]]?.focus();
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError("");
    try {
      await onSubmit({ pin, confirmPin, currentPin }, controller.signal);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(errorMessage(failure, purpose));
      setRetryAt(retryDeadline(failure));
      setNow(Date.now());
      setPin("");
      setCurrentPin("");
      setConfirmPin("");
      // if (failure.response?.data?.code === "privacy_pin_invalid") {
      //   setFieldErrors({ [change ? "currentPin" : "pin"]: "Incorrect PIN." });
      // }
      window.requestAnimationFrame(() => {
        if (!controller.signal.aborted)
          fieldsRef.current[change ? "currentPin" : "pin"]?.focus();
      });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const input = (name, label, value, update, autoFocus = false) => (
    <div>
      <label htmlFor={`${id}-${name}`} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        ref={(element) => {
          fieldsRef.current[name] = element;
        }}
        autoFocus={autoFocus}
        type="password"
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        autoComplete="off"
        value={value}
        disabled={busy}
        required
        onChange={(event) => {
          update(event.target.value.replace(/[^0-9]/g, "").slice(0, 4));
          setFieldErrors((previous) => ({ ...previous, [name]: "" }));
        }}
        aria-invalid={Boolean(fieldErrors[name])}
        aria-describedby={`${id}-help${
          fieldErrors[name] ? ` ${id}-${name}-error` : ""
        }`}
        className={`mt-2 min-h-12 w-full min-w-0 rounded-xl border px-4 text-center text-2xl tracking-[0.65em] outline-none focus:ring-2 focus:ring-blue-500 aria-invalid:border-red-500 ${
          isDark
            ? "border-[#293854] bg-[#080e1c]"
            : "border-slate-200 bg-slate-50"
        }`}
      />
      {fieldErrors[name] && (
        <p
          id={`${id}-${name}-error`}
          className={`mt-1 text-sm ${isDark ? "text-red-300" : "text-red-700"}`}
        >
          {fieldErrors[name]}
        </p>
      )}
    </div>
  );
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className={`m-auto max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl border p-6 shadow-2xl backdrop:bg-black/65 ${
        isDark
          ? "border-[#293854] bg-[#111d31] text-white"
          : "border-slate-200 bg-white text-slate-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-500">
          <LockKeyhole size={25} />
        </span>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="Close privacy dialog"
          className="flex size-11 items-center justify-center rounded-xl hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50"
        >
          <X size={20} />
        </button>
      </div>
      <h2 id={`${id}-title`} className="mt-4 text-xl font-semibold">
        {title}
      </h2>
      <p id={`${id}-help`} className="mt-2 text-sm leading-6 opacity-70">
        {purpose?.description ??
          (setup
            ? "Choose a 4-digit PIN for Locked Chats. Keep it safe: PIN recovery is not available."
            : change
              ? "Enter your current PIN and choose a new one. Locked Chats will close."
              : mode === "lock"
                ? "Enter your PIN to move this chat to Locked Chats."
                : "Enter your PIN. Locked Chats close when you leave the section or after 5 minutes of inactivity.")}
      </p>
      <form
        onSubmit={submit}
        noValidate
        aria-busy={busy}
        className="mt-5 space-y-4"
      >
        {change &&
          input("currentPin", "Current PIN", currentPin, setCurrentPin, true)}
        {input(
          "pin",
          setup || change ? "New PIN" : "Privacy PIN",
          pin,
          setPin,
          !change,
        )}
        {(setup || change) &&
          input("confirmPin", "Confirm PIN", confirmPin, setConfirmPin)}
        {error && (
          <p
            role="alert"
            className={`text-sm ${isDark ? "text-red-300" : "text-red-700"}`}
          >
            {error}
          </p>
        )}
        {retryAt > 0 && (
          <p role="timer" aria-live="off" className="text-sm tabular-nums">
            {remaining > 0
              ? `Try again in ${countdown}`
              : "You can try again now."}
          </p>
        )}
        <button
          disabled={busy || remaining > 0}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50"
        >
          {busy && (
            <LoaderCircle
              size={18}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}{" "}
          {busy
            ? "Please wait…"
            : (purpose?.submitLabel ??
              (setup
                ? "Set PIN"
                : change
                  ? "Change PIN"
                  : mode === "lock"
                    ? "Lock chat"
                    : "Open Locked Chats"))}
        </button>
      </form>
    </dialog>
  );
}
