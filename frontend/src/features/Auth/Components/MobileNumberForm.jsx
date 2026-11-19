/**
 * File: MobileNumberForm.jsx
 *
 * Purpose:
 * Provides Sandesh's mobile number authentication form.
 *
 * Responsibilities:
 * 1. Display a fixed +91 country code.
 * 2. Accept and validate a 10-digit Indian mobile number.
 * 3. Send the complete international number to the backend.
 * 4. Handle loading states and authentication errors.
 */

import { useState } from "react";
import { ArrowRight, LoaderCircle, Smartphone } from "lucide-react";

import { sendOtp, getAuthErrorMessage } from "../Services/AuthService";

// Fixed country code for Indian mobile numbers.
const COUNTRY_CODE = "+91";

// Indian mobile numbers contain 10 digits and start with 6-9.
const MOBILE_REGEX = /^[6-9]\d{9}$/;

export default function MobileNumberForm({ onOtpSent }) {
  const [mobileNumber, setMobileNumber] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Accept only numeric input, limited to 10 digits.
   */
  const handleChange = (event) => {
    const value = event.target.value.replace(/\D/g, "").slice(0, 10);

    setMobileNumber(value);
    setError("");
  };

  /**
   * Validate the number and request an OTP.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isLoading) return;

    if (!mobileNumber) {
      setError("Mobile number is required.");
      return;
    }

    if (!MOBILE_REGEX.test(mobileNumber)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }

    // The backend expects the complete international format.
    const fullMobileNumber = `${COUNTRY_CODE}${mobileNumber}`;

    setError("");
    setIsLoading(true);

    try {
      const response = await sendOtp(fullMobileNumber);

      // Move to OTP verification after a successful request.
      onOtpSent?.(fullMobileNumber, response?.developmentOtp);
    } catch (apiError) {
      setError(getAuthErrorMessage(apiError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Authentication heading */}
      <div className="mb-7 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Welcome to Sandesh
        </h2>

        <p className="mt-3 text-sm text-slate-400">
          Enter your number to continue
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <label
          htmlFor="mobileNumber"
          className="mb-2 block text-sm font-medium text-slate-200"
        >
          Mobile number
        </label>

        {/* Fixed country code and editable phone number */}
        <div
          className={`flex items-center gap-3 rounded-xl border bg-[#0b1425] px-4 transition-all focus-within:ring-2 ${
            error
              ? "border-red-500 focus-within:ring-red-500/20"
              : "border-[#34435c] focus-within:border-blue-500 focus-within:ring-blue-500/20"
          }`}
        >
          <Smartphone
            size={19}
            className="shrink-0 text-slate-400"
            aria-hidden="true"
          />

          {/* Country code cannot be edited */}
          <span className="shrink-0 text-base font-medium text-white">+91</span>

          {/* Visual separator between code and number */}
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-slate-600" />

          <input
            id="mobileNumber"
            name="mobileNumber"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={mobileNumber}
            onChange={handleChange}
            placeholder="9876543210"
            disabled={isLoading}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "mobile-error" : undefined}
            className="min-w-0 flex-1 bg-transparent py-4 text-base text-white outline-none placeholder:text-slate-500 disabled:opacity-60"
          />
        </div>

        {/* Display validation or API errors */}
        {error && (
          <p
            id="mobile-error"
            role="alert"
            className="mt-2 text-sm text-red-400"
          >
            {error}
          </p>
        )}

        {/* OTP request button */}
        <button
          type="submit"
          disabled={isLoading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <LoaderCircle
                size={19}
                className="animate-spin"
                aria-hidden="true"
              />
              Sending OTP...
            </>
          ) : (
            <>
              Continue
              <ArrowRight size={19} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
