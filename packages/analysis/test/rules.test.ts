import { describe, expect, it } from 'vitest';
import { RULE_PACK, runRulePack } from '../src/advisor/rules.js';

function idsOf(text: string): string[] {
  return runRulePack(text).map((f) => f.ruleId);
}

describe('rule pack — react-hook-deps', () => {
  it('flags a variable used in the effect body but missing from its deps array', () => {
    const src = `
      function Comp({ userId }) {
        useEffect(() => {
          fetchUser(userId);
        }, []);
      }
    `;
    expect(idsOf(src)).toContain('react-hook-deps');
  });

  it('does not flag when every referenced variable is listed', () => {
    const src = `
      function Comp({ userId }) {
        useEffect(() => {
          console.log(userId);
        }, [userId]);
      }
    `;
    expect(idsOf(src)).not.toContain('react-hook-deps');
  });

  it('does not flag a stable setState setter', () => {
    const src = `
      function Comp() {
        useEffect(() => {
          setCount(0);
        }, []);
      }
    `;
    expect(idsOf(src)).not.toContain('react-hook-deps');
  });
});

describe('rule pack — react-list-key', () => {
  it('flags a mapped JSX element with no key', () => {
    const src = `function List({ items }) { return items.map((item) => <li>{item}</li>); }`;
    expect(idsOf(src)).toContain('react-list-key');
  });

  it('does not flag when a key prop is present', () => {
    const src = `function List({ items }) { return items.map((item) => <li key={item.id}>{item.name}</li>); }`;
    expect(idsOf(src)).not.toContain('react-list-key');
  });
});

describe('rule pack — perf-array-index-key', () => {
  it('flags the map index reused as the key', () => {
    const src = `items.map((item, index) => <li key={index}>{item}</li>);`;
    expect(idsOf(src)).toContain('perf-array-index-key');
  });

  it('does not flag a stable id used as the key', () => {
    const src = `items.map((item, index) => <li key={item.id}>{item}</li>);`;
    expect(idsOf(src)).not.toContain('perf-array-index-key');
  });
});

describe('rule pack — react-memo-inline-prop', () => {
  it('flags a memoized component invoked with an inline arrow prop', () => {
    const src = `
      const Row = memo(RowImpl);
      function List() {
        return <Row onClick={() => doThing()} />;
      }
    `;
    expect(idsOf(src)).toContain('react-memo-inline-prop');
  });

  it('does not flag a memoized component invoked with a stable prop', () => {
    const src = `
      const Row = memo(RowImpl);
      function List() {
        const onClick = useCallback(() => doThing(), []);
        return <Row onClick={onClick} />;
      }
    `;
    expect(idsOf(src)).not.toContain('react-memo-inline-prop');
  });
});

describe('rule pack — ts-any-leak', () => {
  it('flags an explicit any annotation', () => {
    expect(idsOf('function f(x: any) { return x; }')).toContain('ts-any-leak');
  });

  it('does not flag a real type annotation', () => {
    expect(idsOf('function f(x: string) { return x; }')).not.toContain('ts-any-leak');
  });
});

describe('rule pack — ts-non-null-assertion', () => {
  it('flags a non-null assertion', () => {
    expect(idsOf('const el = document.getElementById("x")!;')).toContain('ts-non-null-assertion');
  });

  it('does not flag a not-equal comparison', () => {
    expect(idsOf('if (a !== b) { doThing(); }')).not.toContain('ts-non-null-assertion');
  });
});

describe('rule pack — a11y-img-alt', () => {
  it('flags an img with no alt attribute', () => {
    expect(idsOf('<img src="x.png" />')).toContain('a11y-img-alt');
  });

  it('does not flag an img with an alt attribute', () => {
    expect(idsOf('<img src="x.png" alt="a description" />')).not.toContain('a11y-img-alt');
  });
});

describe('rule pack — security-dangerous-html', () => {
  it('flags dangerouslySetInnerHTML', () => {
    expect(idsOf('<div dangerouslySetInnerHTML={{ __html: html }} />')).toContain(
      'security-dangerous-html',
    );
  });

  it('does not flag plain children', () => {
    expect(idsOf('<div>{text}</div>')).not.toContain('security-dangerous-html');
  });
});

describe('runRulePack', () => {
  it('is deterministic — same input always yields the same findings', () => {
    const src = '<img src="x.png" />';
    expect(runRulePack(src)).toEqual(runRulePack(src));
  });

  it('registers every rule id exactly once', () => {
    const ids = RULE_PACK.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
