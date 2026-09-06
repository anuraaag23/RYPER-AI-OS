import { createLogger } from "@ryper/logging";
import type {
  DnsConfigurationInfo,
  DnsSpec,
  NetworkAdapterDetail,
  NetworkConfigurationInfo,
  NetworkRollbackState,
  StaticIpSpec,
} from "./types.js";
import type { WindowsSystemApi } from "./windows-system-api.js";
import { createDestructiveActionGate, type DestructiveActionGate } from "./confirmation.js";

const log = createLogger("windows-agent:network-manager");

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;
const DANGEROUS_CHARS = /[;&|`$\0\r\n"']/;

export function validateInterfaceAlias(alias: string): string {
  if (!alias || typeof alias !== "string" || alias.trim().length === 0) {
    throw new Error("Network interface name/alias is required and cannot be empty.");
  }
  const clean = alias.trim();
  if (clean.length > 128) {
    throw new Error("Network interface name exceeds maximum allowed length of 128 characters.");
  }
  if (DANGEROUS_CHARS.test(clean) || clean.includes("..")) {
    throw new Error("Network interface name contains invalid or potentially dangerous characters.");
  }
  return clean;
}

export function validateIpAddress(ip: string, fieldName = "IP address"): string {
  if (!ip || typeof ip !== "string" || ip.trim().length === 0) {
    throw new Error(`${fieldName} is required and cannot be empty.`);
  }
  const clean = ip.trim();
  if (DANGEROUS_CHARS.test(clean)) {
    throw new Error(`${fieldName} contains illegal command injection characters.`);
  }
  if (!IPV4_REGEX.test(clean) && !IPV6_REGEX.test(clean) && !clean.includes(":")) {
    throw new Error(`${fieldName} "${clean}" is invalid: not a valid IPv4 or IPv6 address.`);
  }
  return clean;
}

export function validateDnsServers(servers: readonly string[]): readonly string[] {
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error("At least one DNS server address must be specified.");
  }
  return servers.map((s, idx) => validateIpAddress(s, `DNS server address #${idx + 1}`));
}

export function validatePrefixLength(prefix?: number): number {
  if (prefix === undefined || prefix === null) return 24;
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
    throw new Error(`Invalid subnet prefix length "${prefix}". IPv4 prefix length must be between 1 and 32.`);
  }
  return prefix;
}

export class NetworkManager {
  constructor(
    private readonly systemApi: WindowsSystemApi,
    private readonly destructiveActionGate: DestructiveActionGate = createDestructiveActionGate(),
  ) {}

  // ---- Read Operations ----

  async listAdapters(): Promise<readonly NetworkAdapterDetail[]> {
    return this.systemApi.listNetworkAdapterDetails();
  }

  async getAdapter(interfaceAlias: string): Promise<NetworkAdapterDetail | undefined> {
    const alias = validateInterfaceAlias(interfaceAlias);
    const adapters = await this.systemApi.listNetworkAdapterDetails();
    return adapters.find((a) => a.name.toLowerCase() === alias.toLowerCase());
  }

  async getNetworkConfiguration(interfaceAlias?: string): Promise<NetworkConfigurationInfo | undefined> {
    const alias = interfaceAlias ? validateInterfaceAlias(interfaceAlias) : undefined;
    return this.systemApi.getNetworkConfiguration(alias);
  }

  async getDnsConfiguration(interfaceAlias?: string): Promise<DnsConfigurationInfo | undefined> {
    const alias = interfaceAlias ? validateInterfaceAlias(interfaceAlias) : undefined;
    return this.systemApi.getDnsConfiguration(alias);
  }

  async getActiveAdapter(): Promise<NetworkAdapterDetail | undefined> {
    return this.systemApi.getActiveAdapter();
  }

  async getNetworkStatus(): Promise<{ connected: boolean; activeAdapter?: string; connectionType?: string }> {
    const active = await this.systemApi.getActiveAdapter();
    if (!active || active.status !== "up") {
      return { connected: false };
    }
    return {
      connected: true,
      activeAdapter: active.name,
      connectionType: active.type,
    };
  }

  async inspectInterface(interfaceAlias: string): Promise<NetworkConfigurationInfo> {
    const alias = validateInterfaceAlias(interfaceAlias);
    const config = await this.systemApi.getNetworkConfiguration(alias);
    if (!config) {
      throw new Error(`Network adapter "${alias}" was not found.`);
    }
    return config;
  }

  // ---- Active Adapter Protection ----

  private async checkActiveAdapterProtection(targetAlias: string, action: string, signal?: AbortSignal): Promise<void> {
    const active = await this.systemApi.getActiveAdapter();
    if (active && active.name.toLowerCase() === targetAlias.toLowerCase()) {
      if (signal?.aborted) throw new Error(`"${action}" was cancelled`);
      log.warn("destructive network action targeted at active connection", { action, target: targetAlias });
      await this.destructiveActionGate.require({
        action,
        target: targetAlias,
        reason:
          `Modifying or disabling the active network connection "${targetAlias}" ` +
          "will disrupt Internet access and network connectivity on this machine.",
      });
      if (signal?.aborted) throw new Error(`"${action}" was cancelled`);
    }
  }

