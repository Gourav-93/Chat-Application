import { useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { readAttachment } from "../services/attachmentService";

function Attachment({ attachment }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const downloadRef = useRef(null);
  const image = attachment.contentType?.startsWith("image/");
  useEffect(() => {
    if (!image) return;
    const controller = new AbortController();
    let url;
    readAttachment(attachment.id, controller.signal).then(blob => {
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setPreview(url); }
    }).catch(() => { if (!controller.signal.aborted) setError("Image unavailable."); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [attachment.id, image]);
  useEffect(() => () => downloadRef.current?.abort(), []);
  const download = async () => {
    const controller = new AbortController();
    downloadRef.current = controller; setBusy(true); setError("");
    try {
      const blob = await readAttachment(attachment.id, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = attachment.fileName;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (!controller.signal.aborted) setError("Download failed."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <div className="mb-2 rounded-lg bg-black/10 p-2">
    {image && preview && <img src={preview} alt={attachment.fileName} className="mb-2 max-h-64 max-w-full rounded-lg object-contain" />}
    <div className="flex items-center gap-2 text-sm"><FileText size={20} className="shrink-0" />
      <div className="min-w-0 flex-1"><div className="break-all">{attachment.fileName}</div><div className="text-xs opacity-75">{Math.ceil(attachment.fileSize / 1024)} KB</div></div>
      <button type="button" disabled={busy} onClick={download} aria-label={`Download ${attachment.fileName}`} className="rounded-lg p-2 hover:bg-white/20"><Download size={18} /></button>
    </div>{error && <p role="alert" className="text-xs">{error}</p>}
  </div>;
}
export default function MessageAttachments({ attachments }) {
  return (attachments ?? []).map(attachment => <Attachment key={attachment.id} attachment={attachment} />);
}
