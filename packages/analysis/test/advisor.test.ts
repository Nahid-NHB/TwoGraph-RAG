import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockLlmProvider } from '@twograph/llm';
import { runAdvisor } from '../src/advisor/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-advisor-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const GUIDELINES_FILE = '.twograph/guidelines.md';

function writeGuidelines(content: string): void {
  mkdirSync(join(root, '.twograph'), { recursive: true });
  writeFileSync(join(root, GUIDELINES_FILE), content);
}

describe('runAdvisor', () => {
  it('includes rule-pack findings and an LLM-composed narrative', async () => {
    const llm = new MockLlmProvider(['Add an alt attribute for accessibility.']);
    const source = '<img src="logo.png" />';

    const report = await runAdvisor(
      llm,
      'r:a.tsx#Logo',
      'a.tsx',
      source,
      10,
      root,
      GUIDELINES_FILE,
    );

    expect(report.findings.map((f) => f.ruleId)).toContain('a11y-img-alt');
    expect(report.advice).toBe('Add an alt attribute for accessibility.');
  });

  it('generates a safe apply_patch suggestion for a11y-img-alt only', async () => {
    const llm = new MockLlmProvider(['ok']);
    const source = 'function Logo() {\n  return <img src="logo.png" />;\n}\n';

    const report = await runAdvisor(llm, 'r:a.tsx#Logo', 'a.tsx', source, 5, root, GUIDELINES_FILE);

    expect(report.suggestedPatch).toEqual({
      operation: 'apply_patch',
      params: {
        file: 'a.tsx',
        startLine: 6,
        endLine: 6,
        newText: '  return <img alt="" src="logo.png" />;',
      },
    });
  });

  it('suggests no patch when there is no auto-fixable finding', async () => {
    const llm = new MockLlmProvider(['ok']);
    const report = await runAdvisor(
      llm,
      'r:a.ts#f',
      'a.ts',
      'function f(x: any) { return x; }',
      1,
      root,
      GUIDELINES_FILE,
    );
    expect(report.suggestedPatch).toBeNull();
  });

  it('includes .twograph/guidelines.md content in the prompt when present', async () => {
    writeGuidelines(
      'We intentionally use `any` in this codebase for legacy interop — do not flag it.',
    );
    const llm = new MockLlmProvider(['ok']);

    await runAdvisor(
      llm,
      'r:a.ts#f',
      'a.ts',
      'function f(x: any) { return x; }',
      1,
      root,
      GUIDELINES_FILE,
    );

    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain('legacy interop');
  });

  it('changes the prompt when guidelines change, and omits guidelines entirely when absent', async () => {
    const llmNoGuidelines = new MockLlmProvider(['ok']);
    await runAdvisor(
      llmNoGuidelines,
      'r:a.ts#f',
      'a.ts',
      'const x: any = 1;',
      1,
      root,
      GUIDELINES_FILE,
    );
    const promptWithout =
      llmNoGuidelines.requests[0]?.messages.map((m) => m.content).join('\n') ?? '';
    expect(promptWithout).not.toContain('.twograph/guidelines.md');

    writeGuidelines('Guideline A: never use `any`.');
    const llmA = new MockLlmProvider(['ok']);
    await runAdvisor(llmA, 'r:a.ts#f', 'a.ts', 'const x: any = 1;', 1, root, GUIDELINES_FILE);
    const promptA = llmA.requests[0]?.messages.map((m) => m.content).join('\n') ?? '';

    writeGuidelines('Guideline B: `any` is fine at API boundaries.');
    const llmB = new MockLlmProvider(['ok']);
    await runAdvisor(llmB, 'r:a.ts#f', 'a.ts', 'const x: any = 1;', 1, root, GUIDELINES_FILE);
    const promptB = llmB.requests[0]?.messages.map((m) => m.content).join('\n') ?? '';

    expect(promptA).not.toBe(promptB);
    expect(promptA).toContain('never use');
    expect(promptB).toContain('API boundaries');
  });
});
