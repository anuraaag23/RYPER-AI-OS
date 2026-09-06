import { describe, expect, it } from "vitest";
import { sha256Hex, verifyChecksum } from "../src/checksum.js";

describe("checksum", () => {
  it("computes a deterministic 64-char hex digest", () => {
    const bytes = new TextEncoder().encode("hello world");
    const digest = sha256Hex(bytes);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(bytes)).toBe(digest);
  });

  it("produces different digests for different inputs", () => {
    const a = sha256Hex(new TextEncoder().encode("hello"));
    const b = sha256Hex(new TextEncoder().encode("world"));
    expect(a).not.toBe(b);
  });

  it("verifyChecksum is case-insensitive and detects mismatches", () => {
    const bytes = new TextEncoder().encode("hello world");
    const digest = sha256Hex(bytes);
    expect(verifyChecksum(bytes, digest.toUpperCase())).toBe(true);
    expect(verifyChecksum(bytes, "0".repeat(64))).toBe(false);
  });
});
