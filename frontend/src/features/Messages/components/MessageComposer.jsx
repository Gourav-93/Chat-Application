/**
 * File: MessageComposer.jsx
 * Purpose: Presents the controlled, themed text-message composer and emoji picker.
 * Responsibilities: Insert consecutive emoji selections into drafts, validate text,
 * handle accessible submission, and display send status.
 */
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Paperclip, Send, Smile } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";
import EmojiPickerPopover from "./EmojiPickerPopover";

export default function MessageComposer({
  value, onChange, onSend, pending, disabled, error, onTypingInput, stopTyping,
}) {
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const id = useId();
  const pickerId = id + "-emoji-picker";
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composerRef = useRef(null);
  const textareaRef = useRef(null);
  const emojiTriggerRef = useRef(null);
  const restoringPickerFocusRef = useRef(false);
  // Clearing the controlled draft programmatically must also stop typing.
  useEffect(() => {
    if (!value.trim()) stopTyping?.();
  }, [value, stopTyping]);
  const updateDraft = (text) => {
    onChange(text);
    onTypingInput?.(text);
  };
  const closeEmojiPicker = useCallback((restoreFocus = false) => {
    setEmojiOpen(false);
    if (restoreFocus) emojiTriggerRef.current?.focus({ preventScroll: true });
  }, []);
  const toggleEmojiPicker = () => {
    if (emojiOpen) {
      closeEmojiPicker(true);
      return;
    }
    setEmojiOpen(true);
  };
  const insertEmoji = (emoji, fromPointer) => {
    const textarea = textareaRef.current;
    if (!textarea || !emoji) return;

    const previousFocus = document.activeElement;
    const { selectionStart, selectionEnd } = textarea;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(selectionStart, selectionEnd);

    // A native edit preserves browser undo and reaches the controlled draft via onChange.
    if (!document.execCommand?.("insertText", false, emoji)) {
      textarea.setRangeText(emoji, selectionStart, selectionEnd, "end");
      updateDraft(textarea.value);
    }

    // Keep keyboard users in the picker. Pointer users can continue typing immediately.
    if (!fromPointer && previousFocus !== textarea && previousFocus?.isConnected) {
      restoringPickerFocusRef.current = true;
      previousFocus.focus({ preventScroll: true });
      restoringPickerFocusRef.current = false;
    }
  };
  const iconButton = "flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500";
  const length = value.trim().length;
  const invalid = length > 5000;
  const submit = (event) => {
    event.preventDefault();
    stopTyping?.();
    if (!disabled && !pending && length > 0 && !invalid) onSend();
  };
  return (
    <div ref={composerRef} className="relative shrink-0">
      {emojiOpen && (
        <EmojiPickerPopover id={pickerId} isDark={isDark} composerRef={composerRef}
          triggerRef={emojiTriggerRef} onSelect={insertEmoji} onDismiss={closeEmojiPicker} />
      )}
      <form onSubmit={submit} aria-busy={pending}
        className={"border-t px-2 py-2 sm:px-4 " +
          (isDark ? "border-[#293854] bg-[#111d31]" : "border-slate-200 bg-white")}>
        <label htmlFor={id} className="sr-only">Message</label>
        <div className="flex items-end gap-1.5 sm:gap-2">
          <button type="button" disabled aria-label="Attachments unavailable"
            className={iconButton + " opacity-50 disabled:cursor-not-allowed " +
              (isDark ? "text-slate-400" : "text-slate-600")}>
            <Paperclip size={20} aria-hidden="true" />
          </button>
          <button type="button" ref={emojiTriggerRef} aria-label="Emoji picker"
            aria-haspopup="dialog" aria-expanded={emojiOpen}
            aria-controls={emojiOpen ? pickerId : undefined} onClick={toggleEmojiPicker}
            className={iconButton + " " + (isDark
              ? emojiOpen ? "bg-blue-400/15 text-blue-300" : "text-slate-300 hover:bg-white/10"
              : emojiOpen ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100")}>
            <Smile size={21} aria-hidden="true" />
          </button>
          <textarea id={id} ref={textareaRef} rows={1} value={value}
            onChange={(event) => updateDraft(event.target.value)}
            onBlur={() => {
              if (!restoringPickerFocusRef.current) stopTyping?.();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey &&
                  !event.nativeEvent.isComposing && event.keyCode !== 229) submit(event);
            }}
            aria-invalid={invalid}
            aria-describedby={id + "-help" + (error ? " " + id + "-error" : "")}
            placeholder="Type a message"
            className={"chat-flag-text max-h-28 min-h-11 min-w-0 flex-1 field-sizing-content resize-none overflow-y-auto rounded-xl border px-3 py-2.5 text-base leading-[22px] sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 " +
              (isDark ? "border-[#293854] bg-[#080e1c] text-white placeholder:text-slate-500" :
                "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400")}
          />
          <button type="submit" disabled={disabled || pending || !length || invalid}
            aria-label={pending ? "Sending message" : "Send message"}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm sm:px-4 font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {pending ? <LoaderCircle size={19} className="animate-spin" aria-hidden="true" /> :
              <Send size={19} aria-hidden="true" />}
            <span className="hidden sm:inline">{pending ? "Sending..." : "Send"}</span>
          </button>
        </div>
        <p id={id + "-help"} className={invalid ? "mt-2 text-xs " +
          (isDark ? "text-red-300" : "text-red-600") : "sr-only"}>
          {invalid ? "Message must contain no more than 5,000 characters." :
            "Press Enter to send or Shift+Enter for a new line."}
        </p>
        {error && <p id={id + "-error"} role="alert"
          className={"mt-2 text-sm leading-6 " + (isDark ? "text-red-300" : "text-red-600")}>{error}</p>}
      </form>
    </div>
  );
}
