import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@ryper/ai-engine";
import { CapabilityBroker, type CapabilityRequest } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import {
  createWindowsAdapter,
  WINDOWS_CAPABILITY_DESCRIPTORS,
  createInMemoryWindowsSystemApi,
  createNetworkManager,
} from "@ryper/windows-agent";
import { buildDesktopToolDefinitions } from "../electron/desktop-tools.js";
import { PowerConfirmationManager } from "../electron/power-confirmation.js";

const ACTOR = "ai-orchestrator";
const ACTOR_CTX = {
  actorId: ACTOR,
  platform: "windows" as const,
  invocationId: "test-inv-net",
  sessionId: "s1",
};

async function buildTestRig(options?: {
  promptForConsent?: (request: CapabilityRequest) => Promise<boolean> | boolean;
  destructiveActionConfirmer?: (action: any) => Promise<boolean>;
}) {
  const broker = new CapabilityBroker(options?.promptForConsent ?? (() => true));
  const capabilityManager = createCapabilityManager({ broker, platformDetector: () => "windows" });
  const systemApi = createInMemoryWindowsSystemApi();

  const adapter = await createWindowsAdapter({
    systemApi,
    destructiveActionConfirmer: options?.destructiveActionConfirmer ?? (() => Promise.resolve(true)),
  });
  capabilityManager.registerAdapter(adapter);
  for (const descriptor of WINDOWS_CAPABILITY_DESCRIPTORS) {
    capabilityManager.registerCapability(descriptor);
  }
  const powerConfirmation = new PowerConfirmationManager();
  const registry = new ToolRegistry(broker);
  for (const tool of buildDesktopToolDefinitions(
    capabilityManager,
    powerConfirmation,
    undefined,
    ACTOR,
  )) {
    registry.register(tool);
  }
  return { broker, capabilityManager, adapter, registry, systemApi, powerConfirmation };
}

