import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MessageAttachments from "../src/features/Messages/components/MessageAttachments";
import { readAttachment } from "../src/features/Messages/services/attachmentService";

vi.mock("../src/features/Messages/services/attachmentService", () => ({ readAttachment: vi.fn() }));
const attachment = { id: "photo-1", fileName: "photo.png", contentType: "image/png", fileSize: 1024 };
beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("does not request missing files and explains how to recover", () => {
  render(<MessageAttachments attachments={[{ ...attachment, isAvailable: false }]} />);
  expect(readAttachment).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("Please send it again");
  expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
});

it("loads available images normally and releases the preview on unmount", async () => {
  readAttachment.mockResolvedValue(new Blob(["image"]));
  const view = render(<MessageAttachments attachments={[{ ...attachment, isAvailable: true }]} />);
  await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("blob:preview"));
  expect(screen.getByRole("button", { name: /Download/ }).disabled).toBe(false);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("stops downloads when a file disappears after history loads", async () => {
  readAttachment.mockRejectedValue({ response: { status: 404 } });
  render(<MessageAttachments attachments={[attachment]} />);
  await screen.findByRole("status");
  expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  expect(readAttachment).toHaveBeenCalledTimes(1);
});

it("keeps download retry available for a temporary network failure", async () => {
  readAttachment.mockRejectedValueOnce(new Error("offline"));
  render(<MessageAttachments attachments={[{ ...attachment, contentType: "application/pdf" }]} />);
  fireEvent.click(screen.getByRole("button", { name: /Download/ }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: /Download/ }).disabled).toBe(false);
  expect(screen.queryByRole("status")).toBeNull();
});
