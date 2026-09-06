import { describe, expect, it } from "vitest";
import { MemoryEncryption, InMemoryKeyStore } from "../src/encryption.js";

describe("MemoryEncryption", () => {
  it("round-trips plaintext through encrypt/decrypt", async () => {
    const encryption = new MemoryEncryption(new InMemoryKeyStore());
    const payload = await encryption.encrypt("sensitive memory content");
    expect(await encryption.decrypt(payload)).toBe("sensitive memory content");
  });

  it("produces a different ciphertext each time (random IV) for the same plaintext", async () => {
    const encryption = new MemoryEncryption(new InMemoryKeyStore());
    const a = await encryption.encrypt("same text");
    const b = await encryption.encrypt("same text");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("detects tampering via the auth tag and refuses to decrypt", async () => {
    const encryption = new MemoryEncryption(new InMemoryKeyStore());
    const payload = await encryption.encrypt("original");
    const tampered = { ...payload, ciphertext: Buffer.from("tampered-bytes!!").toString("base64") };
    await expect(encryption.decrypt(tampered)).rejects.toThrow();
  });

  it("fails to decrypt with a different key", async () => {
    const encryption = new MemoryEncryption(new InMemoryKeyStore());
    const payload = await encryption.encrypt("original");
    const otherEncryption = new MemoryEncryption(new InMemoryKeyStore());
    await expect(otherEncryption.decrypt(payload)).rejects.toThrow();
  });
});
