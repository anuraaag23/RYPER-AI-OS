// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown.js";

describe("renderMarkdown", () => {
  it("renders GFM tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("syntax-highlights fenced code blocks", () => {
    const html = renderMarkdown("```typescript\nconst x: number = 1;\n```");
    expect(html).toContain('class="hljs language-typescript"');
    expect(html).toContain("<span");
  });

  it("renders inline code and bold/italic", () => {
    const html = renderMarkdown("**bold** and `code` and _italic_");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<em>italic</em>");
  });

  it("strips a script tag injection attempt (DOMPurify sanitization)", () => {
    const html = renderMarkdown('<script>alert("xss")</script>Hello');
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hello");
  });

  it("strips a disallowed event-handler attribute", () => {
    const html = renderMarkdown('<img src="x.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });
});
