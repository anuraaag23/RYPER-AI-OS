import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Where the encryption key actually lives. `InMemoryKeyStore` is for this
 * package's own tests; a real deployment backs this with the platform's
 * secure storage (Keychain/DPAPI/Secret Service/Android Keystore), per
 * `docs/SECRETS.md`'s policy — this package never reads or writes a raw
 * key to disk itself.
 */
export interface SecureKeyStore {
  getOrCreateKey(): Promise<Buffer>;
}

export class InMemoryKeyStore implements SecureKeyStore {
  private key: Buffer | undefined;

  async getOrCreateKey(): Promise<Buffer> {
    if (!this.key) {
      this.key = randomBytes(32); // AES-256
    }
    return this.key;
  }
}

export interface EncryptedPayload {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly authTag: string; // base64
}

/**
 * AES-256-GCM: authenticated encryption, so tampering with ciphertext is
 * detected on decrypt rather than silently producing garbage plaintext.
 * Used for any field a caller wants encrypted at rest beyond whatever the
 * underlying `MemoryPersistence`/database layer already provides —
 * defense in depth for the most sensitive memory content.
 */
export class MemoryEncryption {
  constructor(private readonly keyStore: SecureKeyStore) {}

  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    const key = await this.keyStore.getOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  async decrypt(payload: EncryptedPayload): Promise<string> {
    const key = await this.keyStore.getOrCreateKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}

export function createMemoryEncryption(
  keyStore: SecureKeyStore = new InMemoryKeyStore(),
): MemoryEncryption {
  return new MemoryEncryption(keyStore);
}
