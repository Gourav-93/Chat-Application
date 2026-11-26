import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPanel from "../src/features/Messages/components/ChatPanel";
import UserBlockingDialog from "../src/features/Conversations/Components/UserBlockingDialog";
import ProfileMenu from "../src/features/Conversations/Components/ProfileMenu";
import useUserBlocks from "../src/features/Conversations/Hooks/useUserBlocks";
import useConversationActivity from "../src/features/Messages/hooks/useConversationActivity";
import api from "../src/shared/lib/api";

vi.mock("../src/shared/lib/api", () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../src/features/Messages/services/attachmentService", () => ({
  getAttachmentCapabilities: vi.fn().mockResolvedValue({ enabled: false }),
  uploadAttachment: vi.fn(),
  readAttachment: vi.fn(),
}));

const contact = { conversationId: 1, otherUserId: "b", otherUserName: "Contact B", otherUserMobileNumber: "+911234567890" };
const sent = { id: 1, conversationId: 1, senderId: "a", receiverId: "b", text: "Persisted message", sentAt: "2026-11-25T10:00:00Z", deliveredAt: null, readAt: null, attachments: [] };
const makeBlocks = (blocked = false) => ({
  isBlocked: () => blocked, busy: false, loading: false, error: "", users: [], retry: vi.fn(), setBlocked: vi.fn().mockResolvedValue(true),
});
const makePanel = (blocks) => ({
  selection: { conversation: contact, generation: 0 },
  history: { messages: [sent], userId: "a", isLoading: false, isLoadingOlder: false, hasMore: false, error: "" },
  session: { status: "connected", presence: new Map(), sending: null },
  activity: { label: "Online" }, draft: "Hello", onDraftChange: vi.fn(), onSend: vi.fn(),
  onBack: vi.fn(), onConversationAction: vi.fn(), stopTyping: vi.fn(), blocks,
});

