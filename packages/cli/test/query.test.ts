import { describe, expect, it } from 'vitest';
import type { Citation } from '@twograph/core';
import { formatCitation, renderAnswer } from '../src/commands/query.js';

function makeIo(): { io: { out(l: string): void; err(l: string): void }; out: string[] } {
  const out: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: () => {} }, out };
}

describe('formatCitation', () => {
  it('formats as path:startLine-endLine', () => {
    const citation: Citation = { file: 'auth/jwt.ts', startLine: 10, endLine: 20 };
    expect(formatCitation(citation)).toBe('auth/jwt.ts:10-20');
  });

  it('ignores symbolId/graphPath in the rendered form', () => {
    const citation: Citation = {
      file: 'auth/jwt.ts',
      symbolId: 'r:auth/jwt.ts#verifyToken',
      startLine: 10,
      endLine: 20,
      graphPath: 'isAuthorized -> verifyToken',
    };
    expect(formatCitation(citation)).toBe('auth/jwt.ts:10-20');
  });
});

describe('renderAnswer', () => {
  it('prints the answer and a Sources section with one line per citation', () => {
    const { io, out } = makeIo();
    renderAnswer(io, {
      content: 'verifyToken checks the bearer token [S1].',
      citations: [{ file: 'auth/jwt.ts', startLine: 10, endLine: 20 }],
    });
    expect(out).toEqual([
      'verifyToken checks the bearer token [S1].',
      '',
      'Sources:',
      '  auth/jwt.ts:10-20',
    ]);
  });

  it('omits the Sources section when there are no citations', () => {
    const { io, out } = makeIo();
    renderAnswer(io, { content: 'Not enough context to answer this question.', citations: [] });
    expect(out).toEqual(['Not enough context to answer this question.']);
  });

  it('prints one line per citation in order', () => {
    const { io, out } = makeIo();
    renderAnswer(io, {
      content: 'Answer [S1][S2].',
      citations: [
        { file: 'auth/jwt.ts', startLine: 10, endLine: 20 },
        { file: 'api/handlers.ts', startLine: 40, endLine: 42 },
      ],
    });
    expect(out.slice(3)).toEqual(['  auth/jwt.ts:10-20', '  api/handlers.ts:40-42']);
  });
});
