import type { WellKnownFolder } from "./types.js";
import type { WindowsSystemApi } from "./windows-system-api.js";

/**
 * Safe Windows path/target handling for the universal-open capability
 * (see `docs/adr/0030`, PART 2). Nothing here ever builds a shell
 * command string from user input — every real OS call this resolves
 * *to* still goes through `WindowsSystemApi`'s existing, already-safe
 * methods (`startProcess`'s `execFile`-style argument array on the
 * PowerShell side, `psQuote`'d literals elsewhere). This module's only
 * job is turning what a person actually said/typed into a clean,
 * validated string those methods can take as a single argument — never
 * into a fragment of a larger command line.
 */

/** Strips a single layer of matching leading/trailing quotes ("C:\...", 'C:\...') a person might type or a voice transcript might include. Does not touch quotes that aren't a matching wrapping pair. */
export function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

const KNOWN_FOLDER_ALIASES: Readonly<Record<string, WellKnownFolder>> = {
  downloads: "downloads",
  download: "downloads",
  desktop: "desktop",
  documents: "documents",
  "my documents": "documents",
  pictures: "pictures",
  photos: "pictures",
  videos: "videos",
  music: "music",
};

export class UnresolvedEnvironmentVariableError extends Error {
  constructor(readonly variableName: string) {
    super(
      `"%${variableName}%" isn't one this reference environment can resolve without real ` +
        "process/OS environment access (see PathResolver's honest limitation note); " +
        'try a known folder name like "Downloads" instead, or a literal path.',
    );
  }
}

/**
 * Resolves what a person actually said/typed — a quoted path, a path
 * with `%ENV_VAR%` markers, a known-folder name like "my Downloads
 * folder", or a literal absolute path — into a clean, real, validated
 * absolute path a `WindowsSystemApi` call can safely take as a single
 * argument.
 *
 * **Honest limitation**: real Windows exposes hundreds of environment
 * variables via `process.env`, but this package's `WindowsSystemApi`
 * abstraction (deliberately, for portability/testability — see
 * `README.md`) has no general "read an arbitrary env var" operation.
 * Only `%USERPROFILE%` is resolved here, derived from the real
 * `getWellKnownFolderPath("desktop")` result's parent directory (every
 * real Windows profile has `Desktop` directly under the profile root).
 * Any other `%VARIABLE%` is reported clearly via
 * `UnresolvedEnvironmentVariableError` rather than silently left
 * un-expanded or guessed at.
 */
export class PathResolver {
  constructor(private readonly systemApi: WindowsSystemApi) {}

  /** Resolves free text naming a known folder ("my downloads folder", "Desktop") to its real path, or `undefined` if the text doesn't name one this package recognizes. */
  async resolveKnownFolder(spokenText: string): Promise<string | undefined> {
    const cleaned = spokenText
      .trim()
      .toLowerCase()
      .replace(/[,.?!;:"]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const normalized = cleaned
      .replace(/^(my|the|open|go to)\s+/, "")
      .replace(/\s+folder$/, "")
      .trim();
    const folder = KNOWN_FOLDER_ALIASES[normalized];
    if (!folder) return undefined;
    return this.systemApi.getWellKnownFolderPath(folder);
  }

  /**
   * Full resolution pipeline for a path a person supplied directly
   * (not free-text like "my downloads folder" — use
   * `resolveKnownFolder` first and fall back to this): strips wrapping
   * quotes, then expands any `%VARIABLE%` markers.
   */
  async resolvePath(rawInput: string): Promise<string> {
    const unquoted = stripWrappingQuotes(rawInput);
    return this.expandEnvironmentVariables(unquoted);
  }

  private async expandEnvironmentVariables(input: string): Promise<string> {
    const envVarPattern = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
    const matches = [...input.matchAll(envVarPattern)];
    if (matches.length === 0) return input;

    let result = input;
    for (const match of matches) {
      const variableName = match[1] ?? "";
      if (variableName.toUpperCase() !== "USERPROFILE") {
        throw new UnresolvedEnvironmentVariableError(variableName);
      }
      const userProfile = await this.resolveUserProfileRoot();
      result = result.replace(`%${variableName}%`, userProfile);
    }
    return result;
  }

  private async resolveUserProfileRoot(): Promise<string> {
    const desktop = await this.systemApi.getWellKnownFolderPath("desktop");
    const lastSeparator = desktop.lastIndexOf("\\");
    if (lastSeparator === -1) return desktop;
    return desktop.slice(0, lastSeparator);
  }
}

export function createPathResolver(systemApi: WindowsSystemApi): PathResolver {
  return new PathResolver(systemApi);
}

/**
 * Real, deterministic classification for the `smart_open` tool (PART
 * 1D): a plain string is genuinely one of these three kinds of target,
 * never guessed at by an LLM — this is what makes `smart_open`'s
 * result deterministic rather than a coin flip the model makes.
 */
export type OpenTargetKind = "url" | "file" | "folder";

const URL_PATTERN = /^https?:\/\//i;
/** Bare domain-looking text a person might say without "http(s)://" — "github.com", "youtube.com". Deliberately conservative (requires a real-looking TLD) to avoid misclassifying an ordinary file/folder name that happens to contain a dot. */
const BARE_DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

export function looksLikeUrl(target: string): boolean {
  const trimmed = target.trim();
  return URL_PATTERN.test(trimmed) || BARE_DOMAIN_PATTERN.test(trimmed);
}

/** Normalizes a URL-ish string (adds `https://` to a bare domain) — never silently changes what host/path the person named, only fills in a missing scheme. */
export function normalizeUrl(target: string): string {
  const trimmed = target.trim();
  if (URL_PATTERN.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
