import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.js';

/** Configuration schema — docs/06-api-design.md §4. Unknown keys are rejected to catch typos. */
export const configSchema = z
  .object({
    llm: z
      .object({
        provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama', 'openrouter', 'mock']),
        model: z.string(),
        apiKeyEnv: z.string().optional(),
        baseUrl: z.string().optional(),
      })
      .strict()
      .default({ provider: 'openrouter', model: 'google/gemini-2.0-flash-exp:free' }),
    embedder: z.object({ provider: z.string() }).strict().default({ provider: 'unixcoder-onnx' }),
    memgraph: z.object({ uri: z.string() }).strict().default({ uri: 'bolt://localhost:7687' }),
    qdrant: z.object({ url: z.string() }).strict().default({ url: 'http://localhost:6333' }),
    index: z
      .object({
        ignore: z.array(z.string()).default([]),
        entryPoints: z.array(z.string()).default([]),
      })
      .strict()
      .prefault({}),
    retrieval: z
      .object({
        k: z.number().int().min(1).default(12),
        rrfK: z.number().int().min(1).default(60),
        rerank: z.boolean().default(true),
        expansionDecay: z.number().min(0).max(1).default(0.6),
        contextTokenBudget: z.number().int().min(500).default(12_000),
      })
      .strict()
      .prefault({}),
    editing: z
      .object({
        requireApproval: z.boolean().default(true),
        pendingTtlMinutes: z.number().int().min(1).default(60),
      })
      .strict()
      .prefault({}),
    server: z
      .object({
        port: z.number().int().min(1).max(65_535).default(4801),
        allowRawCypher: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    guidelinesFile: z.string().default('.twograph/guidelines.md'),
  })
  .strict();

export type TwoGraphConfig = z.infer<typeof configSchema>;

export const CONFIG_RELATIVE_PATH = join('.twograph', 'config.json');

export interface LoadConfigOptions {
  /** Repo root to look for `.twograph/config.json` in. Default: process.cwd(). */
  cwd?: string;
  /** Explicit config file path (overrides cwd lookup). */
  configPath?: string;
  /** Environment source, injectable for tests. Default: process.env. */
  env?: Record<string, string | undefined>;
}

export function defaultConfig(): TwoGraphConfig {
  return configSchema.parse({});
}

/**
 * Loads config with precedence: defaults < config file < environment.
 * Env overrides: MEMGRAPH_URI, QDRANT_URL, TWOGRAPH_PORT.
 */
export function loadConfig(options: LoadConfigOptions = {}): TwoGraphConfig {
  const env = options.env ?? process.env;
  const path = options.configPath ?? join(options.cwd ?? process.cwd(), CONFIG_RELATIVE_PATH);

  let fileValue: unknown = {};
  let fileFound = false;
  try {
    const raw = readFileSync(path, 'utf8');
    fileFound = true;
    fileValue = JSON.parse(raw);
  } catch (err) {
    if (fileFound) {
      throw new ConfigError(`config file at ${path} is not valid JSON`, { cause: err });
    }
    // No config file — defaults apply.
  }

  const parsed = configSchema.safeParse(fileValue);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`invalid config at ${path} — ${issues}`, {
      details: { path, issues: parsed.error.issues },
    });
  }

  const config = parsed.data;
  if (env['MEMGRAPH_URI']) config.memgraph.uri = env['MEMGRAPH_URI'];
  if (env['QDRANT_URL']) config.qdrant.url = env['QDRANT_URL'];
  if (env['TWOGRAPH_PORT']) {
    const port = Number(env['TWOGRAPH_PORT']);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new ConfigError(`TWOGRAPH_PORT is not a valid port: ${env['TWOGRAPH_PORT']}`);
    }
    config.server.port = port;
  }
  return config;
}
