import { useContext, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole, LoaderCircle, X } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";

export default function PrivacyPinDialog({ mode, onSubmit, onClose }) {
  const { isDark = true } = useContext(ThemeContext) || {};
  const dialogRef = useRef(null);
  const requestRef = useRef(null);
  const id = useId();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const setup = mode === "setup";
  const change = mode === "change";
  const title = setup ? "Create a privacy PIN" : change ? "Change privacy PIN" : mode === "lock" ? "Lock this chat" : "Open Locked Chats";
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      requestRef.current?.abort();
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    if (!retryAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function submit(event) {
    event.preventDefault();
    if (busy || remaining) return;
    if (!/^[0-9]{4}$/.test(pin) || (change && !/^[0-9]{4}$/.test(currentPin))) {
      setError("Enter exactly four digits (0-9)."); return;
    }
    if ((setup || change) && pin !== confirmPin) { setError("PINs do not match."); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError("");
    try { await onSubmit({ pin, confirmPin, currentPin }, controller.signal); }
    catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure.response?.data?.message || failure.message || "Unable to update privacy. Try again.");
      setRetryAt(Date.parse(failure.response?.data?.retryAt) || 0);
      setPin(""); setCurrentPin(""); setConfirmPin("");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  const input = (label, value, update, autoFocus = false) => (
    <label className="block text-sm font-medium">
      {label}
      <input autoFocus={autoFocus} type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
        autoComplete="off" value={value} disabled={busy} required
        onChange={(event) => update(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        aria-describedby={`${id}-help ${id}-error`}
        className={`mt-2 min-h-12 w-full rounded-xl border px-4 text-center text-2xl tracking-[0.65em] outline-none focus:ring-2 focus:ring-blue-500 ${isDark ? "border-[#293854] bg-[#080e1c]" : "border-slate-200 bg-slate-50"}`} />
    </label>
  );
  return (
    <dialog ref={dialogRef} aria-labelledby={`${id}-title`} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className={`m-auto max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl border p-6 shadow-2xl backdrop:bg-black/65 ${isDark ? "border-[#293854] bg-[#111d31] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-500"><LockKeyhole size={25} /></span>
        <button type="button" onClick={onClose} aria-label="Close privacy dialog" className="flex size-11 items-center justify-center rounded-xl hover:bg-slate-500/10"><X size={20} /></button>
      </div>
      <h2 id={`${id}-title`} className="mt-4 text-xl font-semibold">{title}</h2>
      <p id={`${id}-help`} className="mt-2 text-sm leading-6 opacity-70">
        {setup ? "Choose one 4-digit PIN for your private chats. Keep it safe: PIN recovery is not available yet." : change ? "Verify your current PIN, then choose a new one." : mode === "lock" ? "This chat will move to Locked Chats. Existing privacy sessions will close." : "Your PIN opens this section temporarily. Your login stays unchanged."}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {change && input("Current PIN", currentPin, setCurrentPin, true)}
        {input(setup || change ? "New PIN" : "Privacy PIN", pin, setPin, !change)}
        {(setup || change) && input("Confirm PIN", confirmPin, setConfirmPin)}
        <div id={`${id}-error`} role="alert" className="text-sm text-red-500">
          {error}{remaining > 0 && <p className="mt-1">Try again in {Math.ceil(remaining / 60)} minute(s).</p>}
        </div>
        <button disabled={busy || remaining > 0} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
          {busy && <LoaderCircle size={18} className="animate-spin" />} {setup ? "Set PIN" : change ? "Change PIN" : mode === "lock" ? "Lock chat" : "Unlock section"}
        </button>
      </form>
    </dialog>
  );
}
