/**
 * File: MessageComposer.jsx
 * Purpose: Presents the controlled, themed text-message composer.
 * Responsibilities: Validate text, handle accessible keyboard submission, and
 * display sending or uncertain-send errors without owning a connection.
 */
import { useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Send, Plus, Image, FileText, X } from "lucide-react";
import { getAttachmentCapabilities, uploadAttachment } from "../services/attachmentService";
import { ThemeContext } from "../../../app/ThemeContext";

export default function MessageComposer({
  value, onChange, onSend, pending, disabled, error, onTypingInput, stopTyping, conversationId,
}) {
  const theme = useContext(ThemeContext);
  const isDark = theme?.isDark ?? true;
  const id = useId();
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
  };
  const busy = pending || uploading;
  // Clearing the controlled draft programmatically must also stop typing.
  useEffect(() => {
    if (!value.trim()) stopTyping?.();
  }, [value, stopTyping]);
  const length = value.trim().length;
  const invalid = length > 5000;
  const submit = async (event) => {
    event.preventDefault();
    stopTyping?.();
    if (disabled || busy || busyRef.current || invalid || (!length && !selected)) return;
    if (!selected) { await onSend(); return; }
    busyRef.current = true;
    setUploading(true); setAttachmentError("");
    const controller = new AbortController();
    uploadRef.current = controller;
    try {
      let operation = retryRef.current;
      if (!operation) {
        const attachment = await uploadAttachment(conversationId, selected, controller.signal);
        if (controller.signal.aborted) return;
        operation = { id: attachment.id, clientMessageId: crypto.randomUUID(), caption: value };
        retryRef.current = operation;
      }
      if (controller.signal.aborted) return;
      if (await onSend([operation.id], operation.clientMessageId, operation.caption)) {
        retryRef.current = null; setSelected(null);
      }
    } catch (err) {
      if (!controller.signal.aborted) setAttachmentError(err.response?.data?.message || err.message || "Attachment upload failed.");
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      busyRef.current = false;
    }
  };
  return (
    <form onSubmit={submit} aria-busy={busy}
      className={"shrink-0 border-t px-3 py-2 sm:px-4 " +
        (isDark ? "border-[#293854] bg-[#111d31]" : "border-slate-200 bg-white")}>
      <label htmlFor={id} className="sr-only">Message</label>
      {selected && <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-500/30 p-2 text-sm">
        <FileText size={18} /><span className="min-w-0 flex-1 truncate">{selected.name}</span>
        <button type="button" disabled={busy} aria-label="Remove selected file" onClick={() => { setSelected(null); retryRef.current = null; setAttachmentError(""); }}><X size={18} /></button>
      </div>}
      <div className="flex items-end gap-2 sm:gap-3">
        <div ref={menuRef} className="relative shrink-0">
          <button type="button" aria-label="Add attachment" aria-expanded={menuOpen}
            disabled={disabled || busy || !capabilities?.enabled}
            onClick={() => setMenuOpen(open => !open)}
            className={"flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-40 " + (isDark ? "border-[#293854] bg-[#080e1c] text-slate-300 hover:bg-[#1b2b45]" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100")}>
            <Plus size={23} />
          </button>
          {menuOpen && <div className={"absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border p-1.5 shadow-xl " + (isDark ? "border-[#293854] bg-[#111d31] text-white" : "border-slate-200 bg-white text-slate-900")}>
            <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-blue-500/10" onClick={() => { setMenuOpen(false); imageInput.current?.click(); }}><Image size={20} className="text-blue-400" /> Image</button>
            <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-blue-500/10" onClick={() => { setMenuOpen(false); documentInput.current?.click(); }}><FileText size={20} className="text-violet-400" /> Document</button>
          </div>}
          <input ref={imageInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={event => choose(event, "image")} />
          <input ref={documentInput} type="file" accept=".pdf,.docx,.xlsx,.pptx,.txt" hidden onChange={event => choose(event, "document")} />
        </div>
        <textarea id={id} rows={1} value={value} disabled={uploading}
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
          className={"max-h-28 min-h-11 min-w-0 flex-1 field-sizing-content resize-none overflow-y-auto rounded-xl border px-3 py-2.5 text-base leading-[22px] sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 " +
            (isDark ? "border-[#293854] bg-[#080e1c] text-white placeholder:text-slate-500" :
              "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400")}
        />
        <button type="submit" disabled={disabled || busy || (!length && !selected) || invalid}
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
  );
}
