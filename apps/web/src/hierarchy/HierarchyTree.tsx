import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useCallees, useCallers, useComponentUsage, useDeadCode } from '../api/hooks.js';

export type HierarchyDirection = 'callers' | 'callees' | 'component';

interface HierarchyNode {
  id: string;
  name: string;
  kind: string;
  path: string | null;
}

/** Matches the call/component-tree acceptance criterion: "expandable to depth 5". */
const MAX_DEPTH = 5;

/**
 * Each expand click re-roots the callers/callees/usage query at the node
 * being opened (depth 1), rather than reusing one bulk depth-5 fetch from
 * the tree's overall root — the flat, depth-tagged list those endpoints
 * return has no per-node parent information, so a bulk fetch can't be
 * reassembled into a real parent/child tree. Fetching depth-1 relative to
 * each node as it's expanded produces correct edges directly.
 */
function TreeNode({
  repoId,
  node,
  direction,
  level,
  deadIds,
  onNavigate,
}: {
  repoId: string;
  node: HierarchyNode;
  direction: HierarchyDirection;
  level: number;
  deadIds: Set<string>;
  onNavigate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = level < MAX_DEPTH;
  const activeRepoId = expanded ? repoId : undefined;
  const callers = useCallers(direction === 'callers' ? activeRepoId : undefined, node.id, 1);
  const callees = useCallees(direction === 'callees' ? activeRepoId : undefined, node.id, 1);
  const component = useComponentUsage(
    direction === 'component' ? activeRepoId : undefined,
    node.id,
    1,
  );
  const { data: children, isLoading } =
    direction === 'callers' ? callers : direction === 'callees' ? callees : component;

  const isDead = deadIds.has(node.id);

  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${level * 16}px` }}>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="inline-block w-[14px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onNavigate(node.id)}
          className="truncate font-mono text-sm text-sky-700 hover:underline dark:text-sky-400"
        >
          {node.name}
        </button>
        <span className="shrink-0 text-xs text-slate-400">{node.kind}</span>
        {node.path && (
          <span className="truncate text-xs text-slate-400" title={node.path}>
            {node.path}
          </span>
        )}
        {isDead && (
          <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
            unused
          </span>
        )}
      </div>
      {expanded && (
        <div>
          {isLoading && (
            <div
              style={{ paddingLeft: `${(level + 1) * 16}px` }}
              className="py-0.5 text-xs text-slate-400"
            >
              Loading…
            </div>
          )}
          {!isLoading && children?.length === 0 && (
            <div
              style={{ paddingLeft: `${(level + 1) * 16}px` }}
              className="py-0.5 text-xs italic text-slate-400"
            >
              none
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.id}
              repoId={repoId}
              node={child}
              direction={direction}
              level={level + 1}
              deadIds={deadIds}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Expandable call-hierarchy / component-usage tree (issue #62): each node
 * fetches its own direct (depth-1) callers/callees/usages on expand, capped
 * at {@link MAX_DEPTH}. `direction: 'component'` additionally overlays an
 * "unused" badge on any node the dead-code report (issue #67) flags as a
 * never-rendered component.
 */
export function HierarchyTree({
  repoId,
  root,
  direction,
  onNavigate,
}: {
  repoId: string;
  root: HierarchyNode;
  direction: HierarchyDirection;
  onNavigate: (id: string) => void;
}) {
  const { data: deadCode } = useDeadCode(direction === 'component' ? repoId : undefined);
  const deadIds = new Set(
    (deadCode?.symbols ?? [])
      .filter((s) => s.kind === 'Component' && s.confidence === 'dead')
      .map((s) => s.id),
  );

  return (
    <div className="overflow-auto p-3 text-sm">
      <TreeNode
        repoId={repoId}
        node={root}
        direction={direction}
        level={0}
        deadIds={deadIds}
        onNavigate={onNavigate}
      />
    </div>
  );
}
