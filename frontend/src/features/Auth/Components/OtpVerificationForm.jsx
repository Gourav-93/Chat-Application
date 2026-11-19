/**
 * File: OtpVerificationForm.jsx
 *
 * Purpose:
 * Provides a responsive OTP verification screen for Sandesh.
 *
 * Responsibilities:
 * 1. Accept and validate a six-digit verification code.
 * 2. Support OTP paste, autofill, and keyboard navigation.
 * 3. Verify the OTP through the existing ASP.NET Core API.
 * 4. Manage the resend cooldown and API error messages.
 * 5. Notify the parent after successful authentication.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import {
  getAuthErrorMessage,
  sendOtp,
  verifyOtp,
} from "../Services/AuthService";

const OTP_LENGTH = 6;
const OTP_REGEX = /^\d{6}$/;
const RESEND_COOLDOWN_SECONDS = 60;

export default function OtpVerificationForm({
  mobileNumber,
  onVerified,
  onChangeNumber,
  onDevelopmentOtp,
}) {
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(""));

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Store the deadline instead of decrementing a timer blindly.
  const [resendAvailableAt, setResendAvailableAt] = useState(
    () => Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
  );

  const [remainingSeconds, setRemainingSeconds] = useState(
    RESEND_COOLDOWN_SECONDS,
  );

  const inputRefs = useRef([]);
  const isBusy = isVerifying || isResending;

  const otp = digits.join("");

  /**
   * Keep the resend countdown synchronized with the deadline.
   */
  useEffect(() => {
    const updateCountdown = () => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)),
      );
    };

    updateCountdown();

    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(intervalId);
  }, [resendAvailableAt]);

  /**
   * Distribute pasted or autofilled digits into the OTP boxes.
   */
  const fillDigits = (value) => {
    if (isBusy) return;

    const cleaned = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
    const nextDigits = Array(OTP_LENGTH).fill("");

    cleaned.split("").forEach((digit, index) => {
      nextDigits[index] = digit;
    });

    setDigits(nextDigits);
    setError("");
    setSuccessMessage("");

    const focusIndex = Math.min(cleaned.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  };

  /**
   * Update an individual OTP input and advance focus.
   */
  const handleDigitChange = (index, value) => {
    if (isBusy) return;

    const cleaned = value.replace(/\D/g, "");

    if (cleaned.length > 1) {
      fillDigits(cleaned);
      return;
    }

    const nextDigits = [...digits];
    nextDigits[index] = cleaned;

    setDigits(nextDigits);
    setError("");
    setSuccessMessage("");

    if (cleaned && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  /**
   * Support backspace and arrow-key navigation.
   */
  const handleKeyDown = (event, index) => {
    if (isBusy) return;

    if (event.key === "Backspace") {
      event.preventDefault();

      const nextDigits = [...digits];

      if (nextDigits[index]) {
        nextDigits[index] = "";
      } else if (index > 0) {
        nextDigits[index - 1] = "";
        inputRefs.current[index - 1]?.focus();
      }

      setDigits(nextDigits);
      setError("");
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }

    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  /**
   * Verify the OTP and return the login response.
   */
  const handleVerify = async (event) => {
    event.preventDefault();

    if (isBusy) return;

    if (!OTP_REGEX.test(otp)) {
      setError("Please enter the complete 6-digit OTP.");
      return;
    }

    setError("");
    setSuccessMessage("");
    setIsVerifying(true);

    try {
      let response;

try {
  response = await verifyOtp(mobileNumber, otp);
} catch (failure) {
  const conflict = failure.response?.data;

  if (
    failure.response?.status !== 409 ||
    conflict?.requiresConfirmation !== true ||
    typeof conflict.confirmationToken !== "string" ||
    !conflict.confirmationToken
  ) {
    throw failure;
  }

  const confirmed = window.confirm(
    (conflict.message ||
      "This account is already signed in elsewhere.") +
      "\n\nContinue here and sign out the other session?"
  );

  if (!confirmed) {
    setSuccessMessage(
      "Login cancelled. Your other session is unchanged."
    );
    return;
  }

  response = await verifyOtp(
    mobileNumber,
    otp,
    conflict.confirmationToken
  );
}

onVerified?.(response);
    } catch (apiError) {
      setError(getAuthErrorMessage(apiError));
    } finally {
      setIsVerifying(false);
    }
  };

  /**
   * Resend an OTP only after the cooldown expires.
   */
  const handleResend = async () => {
    if (isBusy || remainingSeconds > 0) return;

    setError("");
    setSuccessMessage("");
    onDevelopmentOtp(null);
    setIsResending(true);

    try {
      const response = await sendOtp(mobileNumber);
      onDevelopmentOtp(response?.developmentOtp ?? null);

      // Clear the previous code after a successful resend.
      setDigits(Array(OTP_LENGTH).fill(""));

      const nextDeadline = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;

      setResendAvailableAt(nextDeadline);
      setRemainingSeconds(RESEND_COOLDOWN_SECONDS);

      setSuccessMessage("New OTP sent successfully.");

      inputRefs.current[0]?.focus();
    } catch (apiError) {
      setError(getAuthErrorMessage(apiError));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="w-full">
      {/* Verification heading */}
      <div className="mb-7 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Verify your number
        </h2>

        <p className="mt-3 text-sm text-slate-400">
          Enter the 6-digit code sent to
        </p>

        <p className="mt-1 font-semibold text-blue-400">{mobileNumber}</p>
      </div>

      <form onSubmit={handleVerify} noValidate>
        <label className="mb-3 block text-sm font-medium text-slate-200">
          Verification code
        </label>

        {/* Six individual OTP inputs */}
        <div className="grid grid-cols-6 gap-2 sm:gap-3">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputRefs.current[index] = element;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={index === 0 ? OTP_LENGTH : 1}
              value={digit}
              onChange={(event) => handleDigitChange(index, event.target.value)}
              onPaste={(event) => {
                event.preventDefault();
                fillDigits(event.clipboardData.getData("text"));
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              disabled={isBusy}
              aria-label={`OTP digit ${index + 1}`}
              aria-invalid={Boolean(error)}
              className={`h-12 w-full min-w-0 rounded-xl border bg-[#0b1425] text-center text-xl font-semibold text-white outline-none transition-all focus:ring-2 sm:h-14 sm:text-2xl ${
                error
                  ? "border-red-500 focus:ring-red-500/20"
                  : "border-[#34435c] focus:border-blue-500 focus:ring-blue-500/20"
              } disabled:opacity-60`}
            />
          ))}
        </div>

        {/* Validation and API errors */}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        {/* OTP resend confirmation */}
        {successMessage && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200"
          >
            <CheckCircle2 size={18} className="shrink-0" />
            {successMessage}
          </div>
        )}

        {/* Verify action */}
        <button
          type="submit"
          disabled={isBusy || !OTP_REGEX.test(otp)}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isVerifying ? (
            <>
              <LoaderCircle size={19} className="animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              Verify & Continue
              <ArrowRight size={19} />
            </>
          )}
        </button>
      </form>

      {/* Resend OTP controls */}
      <div className="mt-6 border-t border-white/10 pt-5 text-center">
        {remainingSeconds > 0 ? (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
            <Clock3 size={16} />
            Resend in {remainingSeconds}s
          </div>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            disabled={isBusy}
            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {isResending ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            {isResending ? "Resending..." : "Resend OTP"}
          </button>
        )}
      </div>

      {/* Return to the mobile number form */}
      <button
        type="button"
        onClick={onChangeNumber}
        disabled={isBusy}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
      >
        <ArrowLeft size={17} />
        Change mobile number
      </button>
    </div>
  );
}
