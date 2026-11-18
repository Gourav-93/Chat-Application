/**
 * File: MessageComposer.jsx
 * Purpose: Presents the controlled, themed text-message composer.
 * Responsibilities: Validate text, handle accessible keyboard submission, and
 * display sending or uncertain-send errors without owning a connection.
 */
import { useContext, useEffect, useId } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";

export default function MessageComposer({
  value, onChange, onSend, pending, disabled, error, onTypingInput, stopTyping,
}) {
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const id = useId();
  // Clearing the controlled draft programmatically must also stop typing.
  useEffect(() => {
    if (!value.trim()) stopTyping?.();
  }, [value, stopTyping]);
  const length = value.trim().length;
  const invalid = length > 5000;
  const submit = (event) => {
    event.preventDefault();
    stopTyping?.();
    if (!disabled && !pending && length > 0 && !invalid) onSend();
  };
  return (
    <form onSubmit={submit} aria-busy={pending}
      className={"shrink-0 border-t p-3 sm:p-4 " +
        (isDark ? "border-[#293854] bg-[#111d31]" : "border-slate-200 bg-white")}>
      <label htmlFor={id} className="sr-only">Message</label>
      <div className="flex items-end gap-3">
        <textarea id={id} rows={2} value={value}
          onChange={(event) => {
            const draftValue = event.target.value;
            onChange(draftValue);
            onTypingInput?.(draftValue);
          }}
          onBlur={() => stopTyping?.()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey &&
                !event.nativeEvent.isComposing && event.keyCode !== 229) submit(event);
          }}
          aria-invalid={invalid}
          aria-describedby={id + "-help" + (error ? " " + id + "-error" : "")}
          placeholder="Write a message..."
          className={"min-h-12 min-w-0 flex-1 resize-none rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 " +
            (isDark ? "border-[#293854] bg-[#080e1c] text-white placeholder:text-slate-500" :
              "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400")}
        />
        <button type="submit" disabled={disabled || pending || !length || invalid}
          aria-label={pending ? "Sending message" : "Send message"}
          className="flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? <LoaderCircle size={19} className="animate-spin" aria-hidden="true" /> :
            <Send size={19} aria-hidden="true" />}
          <span className="hidden sm:inline">{pending ? "Sending..." : "Send"}</span>
        </button>
      </div>
      <p id={id + "-help"} className={"mt-2 text-xs " + (invalid ? "text-red-400" : isDark ? "text-slate-400" : "text-slate-500")}>
        {invalid ? "Message must contain no more than 5,000 characters." :
          "Enter to send ? Shift+Enter for a new line"}
      </p>
      {error && <p id={id + "-error"} role="alert"
        className={"mt-2 text-sm leading-6 " + (isDark ? "text-red-300" : "text-red-600")}>{error}</p>}
    </form>
  );
}
