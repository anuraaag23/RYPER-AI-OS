import { createLogger } from "@ryper/logging";

const log = createLogger("telemetry");

export interface TelemetryEvent {
  readonly name: string;
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}

export type TelemetryTransport = (event: TelemetryEvent) => Promise<void> | void;

export interface TelemetryConfig {
  /** Telemetry is OFF unless the user has explicitly opted in. */
  readonly enabled: boolean;
  readonly transport?: TelemetryTransport;
}

/**
 * Telemetry is disabled by default and never sends anything until
 * `enabled: true` is passed in explicitly by user-facing settings — this
 * module never flips its own default, and ships with no network transport
 * wired in (the platform shell must supply one deliberately).
 */
export class TelemetryClient {
  private readonly enabled: boolean;
  private readonly transport: TelemetryTransport | undefined;
  private readonly buffer: TelemetryEvent[] = [];

  constructor(config: TelemetryConfig) {
    this.enabled = config.enabled;
    this.transport = config.transport;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async track(event: TelemetryEvent): Promise<void> {
    if (!this.enabled) {
      log.debug("telemetry disabled, dropping event", { name: event.name });
      return;
    }
    this.buffer.push(event);
    if (this.transport) {
      await this.transport(event);
    }
  }

  /** Exposed for the in-app "what have you collected" transparency view. */
  getBufferedEvents(): readonly TelemetryEvent[] {
    return this.buffer;
  }

  clearBuffer(): void {
    this.buffer.length = 0;
  }
}

export function createTelemetryClient(config: TelemetryConfig): TelemetryClient {
  return new TelemetryClient(config);
}
