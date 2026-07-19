import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphQueries } from '@twograph/graph';
import { Project, ts } from 'ts-morph';

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
    return new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });
  }
  return new Project({ compilerOptions: FALLBACK_COMPILER_OPTIONS });
}

/**
 * Loads a ts-morph `Project` scoped to just the files an edit operation
 * needs (issue #48, docs/08 §1): the entry file(s) plus every file the
 * graph's `IMPORTS` edges say depends on them — not the whole repo, so
 * planning stays fast even on large codebases.
 */
export async function loadScopedProject(
  rootPath: string,
  graphQueries: GraphQueries,
  repo: string,
  entryPaths: string[],
): Promise<Project> {
  const project = newProject(rootPath);

  const paths = new Set(entryPaths);
  for (const entry of entryPaths) {
    const dependents = await graphQueries.dependentFiles(repo, entry);
    for (const dependent of dependents) paths.add(dependent);
  }

  for (const path of paths) {
    project.addSourceFileAtPath(join(rootPath, path));
  }

  return project;
}
