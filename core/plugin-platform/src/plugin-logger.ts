import { createLogger, type LogFields, type Logger } from "@ryper/logging";

/**
 * One `@ryper/logging` `Logger` per plugin, scoped by id, so log output
 * is always attributable to the plugin that produced it — the `PluginLoggingAccess`
 * interface a plugin's `PluginContext` exposes is backed directly by this.
 */
export class PluginLoggerFactory {
  private readonly loggers = new Map<string, Logger>();

  forPlugin(pluginId: string): Logger {
    const existing = this.loggers.get(pluginId);
    if (existing) return existing;
    const logger = createLogger(`plugin:${pluginId}`);
    this.loggers.set(pluginId, logger);
    return logger;
  }
}

export function createPluginLoggerFactory(): PluginLoggerFactory {
  return new PluginLoggerFactory();
}

export type { LogFields };
