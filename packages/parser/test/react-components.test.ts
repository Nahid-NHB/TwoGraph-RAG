import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();
const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');
const parseSample = (rel: string) =>
  engine.parseFile('sample', rel, readFileSync(join(SRC, rel), 'utf8'));

describe('reactComponentsExtractor', () => {
  it('detects function components and captures destructured props + type', async () => {
    const { symbols } = await parseSample('components/UserCard.tsx');
    const card = symbols.find((s) => s.name === 'UserCard');
    expect(card?.kind).toBe('component');
    expect(card?.meta['componentKind']).toBe('function');
    expect(card?.meta['props']).toEqual(['user', 'onSelect']);
    expect(card?.meta['propsType']).toBe('UserCardProps');
  });

  it('detects memo and forwardRef wrappers', async () => {
    const button = (await parseSample('components/Button.tsx')).symbols.find(
      (s) => s.name === 'Button',
    );
    const modal = (await parseSample('components/Modal.tsx')).symbols.find(
      (s) => s.name === 'Modal',
    );
    expect(button?.kind).toBe('component');
    expect(button?.meta['componentKind']).toBe('memo');
    expect(modal?.kind).toBe('component');
    expect(modal?.meta['componentKind']).toBe('forwardRef');
  });

  it('records JSX usage as references (USES_COMPONENT raw material)', async () => {
    const { symbols, references } = await parseSample('components/UserList.tsx');
    const list = symbols.find((s) => s.name === 'UserList');
    expect(list?.meta['jsxUsage']).toMatchObject({ UserCard: 1 });
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'UserList', name: 'UserCard', kind: 'jsx' }),
    );
  });

  it('does not misclassify capitalized non-JSX functions', async () => {
    const { symbols } = await parseSample('pages/HomePage.tsx');
    expect(symbols.find((s) => s.name === 'HomePage')?.kind).toBe('component');
    expect(symbols.find((s) => s.name === 'APP_NAAME_SAFE')?.kind).toBe('function');
  });

  it('detects class components and provider JSX with member tags', async () => {
    const { symbols } = await engine.parseFile(
      't',
      'a.tsx',
      [
        "import { Component } from 'react';",
        'export class Legacy extends Component<{ label: string }> {',
        '  render() { return <span>{this.props.label}</span>; }',
        '}',
      ].join('\n'),
    );
    const legacy = symbols.find((s) => s.name === 'Legacy');
    expect(legacy?.kind).toBe('component');
    expect(legacy?.meta['componentKind']).toBe('class');
  });

  it('AuthProvider renders the context provider member tag', async () => {
    const { symbols } = await parseSample('auth/AuthContext.tsx');
    const provider = symbols.find((s) => s.name === 'AuthProvider');
    expect(provider?.kind).toBe('component');
    expect(provider?.meta['jsxUsage']).toMatchObject({ 'AuthContext.Provider': 1 });
  });
});
