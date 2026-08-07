import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 digest, the format model catalogs publish checksums in. */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function verifyChecksum(data: Uint8Array, expectedSha256: string): boolean {
  return sha256Hex(data).toLowerCase() === expectedSha256.toLowerCase();
}
