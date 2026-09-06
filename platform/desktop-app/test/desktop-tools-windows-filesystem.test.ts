import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@ryper/ai-engine";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
} from "@ryper/windows-agent";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";

/**
 * Real coverage for the window-management and filesystem AI tool
 * surface added during the Tier 1 completion pass, continued (see
 * docs/adr/0029) — previously these real, complete
 * `@ryper/windows-agent` capabilities (`WindowManager`, `FileManager`)
 * had zero tools registered against `ToolRegistry` at all. Uses the
 * same real, in-memory reference `WindowsSystemApi` the rest of the
 * fast suite relies on — not a mock of anything these tests verify
 * (the tool -> desktopActions -> CapabilityManager -> WindowsAdapter
 * wiring itself).
 */
async function buildRegistry(options?: {
  destructiveActionConfirmer?: (request: unknown) => Promise<boolean>;
  seedFiles?: Readonly<Record<string, string>>;
}) {
  const broker = new CapabilityBroker(() => true);
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi({ seedFiles: options?.seedFiles });
  const adapter = await createWindowsAdapter({
    systemApi,
    ...(options?.destructiveActionConfirmer
      ? { destructiveActionConfirmer: options.destructiveActionConfirmer as never }
      : {}),
  });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  const registry = new ToolRegistry(broker);
  for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry };
}

