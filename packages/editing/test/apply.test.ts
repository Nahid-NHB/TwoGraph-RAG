import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFilesAtomically } from '@twograph/editing';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-apply-'));
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'b.ts'), 'export const b = 2;\n');
});

afterEach(() => {
  // A prior fault-injection test may have left a subdirectory read-only.
  try {
    chmodSync(join(root, 'readonly'), 0o755);
  } catch {
    // directory may not exist in every test
  }
  rmSync(root, { recursive: true, force: true });
});

describe('writeFilesAtomically', () => {
  it('writes every file when all succeed', () => {
    writeFilesAtomically(
      root,
      { 'a.ts': 'export const a = 100;\n', 'b.ts': 'export const b = 200;\n' },
      { 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const b = 2;\n' },
    );

    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const a = 100;\n');
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('export const b = 200;\n');
  });

  it('leaves every file untouched when one write fails (all-or-nothing)', () => {
    mkdirSync(join(root, 'readonly'));
    writeFileSync(join(root, 'readonly', 'c.ts'), 'export const c = 3;\n');
    chmodSync(join(root, 'readonly'), 0o555); // read-only directory: writes inside it fail

    expect(() =>
      writeFilesAtomically(
        root,
        {
          'a.ts': 'export const a = 100;\n',
          'readonly/c.ts': 'export const c = 300;\n',
        },
        {
          'a.ts': 'export const a = 1;\n',
          'readonly/c.ts': 'export const c = 3;\n',
        },
      ),
    ).toThrow(/failed to write edit files/);

    // Neither file changed — the temp write for readonly/c.ts failed before
    // any rename happened, so a.ts was never touched either.
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(readFileSync(join(root, 'readonly', 'c.ts'), 'utf8')).toBe('export const c = 3;\n');
  });
});
