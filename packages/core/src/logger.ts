import { pino, type Logger } from 'pino';

export type { Logger };

const level = process.env['TWOGRAPH_LOG_LEVEL'] ?? 'info';

const root = pino({
  level,
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Namespaced logger, e.g. `createLogger('indexer')`. */
export function createLogger(name: string): Logger {
  return root.child({ name });
}
