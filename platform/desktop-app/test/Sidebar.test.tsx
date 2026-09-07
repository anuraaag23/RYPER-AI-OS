// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/components/Sidebar.js";

afterEach(cleanup);

describe("Sidebar (P1-3 Clean up navigation)", () => {
  const defaultProps = {
    conversations: [
      { id: "c1", title: "First chat", updatedAt: new Date().toISOString() },
    ],
    activeId: "c1",
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  it("renders New conversation and search input", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("+ New conversation")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search conversations…")).toBeTruthy();
  });

  it("does NOT render disabled 'Coming soon' navigation buttons (P1-3)", () => {
    render(<Sidebar {...defaultProps} />);
    const forbidden = ["Memory", "Plugins", "Models", "Automation", "Documents", "Diagnostics"];
    for (const label of forbidden) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText("More")).toBeNull();
  });

  it("cleanly preserves and renders the functional Settings button", () => {
    render(<Sidebar {...defaultProps} />);
    const settingsBtn = screen.getByRole("button", { name: "Settings" });
    expect(settingsBtn).toBeTruthy();
    fireEvent.click(settingsBtn);
    expect(defaultProps.onOpenSettings).toHaveBeenCalledOnce();
  });
});
