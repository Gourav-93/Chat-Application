/**
 * File: ProfileMenu.jsx
 * Purpose: Provides the signed-in user's profile dropdown.
 * Responsibilities:
 * 1. Display a generic avatar, the authenticated name, and a secondary mobile number.
 * 2. Invoke the existing authentication logout action.
 * 3. Support themes, responsive sizing, and accessible dismissal.
 */

import { useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, LockKeyhole, LogOut, UserRound } from "lucide-react";
import { AuthContext } from "../../../app/AuthContext";
import { ThemeContext } from "../../../app/ThemeContext";
import { getDisplayName } from "../../../shared/lib/displayIdentity";
 

export default function ProfileMenu({ pinConfigured, onManagePrivacyPin, onBlockedUsers, actionBusy = false }) {
  const auth = useContext(AuthContext);
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const pinRef = useRef(null);
  const panelId = useId();
  const nameId = useId();

  const userName = typeof auth?.user?.userName === "string" ? auth.user.userName.trim() : "";
  const mobileNumber =
    typeof auth?.user?.mobileNumber === "string"
      ? auth.user.mobileNumber.trim()
      : "";

  useEffect(() => {
    if (!isOpen) return undefined;

    // Focus the action while keeping normal Tab navigation available.
    pinRef.current?.focus();

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
        // Restore focus if the outside target does not receive focus itself.
        if (containerRef.current?.contains(document.activeElement)) {
          triggerRef.current?.focus();
        }
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleBlur = (event) => {
    // Leaving the entire control by keyboard dismisses the dropdown.
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} onBlur={handleBlur} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Your profile"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => setIsOpen((current) => !current)}
        className={
          "flex size-11 items-center justify-center rounded-full border text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 " +
          (isDark
            ? "border-blue-400/30 bg-blue-600/20 text-blue-200 hover:bg-blue-600/30"
            : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100")
        }
      >
        <UserRound size={22} aria-hidden="true" />
      </button>

      {isOpen && (
        <section
          id={panelId}
          aria-labelledby={nameId}
          className={
            "absolute right-0 top-full z-30 mt-3 max-h-[calc(100dvh-7rem)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border shadow-xl " +
            (isDark
              ? "border-[#293854] bg-[#111d31] text-white shadow-black/30"
              : "border-slate-200 bg-white text-slate-900 shadow-slate-900/10")
          }
        >
          <div
            className={
              "border-b px-4 py-4 " +
              (isDark ? "border-[#293854]" : "border-slate-200")
            }
          >
            <p className={
              "mb-1 text-xs " +
              (isDark ? "text-slate-400" : "text-slate-500")
            }>
              Signed in as
            </p>
            <h2 id={nameId} className="break-words text-sm font-semibold">
              {getDisplayName(userName, mobileNumber)}
            </h2>
            {mobileNumber && (
              <p className={"mt-1 break-words text-xs " + (isDark ? "text-slate-400" : "text-slate-500")}>
                {mobileNumber}
              </p>
            )}
          </div>
          <div className="p-2">
            <button type="button" className="min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-blue-500"
              onClick={() => { triggerRef.current?.focus(); setIsOpen(false); onBlockedUsers?.(); }}>Blocked users</button>
            <button
              ref={pinRef}
              type="button"
              aria-disabled={actionBusy}
              aria-busy={actionBusy}
              onClick={() => {
                if (actionBusy) return;
                triggerRef.current?.focus();
                setIsOpen(false);
                onManagePrivacyPin?.();
              }}
              className={
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 aria-disabled:opacity-50 " +
                (isDark ? "text-slate-200 hover:bg-white/5" : "text-slate-700 hover:bg-slate-100")
              }
            >
              {actionBusy ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}
              {pinConfigured === true ? "Change privacy PIN" : pinConfigured === false ? "Set privacy PIN" : "Privacy PIN"}
            </button>
          </div>
          <div className={`border-t p-2 ${isDark ? "border-[#293854]" : "border-slate-200"}`}>
            <button
              type="button"
              disabled={typeof auth?.logout !== "function"}
              onClick={() => {
                setIsOpen(false);
                auth?.logout?.();
              }}
              className={
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50 " +
                (isDark
                  ? "text-red-300 hover:bg-red-500/10"
                  : "text-red-600 hover:bg-red-50")
              }
            >
              <LogOut size={18} aria-hidden="true" />
              Logout
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
