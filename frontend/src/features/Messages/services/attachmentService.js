import api from "../../../shared/lib/api";

export async function uploadAttachment(conversationId, file, signal) {
  const body = new FormData();
  body.append("conversationId", String(conversationId));
  body.append("file", file);
  const { data } = await api.post("/attachments/upload", body, {
    headers: { "Content-Type": undefined }, signal, timeout: 120000,
  });
  return data;
}

export async function readAttachment(id, signal) {
  const { data } = await api.get(`/attachments/${encodeURIComponent(id)}`, {
    responseType: "blob", signal, timeout: 120000,
  });
  return data;
}

export async function getAttachmentCapabilities(signal) {
  const { data } = await api.get("/attachments/capabilities", { signal });
  return data;
}
