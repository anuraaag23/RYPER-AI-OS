import { describe, expect, it } from "vitest";
import { MemoryCategorizer } from "../src/categorization.js";

describe("MemoryCategorizer", () => {
  it("classifies preference-sounding content", () => {
    const categorizer = new MemoryCategorizer();
    expect(categorizer.categorize("I prefer tea over coffee")).toBe("preference");
  });

  it("classifies contact-sounding content", () => {
    const categorizer = new MemoryCategorizer();
    expect(categorizer.categorize("Her email is jane@example.com")).toBe("contact");
  });

  it("classifies task-sounding content", () => {
    const categorizer = new MemoryCategorizer();
    expect(categorizer.categorize("remind me to call the bank")).toBe("task");
  });

  it("falls back to long_term when nothing matches", () => {
    const categorizer = new MemoryCategorizer();
    expect(categorizer.categorize("the sky is blue")).toBe("long_term");
  });

  it("honors a custom fallback type", () => {
    const categorizer = new MemoryCategorizer(undefined, "knowledge");
    expect(categorizer.categorize("the sky is blue")).toBe("knowledge");
  });

  it("honors an injected custom classifier over the default rules", () => {
    const categorizer = new MemoryCategorizer(() => "automation");
    expect(categorizer.categorize("I prefer tea")).toBe("automation");
  });
});
