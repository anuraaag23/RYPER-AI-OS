export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly fields?: LogFields;
}

export type LogSink = (record: LogRecord) => void;

/** Default sink: writes newline-delimited JSON to stdout/stderr. */
export const jsonConsoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error" || record.level === "warn") {
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
};

export interface LoggerOptions {
  readonly minLevel?: LogLevel;
  readonly sink?: LogSink;
}

/**
 * Minimal, dependency-free structured logger. Every RYPER package logs
 * through this interface rather than calling console.* directly, so the
 * output format and destination can change centrally (e.g. routed to a
 * platform-native log sink) without touching call sites.
 */
export class Logger {
  private readonly scope: string;
  private readonly minLevel: LogLevel;
  private readonly sink: LogSink;

  constructor(scope: string, options: LoggerOptions = {}) {
    this.scope = scope;
    this.minLevel = options.minLevel ?? "info";
    this.sink = options.sink ?? jsonConsoleSink;
  }

  child(subScope: string): Logger {
    return new Logger(`${this.scope}:${subScope}`, {
      minLevel: this.minLevel,
      sink: this.sink,
    });
  }

  debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  private emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) {
      return;
    }
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(fields ? { fields } : {}),
    };
    this.sink(record);
  }
}

export function createLogger(scope: string, options?: LoggerOptions): Logger {
  return new Logger(scope, options);
}
