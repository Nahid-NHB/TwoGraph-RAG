import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphQueries } from '@twograph/graph';
import { Project, QuoteKind, ts } from 'ts-morph';

/** Matches this ecosystem's near-universal single-quote convention for any text ts-morph generates fresh. */
const MANIPULATION_SETTINGS = { quoteKind: QuoteKind.Single };

/** Reasonable defaults for repos with no tsconfig.json at their root. */
const FALLBACK_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
};

/** Builds a fresh ts-morph `Project`, using the target repo's own tsconfig.json when present. */
function newProject(rootPath: string): Project {
  const tsConfigFilePath = join(rootPath, 'tsconfig.json');
  if (existsSync(tsConfigFilePath)) {
    return new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
      manipulationSettings: MANIPULATION_SETTINGS,
    });
  }
  return new Project({
    compilerOptions: FALLBACK_COMPILER_OPTIONS,
    manipulationSettings: MANIPULATION_SETTINGS,
  });
}

/**
 * Loads a ts-morph `Project` scoped to just the files an edit operation
 * needs (issue #48, docs/08 §1): the entry file(s) plus every file the
 * graph's `IMPORTS`/`EXPORTS` edges say (transitively) depends on them — not
 * the whole repo, so planning stays fast even on large codebases. The walk
 * is transitive (not just one hop) so barrel chains resolve correctly: a
 * component importing the moved symbol through a re-exporting barrel is two
 * hops away (component -> barrel -> real file), and a single-hop lookup
 * would miss it entirely (issue #52).
 */
export async function loadScopedProject(
  rootPath: string,
  graphQueries: GraphQueries,
  repo: string,
  entryPaths: string[],
): Promise<Project> {
  const project = newProject(rootPath);

  const paths = new Set(entryPaths);
  const queue = [...entryPaths];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = await graphQueries.dependentFiles(repo, current);
    for (const dependent of dependents) {
      if (paths.has(dependent)) continue;
      paths.add(dependent);
      queue.push(dependent);
    }
  }

  for (const path of paths) {
    const absolutePath = join(rootPath, path);
    // A not-yet-existing entry path (e.g. move_function's new target file) is
    // the operation's own responsibility to create via `project.createSourceFile`.
    if (existsSync(absolutePath)) project.addSourceFileAtPath(absolutePath);
  }

  return project;
}
