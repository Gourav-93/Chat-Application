import { useContext, useEffect, useId, useRef } from "react";
import { ThemeContext } from "../../../app/ThemeContext";
import { getDisplayName } from "../../../shared/lib/displayIdentity";

export default function UserBlockingDialog({ contact, blocks, onClose }) {
  const { isDark = true } = useContext(ThemeContext) || {};
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const button = "min-h-11 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50";
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={contact ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); if (!blocks.busy) onClose(); }}
      className={`m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border p-5 shadow-xl backdrop:bg-black/60 ${isDark ? "border-[#293854] bg-[#111d31] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
      <h2 id={titleId} className="text-lg font-semibold">{contact ? "Block this contact?" : "Blocked users"}</h2>
      {contact ? <p id={descriptionId} className="mt-3 text-sm leading-6">You will no longer receive messages from this contact. They will not be notified that you blocked them.</p> : (
        <div className="mt-3">
          {blocks.loading ? <p role="status">Loading blocked users…</p> : blocks.users.length === 0
            ? <p>No blocked users.</p>
            : <ul className="space-y-2">{blocks.users.map((user) => (
              <li key={user.userId} className="flex items-center gap-2 border-b border-slate-500/20 py-2">
                <div className="min-w-0 flex-1 break-words">
                  <p>{getDisplayName(user.userName, user.mobileNumber)}</p>
                  <p className="text-xs opacity-70">{user.mobileNumber}</p>
                </div>
                <button type="button" disabled={blocks.busy} className={button}
                  onClick={() => blocks.setBlocked(user, false)}>Unblock</button>
              </li>
            ))}</ul>}
        </div>
      )}
      {blocks.error && <div className="mt-3 text-sm"><p role="alert">{blocks.error}</p>
        <button type="button" disabled={blocks.busy} onClick={blocks.retry} className={button}>Retry loading</button></div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={blocks.busy} onClick={onClose} className={button}>{contact ? "Cancel" : "Close"}</button>
        {contact && <button type="button" disabled={blocks.busy} className={`${button} bg-red-600 text-white hover:bg-red-700`}
          onClick={async () => { if (await blocks.setBlocked(contact, true)) onClose(); }}>{blocks.busy ? "Blocking…" : "Block"}</button>}
      </div>
    </dialog>
  );
}
