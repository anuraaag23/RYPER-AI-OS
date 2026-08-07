import type { AIProvider, ProviderKind } from "../types.js";

/**
 * Holds every configured `AIProvider` instance. This is the seam the
 * architecture requires: adding a new provider (a new AI service, a second
 * local runtime, ...) means constructing one more `AIProvider` and calling
 * `register` — nothing here or in the orchestrator changes.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`no provider registered under id "${providerId}"`);
    }
    return provider;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  listByKind(kind: ProviderKind): readonly AIProvider[] {
    return [...this.providers.values()].filter((p) => p.kind === kind);
  }

  list(): readonly AIProvider[] {
    return [...this.providers.values()];
  }
}

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}
