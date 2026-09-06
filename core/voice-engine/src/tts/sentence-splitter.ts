/**
 * Splits text into sentence-sized pieces for sentence-level TTS chunking
 * (Phase 13.7): each piece is synthesized and can start playing before
 * later pieces finish synthesizing, instead of waiting for an entire
 * multi-sentence AI response to be spoken as one blocking unit. This is
 * genuinely NOT token-level streaming — the full response text is in
 * hand before this runs — and is never described as such; see
 * `docs/PROJECT_STATE.md`'s Phase 13.7 section.
 *
 * Deliberately simple, deterministic, and dependency-free (no NLP
 * library): splits on `.`/`!`/`?` followed by whitespace (or end of
 * string), while refusing to split on a small set of common abbreviations
 * (Mr., Dr., etc., e.g., i.e., U.S., ...) immediately before the period so
 * "Dr. Smith is here." doesn't become two fragments. This is a heuristic,
 * not a full sentence boundary detector — known false splits (e.g. inside
 * a decimal number spoken as prose, or an unlisted abbreviation) are
 * possible and are an accepted, documented limitation, not silently
 * hidden: a wrong split just means an extra TTS call, not incorrect
 * speech.
 */

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "vs",
  "etc",
  "eg",
  "ie",
  "approx",
  "no",
  "st",
  "u.s",
  "u.k",
]);

function endsWithAbbreviation(textBeforePeriod: string): boolean {
  const match = /([A-Za-z]+)$/.exec(textBeforePeriod);
  if (!match) return false;
  return ABBREVIATIONS.has(match[1]!.toLowerCase());
}

/**
 * Splits `text` into sentence-like chunks. Consecutive whitespace within a
 * sentence is preserved as-is (not normalized) since that's what gets
 * spoken; only leading/trailing whitespace per chunk is trimmed, and empty
 * results are dropped.
 */
export function splitIntoSentences(text: string): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Only a real sentence boundary if followed by whitespace or end-of-string.
    const next = trimmed[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;

    if (ch === "." && endsWithAbbreviation(trimmed.slice(start, i))) continue;

    const piece = trimmed.slice(start, i + 1).trim();
    if (piece.length > 0) sentences.push(piece);
    start = i + 1;
  }

  const remainder = trimmed.slice(start).trim();
  if (remainder.length > 0) sentences.push(remainder);

  return sentences.length > 0 ? sentences : [trimmed];
}

/**
 * Merges very short sentences with a neighbor so a synthesis call is
 * never made for something like a lone "Yes." right after a long
 * sentence — real TTS binaries have real per-invocation startup cost, so
 * a minimum-length floor is a genuine latency optimization, not
 * cosmetic. `minChars` is a soft floor: the last piece is never dropped.
 */
export function chunkForSpeech(text: string, minChars = 12): readonly string[] {
  const sentences = splitIntoSentences(text);
  if (sentences.length <= 1) return sentences;

  const merged: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    buffer = buffer.length > 0 ? `${buffer} ${sentence}` : sentence;
    if (buffer.length >= minChars) {
      merged.push(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) {
    if (merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${buffer}`;
    } else {
      merged.push(buffer);
    }
  }
  return merged;
}
