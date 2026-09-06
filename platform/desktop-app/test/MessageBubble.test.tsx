// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "../src/components/MessageBubble.js";
import type { StoredMessage } from "../electron/ipc-contract.js";

afterEach(cleanup);

function buildMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content: "**Hello** world",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("MessageBubble", () => {
  it("renders markdown content as real HTML, not raw text", () => {
    render(
      <MessageBubble
        message={buildMessage()}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(document.querySelector("strong")?.textContent).toBe("Hello");
  });

  it("shows a Regenerate action only for assistant messages", () => {
    const { rerender } = render(
      <MessageBubble
        message={buildMessage({ role: "assistant" })}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByText("Regenerate")).toBeTruthy();

    rerender(
      <MessageBubble
        message={buildMessage({ role: "user" })}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.queryByText("Regenerate")).toBeNull();
  });

  it("calls onDelete with the message id", () => {
    const onDelete = vi.fn();
    render(
      <MessageBubble
        message={buildMessage({ id: "m42" })}
        onDelete={onDelete}
        onRegenerate={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete message"));
    expect(onDelete).toHaveBeenCalledWith("m42");
  });

  it("calls onRegenerate with the message id", () => {
    const onRegenerate = vi.fn();
    render(
      <MessageBubble
        message={buildMessage({ id: "m7" })}
        onDelete={() => undefined}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByLabelText("Regenerate response"));
    expect(onRegenerate).toHaveBeenCalledWith("m7");
  });

  it("shows the routing target badge when present", () => {
    render(
      <MessageBubble
        message={buildMessage({ routingTarget: "local" })}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
      />,
    );
    expect(screen.getByText("local")).toBeTruthy();
  });
});