describe("Windows Network Configuration Mutation Security Suite (26 Requirements)", () => {
  // 1. list_network_adapters requires automation.read
  it("1. list_network_adapters requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c1", name: "list_network_adapters", arguments: {} },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
  });

  // 2. get_network_configuration requires automation.read
  it("2. get_network_configuration requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c2", name: "get_network_configuration", arguments: { interfaceAlias: "Wi-Fi" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(result.content).toContain("Wi-Fi");
  });

  // 3. get_dns_configuration requires automation.read
  it("3. get_dns_configuration requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c3", name: "get_dns_configuration", arguments: { interfaceAlias: "Wi-Fi" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(result.content).toContain("DNS Servers");
  });

  // 4. get_active_adapter requires automation.read
  it("4. get_active_adapter requires automation.read", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c4", name: "get_active_adapter", arguments: {} },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.read");
    expect(result.content).toContain("Active network adapter");
  });

  // 5. inspect_interface maps to automation.read
  it("5. inspect_interface maps to automation.read", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await capabilityManager.invoke(
      "networking",
      "inspect_interface",
      { interfaceAlias: "Wi-Fi" },
      ACTOR_CTX,
    );
    expect(result).toBeDefined();
    expect(requestedCaps).toContain("automation.read");
  });

  // 6. enable_network_adapter requires automation.execute
  it("6. enable_network_adapter requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c6", name: "enable_network_adapter", arguments: { interfaceAlias: "Ethernet" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 7. disable_network_adapter requires automation.execute
  it("7. disable_network_adapter requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c7", name: "disable_network_adapter", arguments: { interfaceAlias: "Ethernet" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 8. set_dhcp requires automation.execute
  it("8. set_dhcp requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      { id: "c8", name: "set_dhcp", arguments: { interfaceAlias: "Ethernet" } },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 9. set_static_ip requires automation.execute
  it("9. set_static_ip requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      {
        id: "c9",
        name: "set_static_ip",
        arguments: {
          interfaceAlias: "Ethernet",
          ipAddress: "192.168.2.100",
          prefixLength: 24,
        },
      },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 10. set_dns requires automation.execute
  it("10. set_dns requires automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { registry } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    const result = await registry.invoke(
      {
        id: "c10",
        name: "set_dns",
        arguments: {
          interfaceAlias: "Ethernet",
          dnsServers: ["1.1.1.1", "1.0.0.1"],
        },
      },
      { sessionId: "s1" },
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 11. renew_dhcp maps to automation.execute
  it("11. renew_dhcp maps to automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    await capabilityManager.invoke("networking", "renew_dhcp", { interfaceAlias: "Ethernet" }, ACTOR_CTX);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 12. release_dhcp maps to automation.execute
  it("12. release_dhcp maps to automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    await capabilityManager.invoke("networking", "release_dhcp", { interfaceAlias: "Ethernet" }, ACTOR_CTX);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 13. reset_adapter maps to automation.execute
  it("13. reset_adapter maps to automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    await capabilityManager.invoke("networking", "reset_adapter", { interfaceAlias: "Ethernet" }, ACTOR_CTX);
    expect(requestedCaps).toContain("automation.execute");
  });

  // 14. Unknown/unmapped networking operation strictly fails closed to automation.execute
  it("14. Unknown/unmapped operation strictly fails closed to automation.execute", async () => {
    const requestedCaps: string[] = [];
    const { capabilityManager } = await buildTestRig({
      promptForConsent: (req) => {
        requestedCaps.push(req.capability);
        return true;
      },
    });
    await expect(
      capabilityManager.invoke("networking", "non_existent_mutation", {}, ACTOR_CTX),
    ).rejects.toThrow();
    expect(requestedCaps).toContain("automation.execute");
  });

  // 15. Active adapter protection: disable active adapter triggers DestructiveActionGate
  it("15. Active adapter protection: disable active adapter triggers DestructiveActionGate", async () => {
    let gatePrompted = false;
    let gateAction = "";
    let gateTarget = "";
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: (action) => {
        gatePrompted = true;
        gateAction = action.action;
        gateTarget = action.target;
        return Promise.resolve(false); // deny
      },
    });

    await expect(
      capabilityManager.invoke("networking", "disable_network_adapter", { interfaceAlias: "Wi-Fi" }, ACTOR_CTX),
    ).rejects.toThrow(/not confirmed|confirmation/i);
    expect(gatePrompted).toBe(true);
    expect(gateTarget.toLowerCase()).toBe("wi-fi");
  });

  // 16. Active adapter protection: set_dhcp on active adapter triggers DestructiveActionGate
  it("16. Active adapter protection: set_dhcp on active adapter triggers DestructiveActionGate", async () => {
    let gatePrompted = false;
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: () => {
        gatePrompted = true;
        return Promise.resolve(false);
      },
    });

    await expect(
      capabilityManager.invoke("networking", "set_dhcp", { interfaceAlias: "Wi-Fi" }, ACTOR_CTX),
    ).rejects.toThrow(/not confirmed|confirmation/i);
    expect(gatePrompted).toBe(true);
  });

  // 17. Active adapter protection: set_static_ip on active adapter triggers DestructiveActionGate
  it("17. Active adapter protection: set_static_ip on active adapter triggers DestructiveActionGate", async () => {
    let gatePrompted = false;
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: () => {
        gatePrompted = true;
        return Promise.resolve(false);
      },
    });

    await expect(
      capabilityManager.invoke(
        "networking",
        "set_static_ip",
        { interfaceAlias: "Wi-Fi", ipAddress: "192.168.1.200", prefixLength: 24 },
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not confirmed|confirmation/i);
    expect(gatePrompted).toBe(true);
  });

  // 18. Active adapter protection: set_dns on active adapter triggers DestructiveActionGate
  it("18. Active adapter protection: set_dns on active adapter triggers DestructiveActionGate", async () => {
    let gatePrompted = false;
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: () => {
        gatePrompted = true;
        return Promise.resolve(false);
      },
    });

    await expect(
      capabilityManager.invoke(
        "networking",
        "set_dns",
        { interfaceAlias: "Wi-Fi", servers: ["1.1.1.1"] },
        ACTOR_CTX,
      ),
    ).rejects.toThrow(/not confirmed|confirmation/i);
    expect(gatePrompted).toBe(true);
  });

  // 19. Active adapter protection: release_dhcp on active adapter triggers DestructiveActionGate
  it("19. Active adapter protection: release_dhcp on active adapter triggers DestructiveActionGate", async () => {
    let gatePrompted = false;
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: () => {
        gatePrompted = true;
        return Promise.resolve(false);
      },
    });

    await expect(
      capabilityManager.invoke("networking", "release_dhcp", { interfaceAlias: "Wi-Fi" }, ACTOR_CTX),
    ).rejects.toThrow(/not confirmed|confirmation/i);
    expect(gatePrompted).toBe(true);
  });

  // 20. Active adapter protection: reset_adapter on active adapter triggers DestructiveActionGate
  it("20. Active adapter protection: reset_adapter on active adapter triggers DestructiveActionGate", async () => {
    let gatePrompted = false;
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: () => {
        gatePrompted = true;
        return Promise.resolve(false);
      },
    });

    await expect(
      capabilityManager.invoke("networking", "reset_adapter", { interfaceAlias: "Wi-Fi" }, ACTOR_CTX),
    ).rejects.toThrow(/not confirmed|confirmation/i);
    expect(gatePrompted).toBe(true);
  });

  // 21. Inactive/disconnected adapter mutation (Ethernet) does not trigger active adapter gate
  it("21. Inactive adapter mutation does not trigger active adapter gate", async () => {
    let gatePrompted = false;
    const { capabilityManager } = await buildTestRig({
      destructiveActionConfirmer: () => {
        gatePrompted = true;
        return Promise.resolve(false);
      },
    });

    await capabilityManager.invoke("networking", "enable_network_adapter", { interfaceAlias: "Ethernet" }, ACTOR_CTX);
    expect(gatePrompted).toBe(false);
  });

  // 22. Input validation: interface alias with shell injection characters is rejected
  it("22. Input validation: interface alias with shell injection characters is rejected", async () => {
    const { capabilityManager } = await buildTestRig();
    const badAliases = [
      "Ethernet; rm -rf /",
      "Wi-Fi & calc.exe",
      "Adapter | evil",
      "Test`dir`",
      "Adapter$(whoami)",
      'Adapter"quote',
      "Adapter'single",
      "Adapter\0null",
    ];
    for (const bad of badAliases) {
      await expect(
        capabilityManager.invoke("networking", "get_network_configuration", { interfaceAlias: bad }, ACTOR_CTX),
      ).rejects.toThrow(/injection|invalid/i);
    }
  });

  // 23. Input validation: invalid IPv4 address format rejected
  it("23. Input validation: invalid IPv4 address format rejected", async () => {
    const { capabilityManager } = await buildTestRig();
    const badIps = ["999.999.999.999", "192.168.1.500", "192.168.1", "192.168.1.1.1", "abc.def.ghi.jkl"];
    for (const bad of badIps) {
      await expect(
        capabilityManager.invoke(
          "networking",
          "set_static_ip",
          { interfaceAlias: "Ethernet", ipAddress: bad, prefixLength: 24 },
          ACTOR_CTX,
        ),
      ).rejects.toThrow(/invalid/i);
    }
  });

  // 24. Input validation: invalid IPv6 address format rejected
  it("24. Input validation: invalid IPv6 address format rejected", async () => {
    const { capabilityManager } = await buildTestRig();
    const badIps = ["2001:xyz::1", "fe80:::1", "gggg::1"];
    for (const bad of badIps) {
      await expect(
        capabilityManager.invoke(
          "networking",
          "set_static_ip",
          { interfaceAlias: "Ethernet", ipAddress: bad, prefixLength: 64 },
          ACTOR_CTX,
        ),
      ).rejects.toThrow(/invalid/i);
    }
  });

  // 25. Input validation: invalid prefix length rejected
  it("25. Input validation: invalid prefix length (< 1 or > 128) rejected", async () => {
    const { capabilityManager } = await buildTestRig();
    const badPrefixes = [0, -1, 129, 200];
    for (const bad of badPrefixes) {
      await expect(
        capabilityManager.invoke(
          "networking",
          "set_static_ip",
          { interfaceAlias: "Ethernet", ipAddress: "192.168.1.100", prefixLength: bad },
          ACTOR_CTX,
        ),
      ).rejects.toThrow(/prefix/i);
    }
  });

  // 26. Rollback state helper: captureRollbackState accurately captures current state
  it("26. Rollback state helper: captureRollbackState accurately captures current state", async () => {
    const { systemApi } = await buildTestRig();
    const netManager = createNetworkManager(systemApi);
    const rollback = await netManager.captureRollbackState("Wi-Fi");
    expect(rollback).toBeDefined();
    expect(rollback?.interfaceAlias).toBe("Wi-Fi");
    expect(rollback?.dhcpEnabled).toBe(true);
    expect(rollback?.ipAddresses).toContain("192.168.1.4");
    expect(rollback?.defaultGateway).toBe("192.168.1.1");
    expect(rollback?.dnsServers).toContain("192.168.1.1");
  });
});
