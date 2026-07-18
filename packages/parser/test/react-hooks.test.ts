import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();
const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');
const parseSample = (rel: string) =>
  engine.parseFile('sample', rel, readFileSync(join(SRC, rel), 'utf8'));

describe('reactHooksExtractor', () => {
  it('upgrades custom use* functions to hook kind', async () => {
    const { symbols } = await parseSample('hooks/useDebounce.ts');
    const hook = symbols.find((s) => s.name === 'useDebounce');
    expect(hook?.kind).toBe('hook');
    expect(hook?.meta['builtin']).toBe(false);
  });

  it('records built-in and custom hook calls per symbol', async () => {
    const { symbols, references } = await parseSample('components/UserList.tsx');
    const list = symbols.find((s) => s.name === 'UserList');
    expect(list?.meta['hooksUsed']).toEqual(
      expect.arrayContaining(['useUsers', 'useState', 'useDebounce']),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'UserList', name: 'useUsers', kind: 'hook' }),
    );
  });

  it('marks createContext variables as context symbols', async () => {
    const { symbols } = await parseSample('auth/AuthContext.tsx');
    expect(symbols.find((s) => s.name === 'AuthContext')?.kind).toBe('context');
  });

  it('links providers, consumers, and reducers', async () => {
    const provider = (await parseSample('auth/AuthContext.tsx')).symbols.find(
      (s) => s.name === 'AuthProvider',
    );
    expect(provider?.meta['providesContexts']).toEqual(['AuthContext']);
    expect(provider?.meta['reducers']).toEqual(['authReducer']);

    const consumer = (await parseSample('auth/useAuth.ts')).symbols.find(
      (s) => s.name === 'useAuth',
    );
    expect(consumer?.kind).toBe('hook');
    expect(consumer?.meta['consumesContexts']).toEqual(['AuthContext']);
  });

  it('records reducer references for the graph pass', async () => {
    const { references } = await parseSample('auth/AuthContext.tsx');
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'AuthProvider', name: 'authReducer', kind: 'read' }),
    );
  });
});
