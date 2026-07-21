import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileTreeNode } from '@twograph/server';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

interface FlatRow {
  node: FileTreeNode;
  depth: number;
}

function flatten(
  nodes: FileTreeNode[],
  depth: number,
  expanded: Set<string>,
  out: FlatRow[],
): void {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.type === 'directory' && expanded.has(node.path)) {
      flatten(node.children, depth + 1, expanded, out);
    }
  }
}

const ROW_HEIGHT = 28;

/** Virtualized so the tree stays smooth even at thousands of files (issue #57). */
export function FileTree({
  tree,
  selectedPath,
  onSelectFile,
}: {
  tree: FileTreeNode[];
  selectedPath: string | undefined;
  onSelectFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand every ancestor directory of the initially-selected file.
    if (!selectedPath) return new Set();
    const dirs = new Set<string>();
    const segments = selectedPath.split('/');
    let current = '';
    for (let i = 0; i < segments.length - 1; i++) {
      current = current ? `${current}/${segments[i]}` : segments[i]!;
      dirs.add(current);
    }
    return dirs;
  });

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    flatten(tree, 0, expanded, out);
    return out;
  }, [tree, expanded]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  function toggleDir(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]!;
          const isDir = row.node.type === 'directory';
          const isOpen = isDir && expanded.has(row.node.path);
          const isSelected = !isDir && row.node.path === selectedPath;

          return (
            <button
              key={virtualRow.key}
              type="button"
              onClick={() => (isDir ? toggleDir(row.node.path) : onSelectFile(row.node.path))}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${String(ROW_HEIGHT)}px`,
                transform: `translateY(${String(virtualRow.start)}px)`,
                paddingLeft: `${String(row.depth * 14 + 8)}px`,
              }}
              className={`flex items-center gap-1.5 truncate text-left text-sm ${
                isSelected
                  ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
              }`}
            >
              {isDir ? (
                <>
                  <ChevronRight
                    size={13}
                    className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  {isOpen ? (
                    <FolderOpen size={14} className="shrink-0 text-slate-400" />
                  ) : (
                    <Folder size={14} className="shrink-0 text-slate-400" />
                  )}
                </>
              ) : (
                <File size={14} className="ml-[13px] shrink-0 text-slate-400" />
              )}
              <span className="truncate">{row.node.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
