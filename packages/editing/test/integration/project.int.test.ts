import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { bootstrapSchema, GraphClient, GraphQueries, GraphWriter } from '@twograph/graph';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import { loadScopedProject } from '@twograph/editing';

const REPO = 'editing-project-test';
const URI = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const client = new GraphClient({ uri: URI });
const writer = new GraphWriter(client);
const queries = new GraphQueries(client);
const engine = new ParserEngine();
const ROOT = join(import.meta.dirname, '../../../../examples/sample-repo/src');

const wipe = () => client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });

beforeAll(async () => {
  if (!(await client.healthcheck())) throw new Error(`Memgraph not reachable at ${URI}`);
  await bootstrapSchema(client);
  await wipe();
  const files: ParsedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) await walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(await engine.parseFile(REPO, relative(ROOT, full), readFileSync(full, 'utf8')));
      }
    }
  };
  await walk(ROOT);
  resolveReferences(files);
  const resolver = createModuleResolver(files.map((f) => f.path));
  await writer.ensureRepository({ id: REPO, name: 'sample', rootPath: ROOT });
  for (const f of files) await writer.writeParsedFile(f);
  for (const f of files) {
    await writer.writeStructuralEdges(f, resolver);
    await writer.writeBehavioralEdges(f);
    await writer.writeReactEdges(f);
  }
}, 120_000);

afterAll(async () => {
  await wipe();
  await client.close();
});

describe('loadScopedProject', () => {
  it('scopes to the entry file plus its graph-derived dependents, not the whole repo', async () => {
    const project = await loadScopedProject(ROOT, queries, REPO, ['auth/jwt.ts']);
    const loadedPaths = new Set(
      project.getSourceFiles().map((f) => relative(ROOT, f.getFilePath())),
    );

    expect(loadedPaths.has('auth/jwt.ts')).toBe(true);
    // Real dependents recorded via IMPORTS edges.
    expect(loadedPaths.has('auth/authService.ts')).toBe(true);
    expect(loadedPaths.has('api/handlers.ts')).toBe(true);

    // A file unrelated to auth/jwt.ts must not have been pulled in — proves
    // the project is scoped, not the whole repo.
    expect(loadedPaths.has('components/Button.tsx')).toBe(false);
    expect(loadedPaths.size).toBeLessThan(readdirSyncRecursiveCount());
  });

  it('scopes to just the entry file when nothing depends on it', async () => {
    // A leaf component nothing else imports (per the sample-repo fixture's dead-code case).
    const project = await loadScopedProject(ROOT, queries, REPO, ['components/DeadBanner.tsx']);
    const loadedPaths = project.getSourceFiles().map((f) => relative(ROOT, f.getFilePath()));
    expect(loadedPaths).toEqual(['components/DeadBanner.tsx']);
  });
});

function readdirSyncRecursiveCount(): number {
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) count += 1;
    }
  };
  walk(ROOT);
  return count;
}
