import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();
const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');
const parseSample = (rel: string) =>
  engine.parseFile('sample', rel, readFileSync(join(SRC, rel), 'utf8'));

describe('express detector', () => {
  it('extracts routes with method, pattern, and handler references', async () => {
    const { symbols, references } = await parseSample('api/server.ts');
    const routes = symbols.filter((s) => s.kind === 'route');
    expect(routes.map((r) => r.meta['routePattern'])).toEqual(
      expect.arrayContaining(['/api/users', '/api/users/:id', '/api/login']),
    );
    const byId = routes.find((r) => r.meta['routePattern'] === '/api/users/:id');
    expect(byId?.meta).toMatchObject({ framework: 'express', method: 'GET' });
    expect(references).toContainEqual(
      expect.objectContaining({ name: 'getUserHandler', kind: 'call' }),
    );
  });
});

describe('react-router detector', () => {
  it('extracts Route elements with element component references', async () => {
    const { symbols, references } = await parseSample('App.tsx');
    const routes = symbols.filter((s) => s.kind === 'route');
    expect(routes.map((r) => r.meta['routePattern'])).toEqual(
      expect.arrayContaining(['/', '/users', '/login', '/settings']),
    );
    expect(routes.every((r) => r.meta['framework'] === 'react-router')).toBe(true);
    expect(references).toContainEqual(expect.objectContaining({ name: 'UsersPage', kind: 'call' }));
  });
});

describe('next detector', () => {
  it('derives app-router patterns from file paths', async () => {
    const { symbols } = await engine.parseFile(
      't',
      'app/dashboard/settings/page.tsx',
      'export default function Page() { return null; }',
    );
    expect(symbols.find((s) => s.kind === 'route')?.meta).toMatchObject({
      framework: 'next',
      routePattern: '/dashboard/settings',
    });
  });

  it('derives pages-router patterns and skips _app', async () => {
    const withRoute = await engine.parseFile('t', 'pages/users/[id].tsx', 'export default 1;');
    expect(withRoute.symbols.find((s) => s.kind === 'route')?.meta['routePattern']).toBe(
      '/users/[id]',
    );
    const app = await engine.parseFile('t', 'pages/_app.tsx', 'export default 1;');
    expect(app.symbols.find((s) => s.kind === 'route')).toBeUndefined();
  });
});
