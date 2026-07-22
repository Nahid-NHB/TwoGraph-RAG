import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, ValidationError } from '@twograph/core';
import { buildProgram, runInit } from '@twograph/cli';

describe('twograph init', () => {
  it('writes a config that loadConfig accepts', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'twograph-cli-'));
    const path = runInit(cwd);
    expect(path).toContain('.twograph');
    const written: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(written).toBeTypeOf('object');
    expect(loadConfig({ cwd, env: {} }).server.port).toBe(4801);
  });

  it('refuses to overwrite without --force', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'twograph-cli-'));
    runInit(cwd);
    expect(() => runInit(cwd)).toThrow(ValidationError);
    expect(() => runInit(cwd, { force: true })).not.toThrow();
  });
});

describe('program surface', () => {
  it('registers all planned commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    for (const expected of [
      'init',
      'index',
      'search',
      'query',
      'graph',
      'deadcode',
      'deps',
      'serve',
      'mcp',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('stub commands exit with code 2 and explain themselves', async () => {
    const errs: string[] = [];
    const program = buildProgram({ out: () => {}, err: (l) => errs.push(l) });
    program.exitOverride();
    await program.parseAsync(['node', 'twograph', 'graph', 'who_calls']);
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    expect(errs.join('\n')).toMatch(/not implemented/);
  });
});
