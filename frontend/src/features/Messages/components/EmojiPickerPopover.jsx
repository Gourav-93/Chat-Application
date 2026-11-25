/**
 * File: EmojiPickerPopover.jsx
 * Purpose: Lazily load the themed emoji picker and its local flag font within the visible chat area.
 * Responsibilities: Position the picker, manage dismissal and keyboard focus, and return Unicode selections.
 */
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

const EmojiPicker = lazy(() => Promise.all([
  import("emoji-picker-react"),
  import("emoji-picker-react/data/emojis-en"),
  // Load both flag subsets before the picker probes native support.
  globalThis.document?.fonts?.load('1em "Chat Flag Emoji"', "\u{1F1EE}\u{1F1F3}\u{1F3F4}").catch(() => {}),
]).then(([{ default: Picker }, { default: data }]) => {
  // The bundled font supports Sark even when the OS fails the general Emoji 16 probe.
  // Give it a separate compatibility group so the picker probes this glyph directly.
  const flags = data.emojis.flags.map((flag) =>
    flag.u === "1f1e8-1f1f6" ? { ...flag, a: "0" } : flag,
  );
  const emojiData = { ...data, emojis: { ...data.emojis, flags } };
  return { default: (props) => <Picker {...props} emojiData={emojiData} /> };
}).catch(() => ({
  default: function PickerLoadError() {
    return <p role="alert" className="p-3 text-sm">Could not load emojis. Reload to try again.</p>;
  },
})));

export default function EmojiPickerPopover({
  id, isDark, composerRef, triggerRef, onSelect, onDismiss,
}) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const composer = composerRef.current;
    const chat = composer?.parentElement;
    if (!panel || !chat) return undefined;

    const viewport = window.visualViewport;
    const position = () => {
      const composerTop = composer.getBoundingClientRect().top;
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
      const top = Math.max(chat.getBoundingClientRect().top, visibleTop) + 8;
      // Lift the panel above the visible bottom when a mobile keyboard covers the composer.
      const bottom = Math.min(composerTop, visibleBottom) - 8;
      panel.style.bottom = `calc(100% + ${composerTop - bottom}px)`;
      panel.style.height = `${Math.max(0, Math.min(384, bottom - top))}px`;
    };
    const observer = new ResizeObserver(position);
    observer.observe(composer);
    observer.observe(chat);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    position();
    closeRef.current?.focus({ preventScroll: true });

    const dismissOutside = (event) => {
      if (!panel.contains(event.target) && !triggerRef.current?.contains(event.target)) {
        onDismiss();
      }
    };
    const dismissOnEscape = (event) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismiss(panel.contains(document.activeElement));
    };
    document.addEventListener("pointerdown", dismissOutside);
    // The picker also captures Escape on window to clear its search.
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
      document.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [composerRef, triggerRef, onDismiss]);

  return (
    <div id={id} ref={panelRef} role="dialog" aria-label="Emoji picker"
      className={"chat-emoji-picker absolute inset-x-2 z-10 flex max-w-[22rem] flex-col overflow-hidden rounded-xl border shadow-lg sm:left-4 " +
        (isDark ? "border-[#293854] bg-[#111d31] text-slate-100" : "border-slate-200 bg-white text-slate-900")}
    >
      <div className="flex shrink-0 justify-end px-1">
        <button type="button" ref={closeRef} aria-label="Close emoji picker"
          onClick={() => onDismiss(true)}
          className={"flex size-9 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 " +
            (isDark ? "hover:bg-white/10" : "hover:bg-slate-100")}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1"
        style={{
          "--epr-bg-color": isDark ? "#111d31" : "#fff",
          "--epr-picker-border-color": "transparent",
          "--epr-highlight-color": isDark ? "#60a5fa" : "#2563eb",
          "--epr-search-input-bg-color": isDark ? "#080e1c" : "#f8fafc",
          "--epr-category-label-bg-color": isDark ? "#111d31" : "#fff",
        }}>
        <Suspense fallback={<p role="status" className="p-3 text-sm">Loading emojis?</p>}>
          <EmojiPicker width="100%" height="100%" colorScheme={isDark ? "dark" : "light"}
            autoFocusSearch={false} emojiStyle="native" previewConfig={{ showPreview: false }}
            suggestedEmojisMode="recent" onEmojiClick={({ emoji }, event) => {
              if (panelRef.current) onSelect(emoji, event.detail > 0);
            }} />
        </Suspense>
      </div>
    </div>
  );
}
