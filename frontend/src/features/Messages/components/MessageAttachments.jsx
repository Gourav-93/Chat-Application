import { useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { readAttachment } from "../services/attachmentService";

function Attachment({ attachment }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [missingId, setMissingId] = useState(null);
  const downloadRef = useRef(null);
  const image = attachment.contentType?.startsWith("image/");
  const unavailable = attachment.isAvailable === false || missingId === attachment.id;
  useEffect(() => {
    if (!image || unavailable) return;
    const controller = new AbortController();
    let url;
    readAttachment(attachment.id, controller.signal).then(blob => {
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setPreview(url); }
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error.response?.status === 404) setMissingId(attachment.id);
      else setError("Image preview could not load. Try downloading again.");
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [attachment.id, image, unavailable]);
  useEffect(() => () => downloadRef.current?.abort(), []);
  const download = async () => {
    if (unavailable || busy) return;
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
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error.response?.status === 404) setMissingId(attachment.id);
        else setError("Download failed. Please try again.");
      }
    }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <div className="mb-2 rounded-lg bg-black/10 p-2">
    {image && preview && !unavailable && <img src={preview} alt={attachment.fileName} className="mb-2 max-h-64 max-w-full rounded-lg object-contain" />}
    <div className="flex items-center gap-2 text-sm"><FileText size={20} className="shrink-0" />
      <div className="min-w-0 flex-1"><div className="break-all">{attachment.fileName}</div><div className="text-xs opacity-75">{Math.ceil(attachment.fileSize / 1024)} KB</div></div>
      {!unavailable && <button type="button" disabled={busy} onClick={download} aria-label={`Download ${attachment.fileName}`} className="rounded-lg p-2 hover:bg-white/20"><Download size={18} /></button>}
    </div>{unavailable ? <p role="status" className="mt-1 text-xs">File unavailable. Please send it again.</p> : error && <p role="alert" className="text-xs">{error}</p>}
  </div>;
}
export default function MessageAttachments({ attachments }) {
  return (attachments ?? []).map(attachment => <Attachment key={attachment.id} attachment={attachment} />);
}