beforeEach(() => {
  api.get.mockResolvedValue({ data: [] });
  api.post.mockResolvedValue({ data: { userId: "b", isBlockedByMe: true } });
  api.delete.mockResolvedValue({ data: { userId: "b", isBlockedByMe: false } });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("conversation blocking controls", () => {
  it("renders no online or last-seen label for a neutral presence snapshot and restores normal presence", () => {
    const service = { getUserStatus: vi.fn().mockResolvedValue(undefined) };
    const session = { owner: { service }, status: "connected", userId: "a", subscribeTyping: () => () => {}, setTyping: vi.fn(), presence: new Map([["b", { isOnline: null, lastSeenAt: null }]]) };
    const { result, rerender } = renderHook(({ current }) => useConversationActivity({ conversation: contact }, current, { messages: [] }, false), { initialProps: { current: session } });
    expect(result.current.label).toBeNull();
    rerender({ current: { ...session, presence: new Map([["b", { isOnline: true }]]) } });
    expect(result.current.label).toBe("Online");
    rerender({ current: { ...session, presence: new Map([["b", { isOnline: false, lastSeenAt: "2026-11-25T10:00:00Z" }]]) } });
    expect(result.current.label).toMatch(/^Last seen /);
  });
  it("replaces the entire composer and attachment controls, preserves history, and restores them on unblock", () => {
    const blocked = makeBlocks(true);
    const props = makePanel(blocked);
    const view = render(<ChatPanel {...props} />);
    expect(screen.getByText("You blocked this contact.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(screen.getByText("Persisted message")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Unblock User" }).at(-1));
    expect(blocked.setBlocked).toHaveBeenCalledWith(contact, false);
    view.rerender(<ChatPanel {...props} blocks={makeBlocks(false)} />);
    expect(screen.queryByText("You blocked this contact.")).toBeNull();
    expect(screen.getByRole("textbox").disabled).toBe(false);
    expect(screen.getByText("Persisted message")).toBeTruthy();
  });

  it("keeps a blocked sender's composer enabled and old messages single tick beside newly delivered messages", () => {
    const props = makePanel(makeBlocks(false));
    const view = render(<ChatPanel {...props} />);
    expect(screen.getByRole("textbox").disabled).toBe(false);
    expect(screen.getByTitle("Sent")).toBeTruthy();
    const fresh = { ...sent, id: 2, text: "After unblock", deliveredAt: "2026-11-25T10:01:00Z" };
    view.rerender(<ChatPanel {...props} history={{ ...props.history, messages: [sent, fresh] }} />);
    expect(screen.getByTitle("Sent")).toBeTruthy();
    expect(screen.getByTitle("Delivered")).toBeTruthy();
    expect(screen.queryByText(/delivery suppressed/i)).toBeNull();
  });

  it("disables all composer submissions while own block state is loading", () => {
    const blocks = { ...makeBlocks(), loading: true };
    const props = makePanel(blocks);
    render(<ChatPanel {...props} />);
    expect(screen.getByRole("button", { name: "Send message" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Add attachment" }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", code: "Enter" });
    fireEvent.submit(screen.getByRole("textbox").closest("form"));
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("confirms blocking with the requested privacy wording and cancels without a mutation", async () => {
    const blocks = makeBlocks();
    const close = vi.fn();
    const view = render(<UserBlockingDialog contact={contact} blocks={blocks} onClose={close} />);
    expect(screen.getByRole("dialog", { name: "Block this contact?" })).toBeTruthy();
    expect(screen.getByText("You will no longer receive messages from this contact. They will not be notified that you blocked them.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    expect(blocks.setBlocked).not.toHaveBeenCalled();
    view.rerender(<UserBlockingDialog contact={contact} blocks={blocks} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Block", exact: true }));
    await waitFor(() => expect(blocks.setBlocked).toHaveBeenCalledWith(contact, true));
  });

  it("offers the blocked-users list from the profile and allows unblocking a listed contact", () => {
    const open = vi.fn();
    const profile = render(<ProfileMenu onBlockedUsers={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Your profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Blocked users" }));
    expect(open).toHaveBeenCalledOnce();
    profile.unmount();
    const blocks = makeBlocks();
    blocks.users = [{ userId: "b", userName: "Contact B", mobileNumber: "+911234567890" }];
    render(<UserBlockingDialog blocks={blocks} onClose={vi.fn()} />);
    expect(screen.getByText("Contact B")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unblock", exact: true }));
    expect(blocks.setBlocked).toHaveBeenCalledWith(blocks.users[0], false);
  });
});

describe("persistent own block state", () => {
  it("loads state after refresh, applies server success, rejects duplicate clicks and restores on unblock", async () => {
    api.get.mockResolvedValue({ data: [{ userId: "b", userName: "Contact B" }] });
    const { result } = renderHook(() => useUserBlocks("a", "b", 0, "connected"));
    await waitFor(() => expect(result.current.isBlocked("b")).toBe(true));
    let resolve;
    api.delete.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    let operation;
    act(() => { operation = result.current.setBlocked(contact, false); });
    expect(result.current.busy).toBe(true);
    await act(async () => { expect(await result.current.setBlocked(contact, false)).toBe(false); });
    expect(api.delete).toHaveBeenCalledOnce();
    api.get.mockResolvedValue({ data: [] });
    await act(async () => { resolve({ data: { userId: "b", isBlockedByMe: false } }); await operation; });
    expect(result.current.isBlocked("b")).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it("preserves previous state and exposes a retryable error when block fails", async () => {
    const { result } = renderHook(() => useUserBlocks("a", "b", 0, "connected"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.post.mockRejectedValueOnce({ response: { data: { message: "Try later" } } });
    await act(async () => { expect(await result.current.setBlocked(contact, true)).toBe(false); });
    expect(result.current.isBlocked("b")).toBe(false);
    expect(result.current.error).toBe("Try later");
  });

  it("ignores stale chat responses and resynchronizes own state after a realtime event", async () => {
    let staleResponse;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { staleResponse = resolve; }));
    const { result, rerender } = renderHook(({ target, revision }) => useUserBlocks("a", target, revision, "connected"),
      { initialProps: { target: "b", revision: 0 } });
    api.get.mockResolvedValue({ data: [{ userId: "c" }] });
    rerender({ target: "c", revision: 0 });
    await waitFor(() => expect(result.current.isBlocked("c")).toBe(true));
    await act(async () => { staleResponse({ data: [{ userId: "b" }] }); });
    expect(result.current.isBlocked("c")).toBe(true);
    expect(result.current.isBlocked("b")).toBe(false);
    api.get.mockResolvedValue({ data: [] });
    rerender({ target: "c", revision: 1 });
    await waitFor(() => expect(result.current.isBlocked("c")).toBe(false));
  });
});
