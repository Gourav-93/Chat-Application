import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMessageHistoryService } from "../src/features/Messages/services/MessageHistoryService";

const transport = vi.hoisted(() => ({ connection: null }));
vi.mock("../src/shared/lib/api", () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock("../src/shared/lib/privacyAccess", () => ({ getPrivacyToken: () => null, clearPrivacy: vi.fn() }));
vi.mock("@microsoft/signalr", () => ({
  HubConnectionState: { Connected: "Connected", Disconnected: "Disconnected" }, LogLevel: { Warning: 3, None: 6 },
  HubConnectionBuilder: class {
    withUrl() { return this; }
    configureLogging() { return this; }
    build() { return transport.connection; }
  },
}));
const location = { latitude: 0, longitude: 0 };
const message = { id: 1, conversationId: 1, senderId: "a", receiverId: "b", text: "", type: 4,
  location, attachments: [], sentAt: "2026-11-25T10:00:00Z" };
let service, handlers, onMessages;
beforeEach(async () => {
  handlers = new Map();
  transport.connection = {
    state: "Connected", on: (name, handler) => handlers.set(name, handler),
    off: (name) => handlers.delete(name), onclose: vi.fn(),
    start: vi.fn().mockResolvedValue(), stop: vi.fn().mockImplementation(async () => {
      transport.connection.state = "Disconnected";
    }),
    invoke: vi.fn().mockResolvedValue(),
  };
  onMessages = vi.fn();
  service = createMessageHistoryService("token", Date.now() + 60000, { onMessages });
  await service.start();
});
afterEach(async () => { await service?.dispose(); });

it("sends structured zero coordinates through the existing SignalR method", async () => {
  await service.send(1, "", [], "operation-id", location);
  expect(transport.connection.invoke).toHaveBeenCalledWith("SendMessage", {
    conversationId: 1, text: "", attachmentIds: [], clientMessageId: "operation-id", location,
  });
});
it("preserves live and reconnect location payloads", () => {
  handlers.get("ReceiveMessage")(message);
  handlers.get("PendingMessages")([message]);
  expect(onMessages).toHaveBeenNthCalledWith(1, [message]);
  expect(onMessages).toHaveBeenNthCalledWith(2, [message]);
});
it("preserves location data in paginated history", async () => {
  transport.connection.invoke.mockImplementation(async (method) => {
    if (method === "GetMessages") handlers.get("MessageHistory")([message]);
  });
  expect(await service.request(1, 1, 20, () => true)).toEqual([message]);
});
it("keeps the text and attachment request payloads compatible", async () => {
  await service.send(1, "Hello 😀");
  expect(transport.connection.invoke).toHaveBeenLastCalledWith("SendMessage", {
    conversationId: 1, text: "Hello 😀", attachmentIds: [], clientMessageId: null,
  });
  await service.send(1, "", ["file-id"], "attachment-operation");
  expect(transport.connection.invoke).toHaveBeenLastCalledWith("SendMessage", {
    conversationId: 1, text: "", attachmentIds: ["file-id"], clientMessageId: "attachment-operation",
  });
});
