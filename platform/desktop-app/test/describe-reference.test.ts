import { describe, expect, it } from "vitest";
import { describeReference } from "../src/components/ChatPanel.js";

describe("describeReference", () => {
  it("prefers name over path/url when available", () => {
    expect(describeReference({ type: "file", path: "C:/a.txt", name: "Report" })).toBe(
      "Referring to this file: Report",
    );
  });

  it("falls back to path when there's no name", () => {
    expect(describeReference({ type: "file", path: "C:/notes.txt" })).toBe(
      "Referring to this file: C:/notes.txt",
    );
  });

  it("falls back to url for a url reference with no name", () => {
    expect(describeReference({ type: "url", url: "https://example.com" })).toBe(
      "Referring to this page: https://example.com",
    );
  });

  it("labels folder, application, and media types distinctly", () => {
    expect(describeReference({ type: "folder", path: "C:/Downloads" })).toBe(
      "Referring to this folder: C:/Downloads",
    );
    expect(describeReference({ type: "application", name: "Notepad" })).toBe(
      "Referring to this app: Notepad",
    );
    expect(describeReference({ type: "media", name: "song.mp3" })).toBe(
      "Referring to this media: song.mp3",
    );
  });

  it("never fabricates a name — falls back to a plain placeholder when nothing is available", () => {
    expect(describeReference({ type: "file" })).toBe("Referring to this file: something");
  });
});
