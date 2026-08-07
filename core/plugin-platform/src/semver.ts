export class InvalidVersionError extends Error {}

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version: string): ParsedVersion {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) {
    throw new InvalidVersionError(`"${version}" is not a valid MAJOR.MINOR.PATCH version`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** -1 if a<b, 0 if equal, 1 if a>b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

/** Inclusive: `min <= version <= max`. */
export function isWithinRange(version: string, min: string, max: string): boolean {
  return compareVersions(version, min) >= 0 && compareVersions(version, max) <= 0;
}
