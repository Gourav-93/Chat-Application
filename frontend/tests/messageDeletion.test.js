import { describe, expect, it } from "vitest";
import { mergeMessageContent } from "../src/features/Messages/services/MessageHistoryService";
import { applyMessageDeleted } from "../src/features/Messages/hooks/useChatSession";

const original = {
  id: 7, text: "secret", location: { latitude: 12, longitude: 34 },
  attachments: [{ id: "file-id", fileName: "private.jpg" }], editedAt: "2026-11-26T12:00:00Z",
  isDeletedForEveryone: false,
};
const tombstone = {
  id: 7, text: "This message was deleted", location: null, attachments: [],
  editedAt: null, isDeletedForEveryone: true,
};

describe("deleted-message event ordering", () => {
  it("does not restore original content when a delayed receive arrives", () => {
    const result = mergeMessageContent(tombstone, original);
    expect(result).toMatchObject(tombstone);
    expect(JSON.stringify(result)).not.toContain("private.jpg");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("scrubs earlier content when a deletion arrives", () => {
    expect(mergeMessageContent(original, tombstone)).toMatchObject(tombstone);
  });

  it("does not let a delayed edit restore deleted text", () => {
    const edit = { ...original, text: "edited secret", editedAt: "2026-11-26T12:05:00Z" };
    expect(mergeMessageContent(tombstone, edit)).toMatchObject(tombstone);
  });

  it("keeps a per-user deletion hidden after an everyone event", () => {
    const state = { messages: new Map([[7, original]]), deleted: new Map(), revision: 0 };
    const mine = applyMessageDeleted(state, { messageId: 7, conversationId: 1, everyone: false });
    const both = applyMessageDeleted(mine, { messageId: 7, conversationId: 1, everyone: true });
    expect(both.deleted.get(7)).toBe("me");
    expect(both.messages.has(7)).toBe(false);
  });

  it("scrubs cached content when the other participant deletes for everyone", () => {
    const state = { messages: new Map([[7, original]]), deleted: new Map(), revision: 0 };
    const result = applyMessageDeleted(state, { messageId: 7, conversationId: 1, everyone: true });
    expect(result.messages.get(7)).toMatchObject(tombstone);
  });
});