  // ---- Rollback State Helpers ----

  async captureRollbackState(interfaceAlias: string): Promise<NetworkRollbackState | undefined> {
    const alias = validateInterfaceAlias(interfaceAlias);
    const cfg = await this.systemApi.getNetworkConfiguration(alias);
    if (!cfg) return undefined;
    return {
      interfaceAlias: cfg.interfaceAlias,
      dhcpEnabled: cfg.dhcpEnabled,
      ipAddresses: cfg.ipv4Addresses,
      defaultGateway: cfg.defaultGateway ?? null,
      dnsServers: cfg.dnsServers,
    };
  }

  // ---- Mutating Operations ----

  async enableAdapter(interfaceAlias: string, signal?: AbortSignal): Promise<void> {
    const alias = validateInterfaceAlias(interfaceAlias);
    if (signal?.aborted) throw new Error('"enable adapter" was cancelled');
    await this.systemApi.enableNetworkAdapter(alias);
    log.info("network adapter enabled", { interfaceAlias: alias });
  }

  async disableAdapter(interfaceAlias: string, signal?: AbortSignal): Promise<void> {
    const alias = validateInterfaceAlias(interfaceAlias);
    await this.checkActiveAdapterProtection(alias, "disable network adapter", signal);
    await this.systemApi.disableNetworkAdapter(alias);
    log.info("network adapter disabled", { interfaceAlias: alias });
  }

  async setDhcp(interfaceAlias: string, signal?: AbortSignal): Promise<void> {
    const alias = validateInterfaceAlias(interfaceAlias);
    await this.checkActiveAdapterProtection(alias, "enable DHCP on active adapter", signal);
    await this.systemApi.setDhcp(alias);
    log.info("dhcp configured", { interfaceAlias: alias });
  }

  async setStaticIp(spec: StaticIpSpec, signal?: AbortSignal): Promise<void> {
    const alias = validateInterfaceAlias(spec.interfaceAlias);
    const ip = validateIpAddress(spec.ipAddress, "Static IP address");
    const prefix = validatePrefixLength(spec.prefixLength);
    const gateway = spec.defaultGateway ? validateIpAddress(spec.defaultGateway, "Default gateway") : undefined;

    await this.checkActiveAdapterProtection(alias, "set static IP on active adapter", signal);

    await this.systemApi.setStaticIp({
      interfaceAlias: alias,
      ipAddress: ip,
      ...(prefix !== undefined ? { prefixLength: prefix } : {}),
      ...(gateway !== undefined ? { defaultGateway: gateway } : {}),
    });
    log.info("static ip configured", { interfaceAlias: alias, ipAddress: ip, prefixLength: prefix, defaultGateway: gateway });
  }

  async setDns(spec: DnsSpec, signal?: AbortSignal): Promise<void> {
    const alias = validateInterfaceAlias(spec.interfaceAlias);
    const servers = validateDnsServers(spec.serverAddresses);

    await this.checkActiveAdapterProtection(alias, "set DNS servers on active adapter", signal);

    await this.systemApi.setDns({
      interfaceAlias: alias,
      serverAddresses: servers,
    });
    log.info("dns configured", { interfaceAlias: alias, servers });
  }

  async renewDhcp(interfaceAlias?: string): Promise<void> {
    const alias = interfaceAlias ? validateInterfaceAlias(interfaceAlias) : undefined;
    await this.systemApi.renewDhcp(alias);
    log.info("dhcp renewed", { interfaceAlias: alias ?? "all" });
  }

  async releaseDhcp(interfaceAlias?: string, signal?: AbortSignal): Promise<void> {
    const alias = interfaceAlias ? validateInterfaceAlias(interfaceAlias) : undefined;
    if (alias) {
      await this.checkActiveAdapterProtection(alias, "release DHCP lease on active adapter", signal);
    }
    await this.systemApi.releaseDhcp(alias);
    log.info("dhcp released", { interfaceAlias: alias ?? "all" });
  }

  async resetAdapter(interfaceAlias: string, signal?: AbortSignal): Promise<void> {
    const alias = validateInterfaceAlias(interfaceAlias);
    await this.checkActiveAdapterProtection(alias, "restart network adapter", signal);
    await this.systemApi.resetAdapter(alias);
    log.info("adapter reset", { interfaceAlias: alias });
  }
}

export function createNetworkManager(
  systemApi: WindowsSystemApi,
  destructiveActionGate?: DestructiveActionGate,
): NetworkManager {
  return new NetworkManager(systemApi, destructiveActionGate);
}
