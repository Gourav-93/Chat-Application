import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessageComposer from "../src/features/Messages/components/MessageComposer";
import MessageLocation from "../src/features/Messages/components/MessageLocation";
import ChatPanel from "../src/features/Messages/components/ChatPanel";
import useLocationSelection from "../src/features/Messages/hooks/useLocationSelection";
import { getAttachmentCapabilities, uploadAttachment } from "../src/features/Messages/services/attachmentService";

vi.mock("../src/features/Messages/services/attachmentService", () => ({
  getAttachmentCapabilities: vi.fn(), uploadAttachment: vi.fn(), readAttachment: vi.fn(),
}));
const point = { latitude: 28.6139, longitude: 77.209 };
let locate;
beforeEach(() => {
  locate = vi.fn();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: locate } });
  getAttachmentCapabilities.mockResolvedValue({ enabled: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function composer(onSend = vi.fn().mockResolvedValue(true), value = "") {
  const view = render(<MessageComposer conversationId={1} value={value} onChange={vi.fn()} onSend={onSend} />);
  return { ...view, onSend };
}
async function selectLocation() {
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  await screen.findByRole("button", { name: "Location" });
  fireEvent.click(screen.getByRole("button", { name: "Location" }));
}
function resolveLocation() { act(() => locate.mock.calls.at(-1)[0]({ coords: point })); }

describe("location composer", () => {
  it("requests location only on selection and leaves file restrictions in place", async () => {
    composer();
    expect(locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    expect(screen.getByRole("button", { name: "Image" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Document" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(locate).toHaveBeenCalledTimes(1);
    expect(locate.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    expect(screen.getByText("Finding current location...")).toBeTruthy();
    resolveLocation();
    expect(screen.getByText("28.61390, 77.20900")).toBeTruthy();
  });
  it("sends structured coordinates and clears the preview after confirmation", async () => {
    const { onSend } = composer();
    await selectLocation(); resolveLocation();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith([], expect.any(String), "", point));
    await waitFor(() => expect(screen.queryByText("Share current location")).toBeNull());
  });
  it("retains the same operation ID and coordinates on an uncertain send retry", async () => {
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    composer(onSend, "Meet here"); await selectLocation(); resolveLocation();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1]).toEqual(onSend.mock.calls[0]);
  });
  it("removes a selection and ignores a late geolocation callback", async () => {
    const { onSend } = composer(); await selectLocation();
    fireEvent.click(screen.getByRole("button", { name: "Remove selected location" }));
    resolveLocation();
    expect(screen.queryByText("28.61390, 77.20900")).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" }).disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });
  it.each([[1, /permission denied/i], [2, /unavailable/i], [3, /timed out/i]])("handles geolocation error %s and retry", async (code, message) => {
    composer(); await selectLocation();
    act(() => locate.mock.calls[0][1]({ code }));
    expect(screen.getByRole("alert").textContent).toMatch(message);
    fireEvent.click(screen.getByRole("button", { name: "Retry location" }));
    resolveLocation();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("preserves text-only sending", async () => {
    const { onSend } = composer(undefined, "Hello 😀");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith());
    expect(locate).not.toHaveBeenCalled();
  });
  it("keeps image uploads and location in the same existing send flow", async () => {
    getAttachmentCapabilities.mockResolvedValue({ enabled: true, maxImageBytes: 10000 });
    uploadAttachment.mockResolvedValue({ id: "attachment-id" });
    const { container, onSend } = composer();
    await selectLocation(); resolveLocation();
    fireEvent.change(container.querySelector('input[accept=".jpg,.jpeg,.png,.webp"]'), {
      target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(["attachment-id"], expect.any(String), "", point));
  });
});

describe("location lifecycle and rendering", () => {
  it("handles insecure contexts without asking for permission", () => {
    vi.stubGlobal("isSecureContext", false);
    const { result } = renderHook(useLocationSelection);
    act(() => result.current.request());
    expect(result.current.error).toMatch(/HTTPS/);
    expect(locate).not.toHaveBeenCalled();
  });
  it("ignores callbacks after unmount", () => {
    const { result, unmount } = renderHook(useLocationSelection);
    act(() => result.current.request()); unmount();
    expect(() => resolveLocation()).not.toThrow();
  });
  it("keeps coordinates and the Maps action usable when the preview fails", () => {
    render(<MessageLocation location={point} />);
    fireEvent.error(screen.getByTitle("Current location map preview"));
    expect(screen.getByText("Map preview unavailable")).toBeTruthy();
    expect(screen.getByText("28.61390, 77.20900")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open current location in Maps" }).href).toContain("28.6139%2C77.209");
  });
  it("renders location from received or history messages with existing receipts and text", () => {
    const messages = [
      { id: 1, senderId: "b", text: "", type: 4, location: point, sentAt: "2026-11-25T10:00:00Z" },
      { id: 2, senderId: "a", text: "Hello", sentAt: "2026-11-25T10:01:00Z", readAt: "2026-11-25T10:02:00Z" },
    ];
    render(<ChatPanel selection={{ conversation: { conversationId: 1, otherUserId: "b", otherUserName: "Contact" }, generation: 0 }}
      history={{ messages, userId: "a" }} session={{ status: "connected", presence: new Map() }}
      activity={{}} draft="" onDraftChange={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Open current location in Maps" })).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByTitle("Read")).toBeTruthy();
  });
});
