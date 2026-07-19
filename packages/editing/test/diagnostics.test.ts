import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { assertParsesCleanly, assertProjectParsesCleanly } from '@twograph/editing';

describe('assertParsesCleanly', () => {
  it('accepts syntactically valid TypeScript', () => {
    expect(() =>
      assertParsesCleanly('a.ts', 'export function f(x: number): number { return x; }'),
    ).not.toThrow();
  });

  it('accepts valid TSX', () => {
    expect(() =>
      assertParsesCleanly('a.tsx', 'export function C() { return <div>hi</div>; }'),
    ).not.toThrow();
  });

  it('rejects unbalanced braces', () => {
    expect(() =>
      assertParsesCleanly('a.ts', 'export function f(x: number): number { return x;'),
    ).toThrow(/invalid syntax/);
  });

  it('rejects a dangling operator', () => {
    expect(() => assertParsesCleanly('a.ts', 'const x = 1 +;')).toThrow(/invalid syntax/);
  });
});

describe('assertProjectParsesCleanly', () => {
  it('passes for a project with only valid files', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('a.ts', 'export const a = 1;');
    project.createSourceFile('b.ts', 'export const b = 2;');
    expect(() => assertProjectParsesCleanly(project)).not.toThrow();
  });

  it('throws when any file in the project has broken syntax', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('a.ts', 'export const a = 1;');
    const broken = project.createSourceFile('b.ts', 'export const b = 2;');
    // Simulate an operation corrupting a file in memory.
    broken.replaceWithText('export function broken( {');
    expect(() => assertProjectParsesCleanly(project)).toThrow(/invalid syntax/);
  });
});
