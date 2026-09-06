import { describe, expect, it } from "vitest";
import { InMemoryFileSystem, ModelRegistry } from "@ryper/local-runtime";
import {
  defaultVoiceModelPaths,
  detectVoiceModelStatus,
  registerVoiceModels,
  type VoiceModelPaths,
} from "../electron/voice-model-provisioning.js";

const paths: VoiceModelPaths = {
  whisperBinaryPath: "/opt/whisper/main",
  whisperModelPath: "/opt/whisper/model.bin",
  piperBinaryPath: "/opt/piper/piper",
  piperModelPath: "/opt/piper/voice.onnx",
};

describe("defaultVoiceModelPaths", () => {
  it("resolves real, app-scoped default paths (never a system-wide or auto-downloaded location)", () => {
    const result = defaultVoiceModelPaths("/home/user/.config/ryper");
    expect(result.whisperBinaryPath.replace(/\\/g, "/")).toContain("/home/user/.config/ryper");
    expect(result.piperBinaryPath.replace(/\\/g, "/")).toContain("/home/user/.config/ryper");
  });
});

describe("detectVoiceModelStatus", () => {
  it("reports binary-missing, honestly, when nothing is installed", async () => {
    const fs = new InMemoryFileSystem();
    const status = await detectVoiceModelStatus(fs, paths);
    expect(status.whisper.status).toBe("binary-missing");
    expect(status.piper.status).toBe("binary-missing");
  });

  it("reports model-missing when the binary exists but the model file doesn't", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(paths.whisperBinaryPath, new Uint8Array([1]));
    const status = await detectVoiceModelStatus(fs, paths);
    expect(status.whisper.status).toBe("model-missing");
    expect(status.whisper.detail).toContain(paths.whisperModelPath);
  });

  it("reports installed when both the binary and model exist", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(paths.whisperBinaryPath, new Uint8Array([1]));
    await fs.writeFile(paths.whisperModelPath, new Uint8Array(1000));
    const status = await detectVoiceModelStatus(fs, paths);
    expect(status.whisper.status).toBe("installed");
  });
});

describe("registerVoiceModels", () => {
  it("Phase 13.7 bugfix: always registers a real, always-installed reference model — fixes the pre-existing MissingModelError gap where nothing was ever registered", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await registerVoiceModels(registry, fs, paths);

    const asrModels = registry.query({ type: "asr", installedOnly: true });
    const ttsModels = registry.query({ type: "tts", installedOnly: true });
    expect(asrModels.length).toBeGreaterThan(0);
    expect(ttsModels.length).toBeGreaterThan(0);
  });

  it("registers only the reference provider when no real binaries are present", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    const { providers, diagnostics } = await registerVoiceModels(registry, fs, paths);

    expect(diagnostics.whisper.status).toBe("binary-missing");
    expect(diagnostics.piper.status).toBe("binary-missing");
    expect(providers).toHaveLength(1);
    expect(providers[0]?.kind).toBe("onnx"); // the reference provider
  });

  it("registers and prioritizes the real Whisper provider when a real binary+model are detected", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await fs.writeFile(paths.whisperBinaryPath, new Uint8Array([1]));
    await fs.writeFile(paths.whisperModelPath, new Uint8Array(1000));

    const { providers } = await registerVoiceModels(registry, fs, paths);

    const kinds = providers.map((p) => p.kind);
    expect(kinds).toContain("whisper-cpp");
    // The real provider is ordered ahead of the reference fallback.
    expect(kinds.indexOf("whisper-cpp")).toBeLessThan(kinds.indexOf("onnx"));
  });

  it("registers and prioritizes the real Piper provider when a real binary+model are detected", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await fs.writeFile(paths.piperBinaryPath, new Uint8Array([1]));
    await fs.writeFile(paths.piperModelPath, new Uint8Array(1000));

    const { providers } = await registerVoiceModels(registry, fs, paths);

    const kinds = providers.map((p) => p.kind);
    expect(kinds).toContain("piper");
    expect(kinds.indexOf("piper")).toBeLessThan(kinds.indexOf("onnx"));
  });

  it("the reference model's approxDiskBytes is large enough that the default (smallest-first) selection policy always prefers a real installed model", async () => {
    const registry = new ModelRegistry();
    const fs = new InMemoryFileSystem();
    await fs.writeFile(paths.whisperBinaryPath, new Uint8Array([1]));
    await fs.writeFile(paths.whisperModelPath, new Uint8Array(1000));
    await registerVoiceModels(registry, fs, paths);

    const asrCandidates = registry.query({ type: "asr", installedOnly: true });
    const real = asrCandidates.find((m) => m.runtime === "whisper-cpp");
    const reference = asrCandidates.find((m) => m.runtime === "onnx");
    expect(real).toBeDefined();
    expect(reference).toBeDefined();
    expect(real!.requirements.approxDiskBytes).toBeLessThan(
      reference!.requirements.approxDiskBytes,
    );
  });
});
