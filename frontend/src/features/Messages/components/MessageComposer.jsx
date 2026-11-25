/**
 * File: MessageComposer.jsx
 * Purpose: Presents the controlled, themed text, emoji, and attachment composer.
 * Responsibilities: Validate text, handle accessible keyboard submission, and
 * display sending or uncertain-send errors without owning a connection.
 */
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Send, Plus, Image, FileText, X, Smile, MapPin } from "lucide-react";
import { getAttachmentCapabilities, uploadAttachment } from "../services/attachmentService";
import { ThemeContext } from "../../../app/ThemeContext";
import EmojiPickerPopover from "./EmojiPickerPopover";
import MessageLocation from "./MessageLocation";
import useLocationSelection from "../hooks/useLocationSelection";

export default function MessageComposer({
  value, onChange, onSend, pending, disabled, error, onTypingInput, stopTyping, conversationId,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [capabilities, setCapabilities] = useState(null);
  const imageInput = useRef(null);
  const documentInput = useRef(null);
  const menuRef = useRef(null);
  const uploadRef = useRef(null);
  const retryRef = useRef(null);
  const busyRef = useRef(false);
  const locationSelection = useLocationSelection();
  const { location, locating } = locationSelection;
  const locationRetryRef = useRef(null);
  const requestLocation = () => {
    // Adding location changes an attachment retry's contents; use a new operation.
    retryRef.current = null;
    setMenuOpen(false);
    closeEmojiPicker();
    stopTyping?.();
    locationSelection.request();
  };
  const clearLocation = () => {
    locationSelection.clear();
    locationRetryRef.current = null;
    retryRef.current = null;
  };
  useEffect(() => {
    const controller = new AbortController();
    getAttachmentCapabilities(controller.signal).then(setCapabilities).catch(() => {});
    return () => { controller.abort(); uploadRef.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    const escape = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const choose = (event, kind) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowed = kind === "image" ? /\.(jpe?g|png|webp)$/i : /\.(pdf|docx|xlsx|pptx|txt)$/i;
    const max = kind === "image" ? capabilities?.maxImageBytes : capabilities?.maxDocumentBytes;
    if (!allowed.test(file.name) || !file.size || file.size > max) {
      setAttachmentError("Unsupported file or file exceeds the allowed size."); return;
    }
    retryRef.current = null;
    setSelected(file); setAttachmentError("");
    locationRetryRef.current = null;
  };
  const busy = pending || uploading || locating;
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
    setMenuOpen(false);
    setEmojiOpen(true);
  };
  const insertEmoji = (emoji, fromPointer) => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled || !emoji) return;

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
  const length = value.trim().length;
  const invalid = length > 5000;
  const submit = async (event) => {
    event.preventDefault();
    stopTyping?.();
    if (disabled || busy || busyRef.current || invalid || (!length && !selected && !location)) return;
    if (location && !selected) {
      closeEmojiPicker();
      setMenuOpen(false);
      busyRef.current = true;
      setUploading(true);
      setAttachmentError("");
      const operation = locationRetryRef.current ?? {
        clientMessageId: crypto.randomUUID(), caption: value, location,
      };
      locationRetryRef.current = operation;
      try {
        if (await onSend([], operation.clientMessageId, operation.caption, operation.location)) {
          clearLocation();
        }
      } catch (err) {
        setAttachmentError(err.message || "Location could not be sent. Retry to confirm this message.");
      } finally {
        setUploading(false);
        busyRef.current = false;
      }
      return;
    }
    if (!selected) { await onSend(); return; }
    closeEmojiPicker();
    setMenuOpen(false);
    busyRef.current = true;
    setUploading(true); setAttachmentError("");
    const controller = new AbortController();
    uploadRef.current = controller;
    try {
      let operation = retryRef.current;
      if (!operation) {
        const attachment = await uploadAttachment(conversationId, selected, controller.signal);
        if (controller.signal.aborted) return;
        operation = { id: attachment.id, clientMessageId: crypto.randomUUID(), caption: value, location };
        retryRef.current = operation;
      }
      if (controller.signal.aborted) return;
      if (await onSend([operation.id], operation.clientMessageId, operation.caption, operation.location)) {
        retryRef.current = null; setSelected(null);
        clearLocation();
      }
    } catch (err) {
      if (!controller.signal.aborted) setAttachmentError(err.response?.data?.message || err.message || "Attachment upload failed.");
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      busyRef.current = false;
    }
  };
  return (
    <div ref={composerRef} className="relative shrink-0">
      {emojiOpen && (
        <EmojiPickerPopover id={pickerId} isDark={isDark} composerRef={composerRef}
          triggerRef={emojiTriggerRef} onSelect={insertEmoji} onDismiss={closeEmojiPicker} />
      )}
      <form onSubmit={submit} aria-busy={busy}
        className={"shrink-0 border-t px-3 py-2 sm:px-4 " +
          (isDark ? "border-[#293854] bg-[#111d31]" : "border-slate-200 bg-white")}>
        <label htmlFor={id} className="sr-only">Message</label>
        {(location || locating || locationSelection.error) && <div className="mb-2 rounded-xl border border-slate-500/30 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span role="status" className="flex items-center gap-2">{locating && <LoaderCircle size={16} className="animate-spin" />}
              {locating ? "Finding current location..." : "Share current location"}</span>
            <button type="button" disabled={pending || uploading} aria-label="Remove selected location" onClick={clearLocation}
              className="flex size-11 items-center justify-center rounded-lg hover:bg-blue-500/10"><X size={18} /></button>
          </div>
          {location && <MessageLocation key={`${location.latitude},${location.longitude}`} location={location} />}
          {locationSelection.error && <div><p role="alert" className="text-sm text-red-400">{locationSelection.error}</p>
            <button type="button" disabled={disabled || busy} onClick={requestLocation} className="min-h-11 text-sm underline">Retry location</button></div>}
          {location && <p className="text-xs opacity-75">A single position is shared when you send. This is not live tracking.</p>}
        </div>}
        {selected && <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-500/30 p-2 text-sm">
          <FileText size={18} /><span className="min-w-0 flex-1 truncate">{selected.name}</span>
          <button type="button" disabled={busy} aria-label="Remove selected file" onClick={() => { setSelected(null); retryRef.current = null; setAttachmentError(""); }}><X size={18} /></button>
        </div>}
        <div className="flex items-end gap-2 sm:gap-3">
          <div ref={menuRef} className="relative shrink-0">
            <button type="button" aria-label="Add attachment" aria-expanded={menuOpen}
              disabled={disabled || busy}
              onClick={() => {
                closeEmojiPicker();
                setMenuOpen(open => !open);
              }}
              className={"flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-40 " + (isDark ? "border-[#293854] bg-[#080e1c] text-slate-300 hover:bg-[#1b2b45]" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100")}>
              <Plus size={23} />
            </button>
            {menuOpen && <div className={"absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border p-1.5 shadow-xl " + (isDark ? "border-[#293854] bg-[#111d31] text-white" : "border-slate-200 bg-white text-slate-900")}>
              <button type="button" disabled={!capabilities?.enabled} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-blue-500/10 disabled:opacity-40" onClick={() => { setMenuOpen(false); imageInput.current?.click(); }}><Image size={20} className="text-blue-400" /> Image</button>
              <button type="button" disabled={!capabilities?.enabled} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-blue-500/10 disabled:opacity-40" onClick={() => { setMenuOpen(false); documentInput.current?.click(); }}><FileText size={20} className="text-violet-400" /> Document</button>
              <button type="button" disabled={Boolean(location)} onClick={requestLocation}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-blue-500/10 disabled:opacity-40"><MapPin size={20} className="text-emerald-500" /> Location</button>
            </div>}
            <input ref={imageInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={event => choose(event, "image")} />
            <input ref={documentInput} type="file" accept=".pdf,.docx,.xlsx,.pptx,.txt" hidden onChange={event => choose(event, "document")} />
          </div>
          <button type="button" ref={emojiTriggerRef} aria-label="Emoji picker"
            aria-haspopup="dialog" aria-expanded={emojiOpen} disabled={uploading}
            aria-controls={emojiOpen ? pickerId : undefined} onClick={toggleEmojiPicker}
            className={"flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 " + (isDark
              ? emojiOpen ? "bg-blue-400/15 text-blue-300" : "text-slate-300 hover:bg-white/10"
              : emojiOpen ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100")}>
            <Smile size={21} aria-hidden="true" />
          </button>
          <textarea id={id} ref={textareaRef} rows={1} value={value} disabled={uploading}
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
            placeholder="Write a message..."
            className={"chat-flag-text max-h-28 min-h-11 min-w-0 flex-1 field-sizing-content resize-none overflow-y-auto rounded-xl border px-3 py-2.5 text-base leading-[22px] sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 " +
              (isDark ? "border-[#293854] bg-[#080e1c] text-white placeholder:text-slate-500" :
                "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400")}
          />
          <button type="submit" disabled={disabled || busy || (!length && !selected && !location) || invalid}
            aria-label={busy ? "Sending message" : "Send message"}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm sm:px-4 font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <LoaderCircle size={19} className="animate-spin" aria-hidden="true" /> :
              <Send size={19} aria-hidden="true" />}
            <span className="hidden sm:inline">{busy ? "Sending..." : "Send"}</span>
          </button>
        </div>
        <p id={id + "-help"} className={invalid ? "mt-2 text-xs " +
          (isDark ? "text-red-300" : "text-red-600") : "sr-only"}>
          {invalid ? "Message must contain no more than 5,000 characters." :
            "Press Enter to send or Shift+Enter for a new line."}
        </p>
        {attachmentError && <p role="alert" className="mt-2 text-sm text-red-400">{attachmentError}</p>}
        {error && <p id={id + "-error"} role="alert"
          className={"mt-2 text-sm leading-6 " + (isDark ? "text-red-300" : "text-red-600")}>{error}</p>}
      </form>
    </div>
  );
}
