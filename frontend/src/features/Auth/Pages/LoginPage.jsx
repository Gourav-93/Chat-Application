/**
 * File: LoginPage.jsx
 *
 * Purpose:
 * Provides the responsive authentication layout for Sandesh.
 *
 * Responsibilities:
 * 1. Display the Sandesh branding and login interface.
 * 2. Switch between mobile login and OTP verification.
 * 3. Maintain a two-column desktop layout.
 * 4. Allow the page to expand when validation errors appear.
 * 5. Preserve the existing backend authentication flow.
 */

import { useState } from "react";
import { MessageCircleMore } from "lucide-react";

import MobileNumberForm from "../Components/MobileNumberForm";
import OtpVerificationForm from "../Components/OtpVerificationForm";

export default function LoginPage({ onLoginSuccess }) {
  const [step, setStep] = useState("mobile");
  const [mobileNumber, setMobileNumber] = useState("");

  // Switch to OTP verification after a successful OTP request.
  const handleOtpSent = (number) => {
    setMobileNumber(number);
    setStep("otp");
  };

  // Allow the user to return to mobile number entry.
  const handleChangeNumber = () => {
    setMobileNumber("");
    setStep("mobile");
  };

  // Forward the verified login response to the parent.
  const handleVerified = (authData) => {
    onLoginSuccess?.(authData);
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-hidden bg-[#080e1c] text-white lg:h-dvh">
      {/* Subtle background lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_20%,rgba(37,99,235,0.13),transparent_55%)]"
      />

      {/* Application header */}
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center px-6 py-4 sm:px-10 lg:py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/20">
            <MessageCircleMore size={25} />
          </div>

          <span className="text-2xl font-bold tracking-tight">Sandesh</span>
        </div>
      </header>

      {/* Main two-column authentication layout */}
      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-5 py-4 sm:px-10 lg:grid-cols-2 lg:gap-12 lg:py-2">
        {/* Left: minimal desktop introduction */}
        <section className="hidden lg:block">
          <div className="max-w-lg">
            <div className="mb-6 inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-xs font-medium text-blue-300">
              CONNECT • CHAT • SHARE
            </div>

            <h1 className="text-5xl font-bold leading-[1.15] tracking-tight xl:text-6xl">
              Conversations
              <span className="block text-blue-400">made simple.</span>
            </h1>

            <p className="mt-6 max-w-sm text-base leading-7 text-slate-400">
              Your people. Your conversations. All in one place.
            </p>
          </div>
        </section>

        {/* Right: authentication form */}
        <section className="mx-auto w-full max-w-md min-w-0">
          {/* The card grows naturally when an error appears. */}
          <div className="w-full rounded-[28px] border border-[#293854] bg-[#111d31] p-5 shadow-2xl shadow-black/20 sm:p-7">
            {step === "mobile" ? (
              <MobileNumberForm onOtpSent={handleOtpSent} />
            ) : (
              <OtpVerificationForm
                mobileNumber={mobileNumber}
                onVerified={handleVerified}
                onChangeNumber={handleChangeNumber}
              />
            )}
          </div>
        </section>
      </div>

      {/* Application footer */}
      <footer className="relative z-10 px-6 py-2 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Sandesh
      </footer>
    </main>
  );
}
