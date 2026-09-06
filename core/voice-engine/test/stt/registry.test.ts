import { describe, expect, it } from "vitest";
import { SpeechRecognitionRegistry } from "../../src/stt/registry.js";
import type { SpeechRecognitionProvider } from "../../src/stt/types.js";

function fakeProvider(id: string, supportsOffline: boolean): SpeechRecognitionProvider {
  return { id, supportsOffline, streamRecognize: async function* () {} };
}

describe("SpeechRecognitionRegistry", () => {
  it("offline_only never selects a cloud provider even when online", () => {
    const registry = new SpeechRecognitionRegistry();
    registry.register(fakeProvider("local", true));
    registry.register(fakeProvider("cloud", false));
    expect(registry.select("offline_only", true).id).toBe("local");
  });

  it("cloud_only throws when offline", () => {
    const registry = new SpeechRecognitionRegistry();
    registry.register(fakeProvider("cloud", false));
    expect(() => registry.select("cloud_only", false)).toThrow();
  });

  it("prefer_offline falls back to cloud only when no offline provider exists", () => {
    const registry = new SpeechRecognitionRegistry();
    registry.register(fakeProvider("cloud", false));
    expect(registry.select("prefer_offline", true).id).toBe("cloud");
  });

  it("prefer_cloud uses cloud when online, falls back to offline when not", () => {
    const registry = new SpeechRecognitionRegistry();
    registry.register(fakeProvider("local", true));
    registry.register(fakeProvider("cloud", false));
    expect(registry.select("prefer_cloud", true).id).toBe("cloud");
    expect(registry.select("prefer_cloud", false).id).toBe("local");
  });

  it("throws a clear error when nothing is eligible", () => {
    const registry = new SpeechRecognitionRegistry();
    expect(() => registry.select("offline_only", true)).toThrow(/no eligible STT provider/);
  });
});
