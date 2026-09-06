// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackSession } from "../src/audio/playback-client.js";

class FakeGainNode {
  gain = { value: 1 };
  connect = vi.fn();
}

class FakeAudioBufferSourceNode {
  buffer: unknown;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn(() => {
    // Simulates real playback completing — a real `AudioBufferSourceNode`
    // fires `onended` once the buffer finishes; nothing here should be
    // mistaken for actual audio output.
    queueMicrotask(() => this.onended?.());
  });
  stop = vi.fn(() => this.onended?.());
}

class FakeMediaStreamAudioDestinationNode {
  stream = { id: "fake-stream" };
}

class FakeAudioContext {
  currentTime = 0;
  destination = { kind: "default-destination" };
  close = vi.fn(async () => undefined);
  decodeAudioData = vi.fn(async () => ({ duration: 0.01 }) as AudioBuffer);
  createBufferSource = vi.fn(
    () => new FakeAudioBufferSourceNode() as unknown as AudioBufferSourceNode,
  );
  createGain = vi.fn(() => new FakeGainNode() as unknown as GainNode);
  createMediaStreamDestination = vi.fn(
    () => new FakeMediaStreamAudioDestinationNode() as unknown as MediaStreamAudioDestinationNode,
  );
}

class FakeAudioElement {
  srcObject: unknown;
  muted = false;
  setSinkId = vi.fn(async () => undefined);
  play = vi.fn(async () => undefined);
  pause = vi.fn();
}

function waitForComplete(): {
  promise: Promise<[boolean, string | undefined]>;
  onComplete: (ok: boolean, error?: string) => void;
} {
  let resolve!: (v: [boolean, string | undefined]) => void;
  const promise = new Promise<[boolean, string | undefined]>((res) => {
    resolve = res;
  });
  return { promise, onComplete: (ok, error) => resolve([ok, error]) };
}

const chunk = new Uint8Array([1, 2, 3]);

describe("createPlaybackSession — real output-device sink routing", () => {
  let lastAudioEl: FakeAudioElement | undefined;

  beforeEach(() => {
    lastAudioEl = undefined;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "Audio",
      vi.fn(() => {
        lastAudioEl = new FakeAudioElement();
        return lastAudioEl;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays through the default destination and never touches Audio/setSinkId when no device is requested", async () => {
    const { promise, onComplete } = waitForComplete();
    const session = createPlaybackSession(onComplete);
    session.pushChunk(chunk, "audio/wav");
    session.end();

    const [ok] = await promise;
    expect(ok).toBe(true);
    expect(lastAudioEl).toBeUndefined();
  });

  it("routes to the requested output device via a real setSinkId call when supported", async () => {
    const onSinkRoutingFailed = vi.fn();
    const { promise, onComplete } = waitForComplete();
    const session = createPlaybackSession(onComplete, "speaker-42", onSinkRoutingFailed);
    session.pushChunk(chunk, "audio/wav");
    session.end();

    const [ok] = await promise;
    expect(ok).toBe(true);
    expect(lastAudioEl?.setSinkId).toHaveBeenCalledWith("speaker-42");
    expect(lastAudioEl?.play).toHaveBeenCalledOnce();
    expect(onSinkRoutingFailed).not.toHaveBeenCalled();
  });

  it("falls back to the default device and reports why when setSinkId rejects — never silently pretends routing worked", async () => {
    vi.stubGlobal(
      "Audio",
      vi.fn(() => {
        lastAudioEl = new FakeAudioElement();
        lastAudioEl.setSinkId = vi.fn(async () => {
          throw new Error("NotFoundError: requested device not found");
        });
        return lastAudioEl;
      }),
    );
    const onSinkRoutingFailed = vi.fn();
    const { promise, onComplete } = waitForComplete();
    const session = createPlaybackSession(onComplete, "missing-device", onSinkRoutingFailed);
    session.pushChunk(chunk, "audio/wav");
    session.end();

    const [ok] = await promise;
    expect(ok).toBe(true); // playback itself still succeeds — just on the default device
    expect(onSinkRoutingFailed).toHaveBeenCalledWith(
      expect.stringContaining("requested device not found"),
    );
  });

  it("falls back honestly when the runtime has no setSinkId support at all", async () => {
    vi.stubGlobal(
      "Audio",
      vi.fn(() => {
        lastAudioEl = new FakeAudioElement();
        // @ts-expect-error deliberately simulating an unsupported runtime
        lastAudioEl.setSinkId = undefined;
        return lastAudioEl;
      }),
    );
    const onSinkRoutingFailed = vi.fn();
    const { promise, onComplete } = waitForComplete();
    const session = createPlaybackSession(onComplete, "speaker-1", onSinkRoutingFailed);
    session.pushChunk(chunk, "audio/wav");
    session.end();

    await promise;
    expect(onSinkRoutingFailed).toHaveBeenCalledWith(expect.stringContaining("not supported"));
  });

  it("treats deviceId of 'default' the same as no device — no routing attempted", async () => {
    const onSinkRoutingFailed = vi.fn();
    const { promise, onComplete } = waitForComplete();
    const session = createPlaybackSession(onComplete, "default", onSinkRoutingFailed);
    session.pushChunk(chunk, "audio/wav");
    session.end();

    await promise;
    expect(lastAudioEl).toBeUndefined();
    expect(onSinkRoutingFailed).not.toHaveBeenCalled();
  });

  it("stop() pauses the routed sink element, not just the audio graph", async () => {
    const { onComplete } = waitForComplete();
    const session = createPlaybackSession(onComplete, "speaker-1");
    session.pushChunk(chunk, "audio/wav");
    // Let routing settle before stopping, matching a real barge-in mid-utterance.
    await Promise.resolve();
    await Promise.resolve();
    session.stop();

    expect(lastAudioEl?.pause).toHaveBeenCalled();
  });

  it("reports failure honestly when this runtime has no AudioContext at all", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { promise, onComplete } = waitForComplete();
    createPlaybackSession(onComplete);
    const [ok, error] = await promise;
    expect(ok).toBe(false);
    expect(error).toContain("AudioContext");
  });
});
