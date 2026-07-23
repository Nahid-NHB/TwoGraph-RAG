import { useMemo, useRef, useState } from 'react';
import { useDependencies } from '../api/hooks.js';
import { GraphCanvas, type GraphEdge, type GraphNode } from '../graph/GraphCanvas.js';

const MISMATCH_STYLES: Record<string, string> = {
  unused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  phantom: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

/**
 * Package → dependency graph with versions (issue #62): reuses the
 * force-graph canvas from #60 for the structural view, plus a details table
 * (canvas nodes have no room for version strings) with unused/phantom
 * mismatch badges from #68's dependency analysis.
 */
export function DepsExplorer({ repoId }: { repoId: string }) {
  const { data: report, isLoading } = useDependencies(repoId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size] = useState({ width: 800, height: 320 });

  const mismatchByName = useMemo(
    () => new Map((report?.mismatches ?? []).map((m) => [m.name, m])),
    [report],
  );

  const { nodes, edges } = useMemo(() => {
    if (!report) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    const graphNodes: GraphNode[] = [
      ...report.packages.map((p) => ({ id: p.id, name: p.name, kind: 'Package', path: p.path })),
      ...report.dependencies.map((d) => ({
        id: d.id,
        name: d.name,
        kind: 'Dependency',
        path: null,
      })),
    ];
    const graphEdges: GraphEdge[] = report.edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: 'DEPENDS_ON',
    }));
    return { nodes: graphNodes, edges: graphEdges };
  }, [report]);

  if (isLoading) return <p className="p-4 text-sm text-slate-400">Loading…</p>;
  if (!report) return null;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div ref={containerRef} className="shrink-0 border-b border-slate-200 dark:border-slate-800">
        {nodes.length > 0 ? (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodeClick={() => {}}
            width={size.width}
            height={size.height}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">
            No package.json dependencies indexed yet.
          </div>
        )}
      </div>

      <div className="flex-1 p-4">
        {report.packages.map((pkg) => {
          const depIds = new Set(report.edges.filter((e) => e.from === pkg.id).map((e) => e.to));
          const deps = report.dependencies.filter((d) => depIds.has(d.id));
          return (
            <div key={pkg.id} className="mb-6">
              <h3 className="mb-2 font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
                {pkg.name}
                {pkg.version && (
                  <span className="ml-2 text-xs font-normal text-slate-400">{pkg.version}</span>
                )}
              </h3>
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-1 font-medium">Dependency</th>
                    <th className="pb-1 font-medium">Kind</th>
                    <th className="pb-1 font-medium">Version</th>
                    <th className="pb-1 font-medium">Imports</th>
                    <th className="pb-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deps.map((d) => {
                    const edge = report.edges.find((e) => e.from === pkg.id && e.to === d.id);
                    const mismatch = mismatchByName.get(d.name);
                    return (
                      <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 font-mono text-slate-700 dark:text-slate-300">
                          {d.name}
                        </td>
                        <td className="py-1 text-slate-400">{d.depKind ?? '-'}</td>
                        <td className="py-1 text-slate-400">
                          {edge?.versionRange ?? d.versionRange ?? '-'}
                        </td>
                        <td className="py-1 text-slate-400">{d.importCount}</td>
                        <td className="py-1">
                          {mismatch && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${MISMATCH_STYLES[mismatch.kind]}`}
                            >
                              {mismatch.kind}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        {report.configurations.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Configurations
            </h3>
            <ul className="space-y-0.5 text-xs">
              {report.configurations.map((c) => (
                <li key={c.path} className="font-mono text-slate-600 dark:text-slate-400">
                  <span className="mr-1.5 text-slate-400">[{c.configKind}]</span>
                  {c.path}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
