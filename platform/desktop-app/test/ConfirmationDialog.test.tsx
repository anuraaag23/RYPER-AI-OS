// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "../src/components/ConfirmationDialog.js";
import type { ConfirmationRequestPayload } from "../electron/ipc-contract.js";

afterEach(cleanup);

type Handler = (request: ConfirmationRequestPayload) => void;

function installFakeRyper(): { respondToConfirmation: ReturnType<typeof vi.fn>; fire: Handler } {
  let handler: Handler = () => undefined;
  const fake = {
    respondToConfirmation: vi.fn(async () => undefined),
    onConfirmationRequested: vi.fn((h: Handler) => {
      handler = h;
      return () => undefined;
    }),
  };
  Object.defineProperty(window, "ryper", { value: fake, writable: true, configurable: true });
  return { respondToConfirmation: fake.respondToConfirmation, fire: (r) => handler(r) };
}

const REQUEST: ConfirmationRequestPayload = {
  id: "req-1",
  title: "Shut down?",
  message: "This will shut down your computer.",
};

describe("ConfirmationDialog", () => {
  let fire: Handler;
  let respondToConfirmation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ fire, respondToConfirmation } = installFakeRyper());
  });

  it("renders nothing until a real confirmation request arrives", () => {
    render(<ConfirmationDialog />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders the request's real title and message when one arrives", () => {
    render(<ConfirmationDialog />);
    act(() => fire(REQUEST));
    expect(screen.getByText("Shut down?")).toBeTruthy();
    expect(screen.getByText("This will shut down your computer.")).toBeTruthy();
  });

  it("moves focus to Deny — the safe default — the moment the dialog appears", async () => {
    render(<ConfirmationDialog />);
    act(() => fire(REQUEST));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Deny")));
  });

  it("Escape denies, matching the Deny button's safe-default behavior", () => {
    render(<ConfirmationDialog />);
    act(() => fire(REQUEST));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(respondToConfirmation).toHaveBeenCalledWith("req-1", false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("traps Tab between Deny and Approve — focus never silently leaves to background UI", () => {
    render(<ConfirmationDialog />);
    act(() => fire(REQUEST));
    const deny = screen.getByText("Deny");
    const approve = screen.getByText("Approve");
    const dialog = screen.getByRole("alertdialog");

    approve.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(deny);

    deny.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(approve);
  });

  it("Approve sends a real approved response and closes the dialog", () => {
    render(<ConfirmationDialog />);
    act(() => fire(REQUEST));
    fireEvent.click(screen.getByText("Approve"));
    expect(respondToConfirmation).toHaveBeenCalledWith("req-1", true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders custom 'Allow once' and 'Deny' labels for capability consent requests", () => {
    render(<ConfirmationDialog />);
    act(() =>
      fire({
        id: "perm-1",
        title: "Permission needed",
        message: "RYPER wants to open an application on your computer.",
        approveLabel: "Allow once",
        denyLabel: "Deny",
      }),
    );
    expect(screen.getByText("Permission needed")).toBeTruthy();
    expect(screen.getByText("RYPER wants to open an application on your computer.")).toBeTruthy();
    const allowOnce = screen.getByText("Allow once");
    const deny = screen.getByText("Deny");
    expect(allowOnce).toBeTruthy();
    expect(deny).toBeTruthy();

    fireEvent.click(allowOnce);
    expect(respondToConfirmation).toHaveBeenCalledWith("perm-1", true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
