export interface DiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses the concatenated unified-diff text produced by `createTwoFilesPatch`
 * (one patch block per file, joined with `\n` — see packages/editing/src/plan.ts)
 * into per-file hunks for rendering.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let currentHunk: DiffHunk | undefined;
  let oldLine = 1;
  let newLine = 1;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('Index: ')) {
      current = { path: line.slice('Index: '.length).trim(), hunks: [] };
      files.push(current);
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith('===') || line.startsWith('--- ')) continue;
    if (line.startsWith('+++ ')) {
      if (!current) {
        const path = (line.slice(4).split('\t')[0] ?? '').trim();
        current = { path, hunks: [] };
        files.push(current);
      }
      continue;
    }
    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line);
      oldLine = match?.[1] ? Number(match[1]) : 1;
      newLine = match?.[2] ? Number(match[2]) : 1;
      currentHunk = { header: line, lines: [] };
      current?.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk || line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++ });
    } else {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }
  return files;
}
