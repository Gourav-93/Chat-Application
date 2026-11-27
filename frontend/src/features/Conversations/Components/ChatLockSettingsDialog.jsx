// Presents responsive Chat Lock settings, Secret Code setup, and recovery confirmation.

import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";
import { normalizeSecretCode } from "../Hooks/useSecretCodeSearch";

const codeError =
  "Enter a non-blank Secret Code of up to 100 Unicode characters.";
const titles = {
  settings: "Chat Lock settings",
  intro: "Hide Locked Chats",
  create: "Create Secret Code",
  confirm: "Confirm Secret Code",
  change: "Change Secret Code",
  disable: "Turn off Secret Code?",
  recovery: "Reset chat lock settings?",
};

export default function ChatLockSettingsDialog({
  settings,
  settingsFailed,
  initialView,
  suspended,
  busy,
  error,
  onClose,
  onReload,
  onSave,
}) {
  const { isDark = true } = useContext(ThemeContext) || {};
  const [view, setView] = useState(initialView);
  const [setupHides, setSetupHides] = useState(false);
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [validation, setValidation] = useState("");
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const codeRef = useRef(null);
  const confirmationRef = useRef(null);
  const id = useId();

  useLayoutEffect(() => {
    if (suspended) return undefined;
    const dialog = dialogRef.current;
    const viewport = window.visualViewport;
    const fitViewport = () => {
      dialog.style.setProperty("--lock-dialog-height", viewport.height + "px");
      dialog.style.top = viewport.offsetTop + viewport.height / 2 + "px";
      dialog.style.left = viewport.offsetLeft + viewport.width / 2 + "px";
    };
    dialog.showModal();
    if (viewport) {
      fitViewport();
      viewport.addEventListener("resize", fitViewport);
      viewport.addEventListener("scroll", fitViewport);
    }
    return () => {
      viewport?.removeEventListener("resize", fitViewport);
      viewport?.removeEventListener("scroll", fitViewport);
      dialog.close();
    };
  }, [suspended]);

  useLayoutEffect(() => {
    if (suspended) return;
    const target =
      view === "confirm" ? confirmationRef.current : codeRef.current;
    (target || headingRef.current)?.focus({ preventScroll: true });
  }, [view, suspended]);

  function go(nextView) {
    setValidation("");
    setShowCode(false);
    if (nextView !== "confirm") setConfirmation("");
    if (nextView !== "create" && nextView !== "confirm") setCode("");
    setView(nextView);
  }

  function back() {
    if (view === "intro" || view === "change") go("settings");
    else if (view === "create") go(setupHides ? "intro" : "settings");
    else if (view === "confirm") go("create");
    else if (view === "disable") go("change");
  }

  function submit(event) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeSecretCode(code);
    if (!normalized) {
      setValidation(codeError);
      codeRef.current?.focus();
      return;
    }
    if (view === "create") {
      go("confirm");
      return;
    }
    const confirmed = normalizeSecretCode(confirmation);
    if (!confirmed || confirmed !== normalized) {
      setValidation(confirmed ? "The Secret Codes do not match." : codeError);
      confirmationRef.current?.focus();
      return;
    }
    const values = { secretCode: normalized, confirmSecretCode: confirmed };
    if (view === "confirm" && setupHides) values.hideLockedChats = true;
    onSave({ type: "code", values });
  }

  const iconClass =
    "flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50";
  const rowClass =
    "flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50";
  const primary =
    "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50";
  const field = (name, label, value, setter) => (
    <div>
      <label htmlFor={id + name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        ref={name === "code" ? codeRef : confirmationRef}
        id={id + name}
        type={showCode ? "text" : "password"}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        disabled={busy}
        onChange={(event) => {
          setter(event.target.value);
          setValidation("");
        }}
        aria-describedby={validation ? id + "-validation" : undefined}
        className={
          "mt-2 min-h-11 w-full min-w-0 rounded-xl border px-3 text-base outline-none focus:ring-2 focus:ring-blue-500 " +
          (isDark
            ? "border-[#293854] bg-[#080e1c]"
            : "border-slate-300 bg-slate-50")
        }
      />
    </div>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={id + "-heading"}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={
        "fixed inset-auto left-1/2 top-1/2 m-0 w-[calc(100%_-_1rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border p-0 shadow-2xl backdrop:bg-black/65 " +
        (isDark
          ? "border-[#293854] bg-[#111d31] text-white"
          : "border-slate-200 bg-white text-slate-900")
      }
    >
      <div
        className="flex min-h-0 flex-col"
        style={{
          maxHeight:
            "calc(var(--lock-dialog-height, 100dvh) - 1rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
        }}
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-slate-500/25 px-2 py-1 sm:px-3">
          {view !== "settings" && view !== "recovery" && (
            <button
              className={iconClass}
              type="button"
              aria-label="Back"
              onClick={back}
              disabled={busy}
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          )}
          <h2
            id={id + "-heading"}
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 px-2 text-base font-semibold sm:text-lg"
          >
            {titles[view]}
          </h2>
          <button
            className={iconClass}
            type="button"
            aria-label="Close Chat Lock settings"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div
          className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5"
          aria-busy={busy}
        >
          {view === "settings" &&
            (settings ? (
              <>
                <div className="space-y-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.hideLockedChats}
                    aria-describedby={id + "-hide-info"}
                    className={rowClass}
                    disabled={busy}
                    onClick={() => {
                      if (!settings.secretCodeConfigured) {
                        setSetupHides(true);
                        go("intro");
                      } else {
                        onSave({
                          type: "hide",
                          values: { enabled: !settings.hideLockedChats },
                        });
                      }
                    }}
                  >
                    Hide Locked Chats
                    <span
                      aria-hidden="true"
                      className={
                        "flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 " +
                        (settings.hideLockedChats
                          ? "justify-end bg-blue-600"
                          : "bg-slate-500")
                      }
                    >
                      <span className="size-5 rounded-full bg-white" />
                    </span>
                  </button>
                  <p id={id + "-hide-info"} className="px-3 text-sm opacity-75">
                    Enter your Secret Code in chat search to find the hidden
                    folder.
                  </p>
                </div>
                <button
                  type="button"
                  className={rowClass}
                  disabled={busy}
                  onClick={() => {
                    setSetupHides(false);
                    go(settings.secretCodeConfigured ? "change" : "create");
                  }}
                >
                  Secret Code
                  <span className="flex shrink-0 items-center gap-2 opacity-75">
                    {settings.secretCodeConfigured ? "On" : "Off"}
                    <ChevronRight size={18} aria-hidden="true" />
                  </span>
                </button>
              </>
            ) : settingsFailed ? (
              <>
                <p role="alert" className="text-sm">
                  Unable to load Chat Lock settings.
                </p>
                <button className={primary} type="button" onClick={onReload}>
                  Try again
                </button>
              </>
            ) : (
              <p role="status" className="flex items-center gap-2 text-sm">
                <LoaderCircle
                  size={18}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Loading Chat Lock settings...
              </p>
            ))}
          {view === "intro" && (
            <>
              <p className="text-sm leading-6 opacity-80">
                Hide the Locked Chats folder from your conversation list. To
                find it, type your Secret Code in chat search.
              </p>
              <button
                className={primary}
                type="button"
                onClick={() => go("create")}
              >
                Create Secret Code
              </button>
            </>
          )}
          {(view === "create" || view === "confirm" || view === "change") && (
            <form className="space-y-4" onSubmit={submit} noValidate>
              {view !== "confirm" &&
                field(
                  "code",
                  view === "change" ? "New Secret Code" : "Secret Code",
                  code,
                  setCode,
                )}
              {view !== "create" &&
                field(
                  "confirmation",
                  "Confirm Secret Code",
                  confirmation,
                  setConfirmation,
                )}
              {view === "create" && (
                <p className="text-sm opacity-75">
                  You can use words, numbers, symbols, spaces, and emojis.
                </p>
              )}
              <button
                type="button"
                aria-pressed={showCode}
                disabled={busy}
                onClick={() => setShowCode((value) => !value)}
                className="min-h-11 rounded-lg px-2 text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50"
              >
                Show Secret Code
              </button>
              {validation && (
                <p
                  id={id + "-validation"}
                  role="alert"
                  className="break-words text-sm"
                >
                  {validation}
                </p>
              )}
              <button className={primary} disabled={busy}>
                {view === "create" ? "Continue" : "Save Secret Code"}
              </button>
              {view === "change" && (
                <button
                  className={rowClass}
                  type="button"
                  disabled={busy}
                  onClick={() => go("disable")}
                >
                  Turn off Secret Code
                </button>
              )}
            </form>
          )}
          {(view === "disable" || view === "recovery") && (
            <>
              <p className="text-sm leading-6 opacity-80">
                Your Secret Code will be removed. If you have locked chats,
                their folder will be visible again. Your Privacy PIN, individual
                chat locks, and message history will stay in place.
              </p>
              {view === "recovery" && (
                <p className="text-sm opacity-80">
                  Confirm with your existing Privacy PIN to continue.
                </p>
              )}
              <button
                className={primary}
                type="button"
                disabled={busy}
                onClick={() =>
                  onSave({
                    type: "disable",
                    values: {},
                    recovery: view === "recovery",
                  })
                }
              >
                {view === "recovery"
                  ? "Continue to PIN verification"
                  : "Turn off Secret Code"}
              </button>
            </>
          )}
          {busy && (
            <p role="status" className="text-sm">
              Saving Chat Lock settings...
            </p>
          )}
          {error && (
            <p
              role="alert"
              className={
                "break-words text-sm " +
                (isDark ? "text-red-300" : "text-red-700")
              }
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
