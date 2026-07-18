import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, defaultConfig, loadConfig } from '@twograph/core';

function repoWithConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'twograph-config-'));
  mkdirSync(join(dir, '.twograph'));
  writeFileSync(join(dir, '.twograph', 'config.json'), JSON.stringify(config));
  return dir;
}

describe('config loader', () => {
  it('returns full defaults when no config file exists', () => {
    const config = loadConfig({ cwd: mkdtempSync(join(tmpdir(), 'twograph-empty-')), env: {} });
    expect(config).toEqual(defaultConfig());
    expect(config.retrieval.rrfK).toBe(60);
    expect(config.editing.requireApproval).toBe(true);
  });

  it('file values override defaults, unspecified sections keep defaults', () => {
    const cwd = repoWithConfig({ llm: { provider: 'ollama', model: 'qwen3' } });
    const config = loadConfig({ cwd, env: {} });
    expect(config.llm.provider).toBe('ollama');
    expect(config.qdrant.url).toBe('http://localhost:6333');
  });

  it('environment overrides file values', () => {
    const cwd = repoWithConfig({ memgraph: { uri: 'bolt://filehost:7687' } });
    const config = loadConfig({
      cwd,
      env: { MEMGRAPH_URI: 'bolt://envhost:7687', TWOGRAPH_PORT: '5000' },
    });
    expect(config.memgraph.uri).toBe('bolt://envhost:7687');
    expect(config.server.port).toBe(5000);
  });

  it('names the offending key on invalid config', () => {
    const cwd = repoWithConfig({ retrieval: { k: 0 } });
    expect(() => loadConfig({ cwd, env: {} })).toThrow(ConfigError);
    expect(() => loadConfig({ cwd, env: {} })).toThrow(/retrieval\.k/);
  });

  it('rejects unknown keys (typo protection)', () => {
    const cwd = repoWithConfig({ retreival: { k: 5 } });
    expect(() => loadConfig({ cwd, env: {} })).toThrow(ConfigError);
  });

  it('rejects malformed JSON and bad ports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'twograph-badjson-'));
    mkdirSync(join(dir, '.twograph'));
    writeFileSync(join(dir, '.twograph', 'config.json'), '{ not json');
    expect(() => loadConfig({ cwd: dir, env: {} })).toThrow(ConfigError);

    const cwd = repoWithConfig({});
    expect(() => loadConfig({ cwd, env: { TWOGRAPH_PORT: 'abc' } })).toThrow(ConfigError);
  });
});
