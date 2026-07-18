import neo4j, {
  type Driver,
  type ManagedTransaction,
  type Record as Neo4jRecord,
} from 'neo4j-driver';
import { createLogger, GraphError } from '@twograph/core';

const log = createLogger('graph');

export interface GraphClientOptions {
  uri: string;
  /** Memgraph runs without auth by default; credentials optional. */
  username?: string;
  password?: string;
  maxRetries?: number;
}

/**
 * Thin Bolt client for Memgraph. All access is parameterized — no string
 * concatenation into Cypher anywhere above this layer.
 */
export class GraphClient {
  private readonly driver: Driver;
  private readonly maxRetries: number;

  constructor(options: GraphClientOptions) {
    this.driver = neo4j.driver(
      options.uri,
      neo4j.auth.basic(options.username ?? '', options.password ?? ''),
      { disableLosslessIntegers: true },
    );
    this.maxRetries = options.maxRetries ?? 3;
  }

  /** Runs a single auto-commit query with transient-error retry. */
  async run(query: string, params: Record<string, unknown> = {}): Promise<Neo4jRecord[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const session = this.driver.session();
      try {
        const result = await session.run(query, params);
        return result.records;
      } catch (err) {
        lastError = err;
        if (!isTransient(err)) break;
        log.warn({ attempt, err: String(err) }, 'transient graph error, retrying');
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      } finally {
        await session.close();
      }
    }
    throw new GraphError('GRAPH_QUERY_FAILED', `query failed: ${truncate(query)}`, {
      cause: lastError,
    });
  }

  /** Runs a function inside a single write transaction. */
  async withTx<T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.driver.session();
    try {
      return await session.executeWrite(fn);
    } catch (err) {
      throw new GraphError('GRAPH_QUERY_FAILED', 'transaction failed', { cause: err });
    } finally {
      await session.close();
    }
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.run('RETURN 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Transient|deadlock|ServiceUnavailable|ECONNRESET|failed to connect/i.test(message);
}

function truncate(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
