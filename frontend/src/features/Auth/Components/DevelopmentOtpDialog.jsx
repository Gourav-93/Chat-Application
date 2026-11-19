import { useEffect, useId, useRef } from "react";

export default function DevelopmentOtpDialog({ otp, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();

    const closeTimer = window.setTimeout(() => dialog.close(), 30_000);
    return () => window.clearTimeout(closeTimer);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(90vw,22rem)] rounded-2xl border border-[#293854] bg-[#111d31] p-6 text-center text-white shadow-xl backdrop:bg-slate-950/70"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Development test OTP
      </h2>
      <p className="mt-4 select-all font-mono text-3xl font-semibold tracking-widest text-blue-300">
        {otp}
      </p>
      <form method="dialog">
        <button
          type="submit"
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        >
          Dismiss
        </button>
      </form>
    </dialog>
  );
}
