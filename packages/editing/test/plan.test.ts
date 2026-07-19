import { applyPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { buildEditPlan, snapshotProject } from '@twograph/editing';

const ROOT = '/repo';

describe('snapshotProject + buildEditPlan', () => {
  it('reports no affected files when nothing changed', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(`${ROOT}/a.ts`, 'export const a = 1;\n');
    const before = snapshotProject(project, ROOT);

    const plan = buildEditPlan('noop', project, ROOT, before);

    expect(plan.affectedFiles).toEqual([]);
    expect(plan.diff).toBe('');
    expect(plan.fileContents).toEqual({});
  });

  it('diffs only the files an operation actually changed', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const a = project.createSourceFile(`${ROOT}/a.ts`, 'export const a = 1;\n');
    project.createSourceFile(`${ROOT}/b.ts`, 'export const b = 2;\n');
    const before = snapshotProject(project, ROOT);

    a.replaceWithText('export const a = 100;\n');

    const plan = buildEditPlan('bump_a', project, ROOT, before, ['a']);

    expect(plan.operation).toBe('bump_a');
    expect(plan.affectedFiles).toEqual(['a.ts']);
    expect(plan.affectedSymbols).toEqual(['a']);
    expect(plan.fileContents).toEqual({ 'a.ts': 'export const a = 100;\n' });
    expect(plan.diff).toContain('-export const a = 1;');
    expect(plan.diff).toContain('+export const a = 100;');
  });

  it('produces a unified diff that reproduces the new text exactly when applied', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const original = 'function greet(name) {\n  return "hi " + name;\n}\n';
    const a = project.createSourceFile(`${ROOT}/greet.ts`, original);
    const before = snapshotProject(project, ROOT);

    const updated = 'function greet(name) {\n  return `hi ${name}`;\n}\n';
    a.replaceWithText(updated);

    const plan = buildEditPlan('rewrite', project, ROOT, before);
    const patched = applyPatch(original, plan.diff);

    expect(patched).toBe(updated);
  });

  it('reports a new file (absent from the snapshot) as fully added', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const before = snapshotProject(project, ROOT); // empty — no files yet
    project.createSourceFile(`${ROOT}/new.ts`, 'export const created = true;\n');

    const plan = buildEditPlan('create_file', project, ROOT, before);

    expect(plan.affectedFiles).toEqual(['new.ts']);
    expect(plan.diff).toContain('+export const created = true;');
  });
});
