// Displays a bounded, glyph-only row of composer suggestions without taking textarea focus.

import { useLayoutEffect, useRef } from "react";

export default function EmojiShortcodeSuggestions({
  id,
  isDark,
  composerRef,
  items,
  activeIndex,
  visible,
  onFitChange,
  onChoose,
}) {
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const composer = composerRef.current;
    const chat = composer?.parentElement;
    if (!panel || !chat) return undefined;
    const viewport = window.visualViewport;
    const position = () => {
      const composerTop = composer.getBoundingClientRect().top;
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom =
        visibleTop + (viewport?.height ?? window.innerHeight);
      const bottom = Math.min(composerTop, visibleBottom) - 8;
      const top = Math.max(chat.getBoundingClientRect().top, visibleTop) + 8;
      // Match the existing picker boundary, including the mobile keyboard viewport.
      panel.style.bottom = "calc(100% + " + (composerTop - bottom) + "px)";
      onFitChange(bottom - panel.offsetHeight >= top);
    };
    const observer = new ResizeObserver(position);
    observer.observe(composer);
    observer.observe(chat);
    observer.observe(panel);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    position();
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
    };
  }, [composerRef, onFitChange]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const active = panel?.children[activeIndex];
    if (!panel || !active || !visible) return;
    const viewport = panel.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    // Scroll the row alone. Moving the dashboard would shift the message history.
    if (item.left < viewport.left + 4)
      panel.scrollLeft += item.left - viewport.left - 4;
    else if (item.right > viewport.right - 4)
      panel.scrollLeft += item.right - viewport.right + 4;
  }, [activeIndex, items, visible]);

  return (
    <div
      id={id}
      ref={panelRef}
      role="listbox"
      aria-label="Emoji suggestions"
      aria-orientation="horizontal"
      aria-hidden={!visible || undefined}
      className={
        "absolute bottom-full left-2 z-10 flex w-max max-w-[calc(100%_-_1rem)] gap-1 overflow-x-auto overscroll-x-contain touch-pan-x rounded-xl border p-1 shadow-lg sm:left-4 sm:max-w-[calc(100%_-_2rem)] " +
        (visible ? "" : "invisible ") +
        (isDark
          ? "border-[#293854] bg-[#111d31] text-slate-100"
          : "border-slate-200 bg-white text-slate-900")
      }
    >
      {items.map((item, index) => (
        <button
          key={item.unified}
          id={id + "-" + item.unified}
          type="button"
          role="option"
          tabIndex={-1}
          aria-label={item.name}
          aria-selected={index === activeIndex}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onChoose(item)}
          className={
            "chat-flag-text flex size-11 shrink-0 items-center justify-center rounded-lg text-2xl leading-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 " +
            (index === activeIndex
              ? isDark
                ? "bg-blue-500/25 ring-1 ring-inset ring-blue-400"
                : "bg-blue-100 ring-1 ring-inset ring-blue-500"
              : isDark
                ? "hover:bg-white/10"
                : "hover:bg-slate-100")
          }
        >
          <span aria-hidden="true">{item.emoji}</span>
        </button>
      ))}
    </div>
  );
}