describe("window management AI tools (real @ryper/windows-agent WindowManager, previously zero AI tool surface)", () => {
  it("list_windows reports the real, seeded default windows", async () => {
    const { registry } = await buildRegistry();
    const result = await registry.invoke(
      { id: "c1", name: "list_windows", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Notepad");
    expect(result.content).toContain("File Explorer");
  });

  it("get_active_window reports the real, seeded focused window", async () => {
    const { registry } = await buildRegistry();
    const result = await registry.invoke(
      { id: "c2", name: "get_active_window", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Notepad");
  });

  it("focus_window resolves a free-text query against real open windows and really changes focus", async () => {
    const { registry, adapter } = await buildRegistry();

    const result = await registry.invoke(
      { id: "c3", name: "focus_window", arguments: { window: "explorer" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("File Explorer");

    // Real evidence the underlying WindowManager state actually changed,
    // not just that the tool returned a friendly string.
    const active = await adapter.invoke(
      "window_management",
      "get_active",
      {},
      { invocationId: "v1", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
    );
    expect((active as { title: string }).title).toBe("File Explorer");
  });

  it("focus_window reports a clear failure for a window that doesn't exist", async () => {
    const { registry } = await buildRegistry();
    const result = await registry.invoke(
      { id: "c4", name: "focus_window", arguments: { window: "some app that does not exist" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("couldn't find");
  });

  it("minimize_window with no query targets the real currently-active window", async () => {
    const { registry, adapter } = await buildRegistry();

    const result = await registry.invoke(
      { id: "c5", name: "minimize_window", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Notepad");

    const windows = (await adapter.invoke(
      "window_management",
      "enumerate",
      {},
      { invocationId: "v2", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
    )) as readonly { title: string; state: string }[];
    expect(windows.find((w) => w.title.includes("Notepad"))?.state).toBe("minimized");
  });

  it("snap_window rejects an invalid position before touching the capability layer", async () => {
    const { registry, broker } = await buildRegistry();
    const result = await registry.invoke(
      { id: "c6", name: "snap_window", arguments: { position: "sideways" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(
      broker.getAuditLog().some((e) => e.capability === "window_management" && e.result === "used"),
    ).toBe(false);
  });

  it("snap_window really repositions the target window to a valid position", async () => {
    const { registry, adapter } = await buildRegistry();
    const result = await registry.invoke(
      { id: "c7", name: "snap_window", arguments: { position: "left" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    const active = (await adapter.invoke(
      "window_management",
      "get_active",
      {},
      { invocationId: "v3", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
    )) as { bounds: { x: number } };
    expect(active.bounds.x).toBe(0);
  });

  it("switch_window really changes which window is focused", async () => {
    const { registry, adapter } = await buildRegistry();
    const before = (await adapter.invoke(
      "window_management",
      "get_active",
      {},
      { invocationId: "v4", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
    )) as { title: string };

    const result = await registry.invoke(
      { id: "c8", name: "switch_window", arguments: {} },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);

    const after = (await adapter.invoke(
      "window_management",
      "get_active",
      {},
      { invocationId: "v5", actorId: "ai-orchestrator", sessionId: "s1", platform: "windows" },
    )) as { title: string };
    expect(after.title).not.toBe(before.title);
  });
});

describe("filesystem AI tools (real @ryper/windows-agent FileManager, previously zero AI tool surface)", () => {
  it("list_files lists a real, seeded well-known folder", async () => {
    const { registry } = await buildRegistry({
      seedFiles: { "C:\\Users\\ryper\\Downloads\\report.pdf": "pdf-bytes" },
    });
    const result = await registry.invoke(
      { id: "f1", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Downloads" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("report.pdf");
  });

  it("list_files reports a real failure for a folder that doesn't exist", async () => {
    const { registry } = await buildRegistry();
    const result = await registry.invoke(
      { id: "f2", name: "list_files", arguments: { path: "C:\\NoSuchFolder" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
  });

  it("read_file returns the real, seeded file contents", async () => {
    const { registry } = await buildRegistry({
      seedFiles: { "C:\\Users\\ryper\\Documents\\notes.txt": "hello from a real seeded file" },
    });
    const result = await registry.invoke(
      {
        id: "f3",
        name: "read_file",
        arguments: { path: "C:\\Users\\ryper\\Documents\\notes.txt" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe("hello from a real seeded file");
  });

  it("get_folder_path resolves a real well-known folder to its real path", async () => {
    const { registry } = await buildRegistry();
    const result = await registry.invoke(
      { id: "f4", name: "get_folder_path", arguments: { folder: "desktop" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("C:\\Users\\ryper\\Desktop");
  });

  it("create_folder really creates a folder the filesystem subsequently lists", async () => {
    const { registry } = await buildRegistry();
    const create = await registry.invoke(
      {
        id: "f5",
        name: "create_folder",
        arguments: { path: "C:\\Users\\ryper\\Documents\\NewFolder" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(create.ok).toBe(true);

    const list = await registry.invoke(
      { id: "f6", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Documents" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(list.ok).toBe(true);
    expect(list.content).toContain("NewFolder");
  });

  it("delete_file is denied by default via the real DestructiveActionGate (deny-by-default confirmer)", async () => {
    const { registry } = await buildRegistry({
      seedFiles: { "C:\\Users\\ryper\\Downloads\\temp.txt": "x" },
    });
    const result = await registry.invoke(
      {
        id: "f7",
        name: "delete_file",
        arguments: { path: "C:\\Users\\ryper\\Downloads\\temp.txt" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    // Real proof the file was never actually removed.
    const list = await registry.invoke(
      { id: "f8", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Downloads" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(list.content).toContain("temp.txt");
  });

  it("delete_file succeeds once a real confirmer approves the destructive action", async () => {
    const { registry } = await buildRegistry({
      seedFiles: { "C:\\Users\\ryper\\Downloads\\temp.txt": "x" },
      destructiveActionConfirmer: async () => true,
    });
    const result = await registry.invoke(
      {
        id: "f9",
        name: "delete_file",
        arguments: { path: "C:\\Users\\ryper\\Downloads\\temp.txt" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(true);

    const list = await registry.invoke(
      { id: "f10", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Downloads" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(list.content).not.toContain("temp.txt");
  });

  it("copy_file, move_file, and rename_file all really mutate the filesystem", async () => {
    const { registry } = await buildRegistry({
      seedFiles: { "C:\\Users\\ryper\\Downloads\\a.txt": "content-a" },
    });

    const copy = await registry.invoke(
      {
        id: "f11",
        name: "copy_file",
        arguments: {
          sourcePath: "C:\\Users\\ryper\\Downloads\\a.txt",
          destinationPath: "C:\\Users\\ryper\\Documents\\a-copy.txt",
        },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(copy.ok).toBe(true);
    const read = await registry.invoke(
      {
        id: "f12",
        name: "read_file",
        arguments: { path: "C:\\Users\\ryper\\Documents\\a-copy.txt" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(read.content).toBe("content-a");

    const rename = await registry.invoke(
      {
        id: "f13",
        name: "rename_file",
        arguments: { path: "C:\\Users\\ryper\\Documents\\a-copy.txt", newName: "a-renamed.txt" },
      },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(rename.ok).toBe(true);
    const listAfterRename = await registry.invoke(
      { id: "f14", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Documents" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(listAfterRename.content).toContain("a-renamed.txt");
  });

  it("is denied by default when the self-granting consent prompt denies (CapabilityManager's own gate, matching the audio tools' pattern)", async () => {
    const broker = new CapabilityBroker(() => false); // consent prompt always denies
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const adapter = await createWindowsAdapter();
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    const result = await registry.invoke(
      { id: "f15", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Downloads" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(result.ok).toBe(false);
    expect(
      broker.getAuditLog().some((e) => e.capability === "filesystem.read" && e.result === "denied"),
    ).toBe(true);
    expect(
      broker.getAuditLog().some((e) => e.capability === "filesystem.write"),
    ).toBe(false);
  });

  it("list_files requests and grants filesystem.read, NOT filesystem.write", async () => {
    const requestedCapabilities: string[] = [];
    const broker = new CapabilityBroker((req) => {
      requestedCapabilities.push(req.capability);
      return true;
    });
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const systemApi = createInMemoryWindowsSystemApi({
      seedFiles: { "C:\\Users\\ryper\\Downloads\\document.pdf": "data" },
    });
    const adapter = await createWindowsAdapter({ systemApi });
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    const result = await registry.invoke(
      { id: "f16", name: "list_files", arguments: { path: "C:\\Users\\ryper\\Downloads" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );

    expect(result.ok).toBe(true);
    expect(requestedCapabilities).toContain("filesystem.read");
    expect(requestedCapabilities).not.toContain("filesystem.write");
    expect(broker.hasGrant("ai-orchestrator", "filesystem.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "filesystem.write")).toBe(false);
  });

  it("an agent holding only filesystem.read cannot execute mutating operations without filesystem.write consent", async () => {
    const requestedCapabilities: string[] = [];
    // Grant filesystem.read, but deny filesystem.write
    const broker = new CapabilityBroker((req) => {
      requestedCapabilities.push(req.capability);
      return req.capability === "filesystem.read";
    });
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const systemApi = createInMemoryWindowsSystemApi({
      seedFiles: { "C:\\Users\\ryper\\Documents\\hello.txt": "content" },
    });
    const adapter = await createWindowsAdapter({ systemApi });
    capabilityManager.registerAdapter(adapter);
    for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
      capabilityManager.registerCapability(descriptor);
    }
    const registry = new ToolRegistry(broker);
    for (const tool of buildDesktopToolDefinitions(capabilityManager)) {
      registry.register(tool);
    }

    // Read succeeds with filesystem.read
    const readResult = await registry.invoke(
      { id: "f17", name: "read_file", arguments: { path: "C:\\Users\\ryper\\Documents\\hello.txt" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(readResult.ok).toBe(true);
    expect(readResult.content).toBe("content");
    expect(broker.hasGrant("ai-orchestrator", "filesystem.read")).toBe(true);
    expect(broker.hasGrant("ai-orchestrator", "filesystem.write")).toBe(false);

    // Attempting to create a folder triggers a request for filesystem.write, which is denied
    const createResult = await registry.invoke(
      { id: "f18", name: "create_folder", arguments: { path: "C:\\Users\\ryper\\Documents\\Forbidden" } },
      { sessionId: "s1" },
      "ai-orchestrator",
    );
    expect(createResult.ok).toBe(false);
    expect(requestedCapabilities).toContain("filesystem.write");
    expect(broker.hasGrant("ai-orchestrator", "filesystem.write")).toBe(false);
  });
});
