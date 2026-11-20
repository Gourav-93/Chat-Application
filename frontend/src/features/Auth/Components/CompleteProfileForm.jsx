/**
 * File: CompleteProfileForm.jsx
 * Purpose: Collects a first-time user's name before creating an authenticated session.
 * Responsibilities: Validate backend name rules, manage registration expiry and
 * recoverable errors, and pass successful login data to the existing session handler.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, UserRound } from "lucide-react";
import {
  completeProfile,
  getAuthErrorMessage,
  normalizeProfileName,
} from "../Services/AuthService";

export default function CompleteProfileForm({ registration, onCompleted, onRestart }) {
  const [userName, setUserName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const deadline = Date.parse(registration?.expiresAt);
  const [expired, setExpired] = useState(
    () => !Number.isFinite(deadline) || deadline <= Date.now(),
  );
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const cannotContinue = expired || requiresRestart;

  useEffect(() => {
    inputRef.current?.focus();
    // Capture the request holder so cleanup also invalidates a pending callback.
    const requests = requestRef;
    return () => {
      requests.current?.abort();
      requests.current = null;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setExpired(true),
      Math.max(0, deadline - Date.now()) || 0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [deadline]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (requestRef.current || cannotContinue) return;
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      setExpired(true);
      return;
    }

    // .NET measures this rule in UTF-16 code units after trimming.
    const name = normalizeProfileName(userName);
    if (name.length < 1 || name.length > 100) {
      setError("Name must contain 1 to 100 characters after trimming.");
      inputRef.current?.focus();
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setError("");
    setIsLoading(true);
    try {
      const login = await completeProfile(registration.token, name, controller.signal);
      if (controller.signal.aborted || requestRef.current !== controller) return;
      // A successful server response is authoritative even across the local expiry deadline.
      onCompleted?.(login);
    } catch (apiError) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      const status = apiError?.response?.status;
      if ([401, 409, 410].includes(status)) {
        setRequiresRestart(true);
        setError(
          status === 409
            ? "Registration is already complete. Verify a fresh OTP to sign in."
            : status === 410
              ? "Registration has expired. Verify a fresh OTP to continue."
              : "Registration is no longer valid. Verify a fresh OTP to continue.",
        );
      } else {
        setError(getAuthErrorMessage(apiError));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const visibleError = expired
    ? "Registration has expired. Verify a fresh OTP to continue."
    : error;

  return (
    <div className="w-full">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-600/15 text-blue-400">
          <UserRound size={27} aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Complete Your Profile
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          One last step. Choose the name people will see on Sandesh.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-busy={isLoading}>
        <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-slate-200">
          Username
        </label>
        <input
          ref={inputRef}
          id={inputId}
          name="userName"
          type="text"
          autoComplete="nickname"
          value={userName}
          onChange={(event) => {
            setUserName(event.target.value);
            setError("");
          }}
          placeholder="Your name"
          disabled={isLoading || cannotContinue}
          required
          aria-invalid={Boolean(visibleError)}
          aria-describedby={hintId + (visibleError ? " " + errorId : "")}
          className="w-full min-w-0 rounded-xl border border-[#34435c] bg-[#0b1425] px-4 py-4 text-base text-white outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
        />
        <p id={hintId} className="mt-2 text-xs leading-5 text-slate-400">
          Use 1 to 100 characters. Spaces at the start and end are removed.
        </p>

        {visibleError && (
          <p id={errorId} role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {visibleError}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading || cannotContinue}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <LoaderCircle size={19} className="animate-spin" aria-hidden="true" />
              Completing profile...
            </>
          ) : (
            <>
              Continue
              <ArrowRight size={19} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <button
        type="button"
        onClick={onRestart}
        disabled={isLoading}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-50"
      >
        <ArrowLeft size={17} aria-hidden="true" />
        {cannotContinue ? "Verify a fresh OTP" : "Use a different number"}
      </button>
    </div>
  );
}
