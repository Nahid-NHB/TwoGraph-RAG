export interface RuleFinding {
  ruleId: string;
  message: string;
  /** 1-based line number relative to the start of the checked source text. */
  line: number;
  severity: 'info' | 'warning';
}

export interface Rule {
  id: string;
  description: string;
  check(sourceText: string): Omit<RuleFinding, 'ruleId'>[];
}

/** Common JS/TS keywords and globals that aren't "outer variables" for the deps-array heuristic. */
const NON_DEP_WORDS = new Set([
  'const',
  'let',
  'var',
  'return',
  'if',
  'else',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'new',
  'typeof',
  'console',
  'window',
  'document',
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Promise',
]);

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Best-effort candidate identifiers a hook body reads from the outer scope. */
function outerIdentifiers(body: string): Set<string> {
  const found = new Set<string>();
  for (const match of body.matchAll(/(\.\s*)?\b[a-z][a-zA-Z0-9]*\b/g)) {
    if (match[1]) continue; // `.log`/`.id` etc — a property name, not a free variable
    const word = match[0];
    if (NON_DEP_WORDS.has(word)) continue;
    if (/^set[A-Z]/.test(word)) continue; // setState setters are stable, never required in deps
    found.add(word);
  }
  return found;
}

const reactHookDeps: Rule = {
  id: 'react-hook-deps',
  description:
    'useEffect/useCallback/useMemo body references a variable missing from its deps array',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    const hookCall =
      /use(?:Effect|Callback|Memo)\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\{([\s\S]*?)\n?\}\s*,\s*\[([^\]]*)\]\s*\)/g;
    for (const match of text.matchAll(hookCall)) {
      const [, body, depsText] = match;
      if (body === undefined || depsText === undefined) continue;
      const deps = new Set(
        depsText
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
      );
      const missing = [...outerIdentifiers(body)].find((id) => !deps.has(id));
      if (missing) {
        findings.push({
          message: `"${missing}" is used in the effect/callback body but missing from its dependency array`,
          line: lineAt(text, match.index ?? 0),
          severity: 'warning',
        });
      }
    }
    return findings;
  },
};

const reactListKey: Rule = {
  id: 'react-list-key',
  description: '.map() rendering JSX without a key prop on the returned element',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    const mapCall = /\.map\(\s*(?:\([^)]*\)|\w+)\s*=>\s*(?:\(?\s*)?(<[A-Za-z][\w.]*)\b([^>]*)>/g;
    for (const match of text.matchAll(mapCall)) {
      const [, , attrs] = match;
      if (attrs !== undefined && !/\bkey\s*=/.test(attrs)) {
        findings.push({
          message: 'JSX element rendered inside .map() has no key prop',
          line: lineAt(text, match.index ?? 0),
          severity: 'warning',
        });
      }
    }
    return findings;
  },
};

const perfArrayIndexKey: Rule = {
  id: 'perf-array-index-key',
  description: 'Array index used as a React list key',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    const mapWithIndex = /\.map\(\s*\([^,)]+,\s*(\w+)\)\s*=>[\s\S]*?key=\{\s*\1\s*\}/g;
    for (const match of text.matchAll(mapWithIndex)) {
      findings.push({
        message: 'Array index used as the key prop — breaks on reorder/insert/delete',
        line: lineAt(text, match.index ?? 0),
        severity: 'warning',
      });
    }
    return findings;
  },
};

const reactMemoInlineProp: Rule = {
  id: 'react-memo-inline-prop',
  description:
    'A memoized component is invoked with an inline function/object prop, defeating memo',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    // `const Row = memo(RowImpl)` — call sites use the *assigned* name
    // ("Row"), not memo()'s argument, so capture the LHS of the assignment.
    for (const memoMatch of text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*memo\(/g)) {
      const name = memoMatch[1];
      if (!name) continue;
      const usage = new RegExp(`<${name}\\b[^>]*=\\{(?:\\([^)]*\\)\\s*=>|function\\b|\\{)`, 'g');
      for (const useMatch of text.matchAll(usage)) {
        findings.push({
          message: `<${name}> is memoized but called with a new inline function/object prop every render`,
          line: lineAt(text, useMatch.index ?? 0),
          severity: 'info',
        });
      }
    }
    return findings;
  },
};

const tsAnyLeak: Rule = {
  id: 'ts-any-leak',
  description: 'Explicit `any` type annotation',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    for (const match of text.matchAll(/:\s*any\b(?!\w)/g)) {
      findings.push({
        message: 'Explicit `any` type annotation leaks untyped values',
        line: lineAt(text, match.index ?? 0),
        severity: 'warning',
      });
    }
    return findings;
  },
};

const tsNonNullAssertion: Rule = {
  id: 'ts-non-null-assertion',
  description: 'Non-null assertion operator (!) suppresses a real null/undefined check',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    for (const match of text.matchAll(/[\w)\]]!(?![=:])/g)) {
      findings.push({
        message: 'Non-null assertion (!) — consider a real null check or optional chaining',
        line: lineAt(text, match.index ?? 0),
        severity: 'info',
      });
    }
    return findings;
  },
};

const a11yImgAlt: Rule = {
  id: 'a11y-img-alt',
  description: '<img> element missing an alt attribute',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    for (const match of text.matchAll(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi)) {
      findings.push({
        message: '<img> is missing an alt attribute (accessibility)',
        line: lineAt(text, match.index ?? 0),
        severity: 'warning',
      });
    }
    return findings;
  },
};

const securityDangerousHtml: Rule = {
  id: 'security-dangerous-html',
  description: 'dangerouslySetInnerHTML usage',
  check(text) {
    const findings: Omit<RuleFinding, 'ruleId'>[] = [];
    for (const match of text.matchAll(/dangerouslySetInnerHTML/g)) {
      findings.push({
        message: "dangerouslySetInnerHTML bypasses React's escaping — verify the HTML is sanitized",
        line: lineAt(text, match.index ?? 0),
        severity: 'warning',
      });
    }
    return findings;
  },
};

export const RULE_PACK: readonly Rule[] = [
  reactHookDeps,
  reactListKey,
  perfArrayIndexKey,
  reactMemoInlineProp,
  tsAnyLeak,
  tsNonNullAssertion,
  a11yImgAlt,
  securityDangerousHtml,
];

/** Runs every rule in the pack against a symbol's source text. */
export function runRulePack(sourceText: string): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of RULE_PACK) {
    for (const finding of rule.check(sourceText)) {
      findings.push({ ruleId: rule.id, ...finding });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
