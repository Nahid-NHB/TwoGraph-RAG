import { relative, sep } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { Project } from 'ts-morph';

export interface EditPlan {
  operation: string;
  /** Repo-relative paths whose in-memory content actually changed. */
  affectedFiles: string[];
  affectedSymbols: string[];
  /** Unified diff across every affected file, concatenated. */
  diff: string;
  /** Full post-edit content per affected file — what an `apply` step (issue #49) would write to disk. */
  fileContents: Record<string, string>;
}

/** Repo-relative path (POSIX separators) -> original file text, captured before an operation runs. */
export type ProjectSnapshot = ReadonlyMap<string, string>;

function toRepoRelative(rootPath: string, absPath: string): string {
  return relative(rootPath, absPath).split(sep).join('/');
}

/** Captures every scoped file's text before an operation mutates the project in memory. */
export function snapshotProject(project: Project, rootPath: string): ProjectSnapshot {
  const snapshot = new Map<string, string>();
  for (const sourceFile of project.getSourceFiles()) {
    snapshot.set(toRepoRelative(rootPath, sourceFile.getFilePath()), sourceFile.getFullText());
  }
  return snapshot;
}

/**
 * Diffs the project's current in-memory text against a pre-operation
 * snapshot and assembles the `EditPlan` (issue #48, docs/08 §1: "diff
 * preview" — nothing on disk changes here).
 */
export function buildEditPlan(
  operationId: string,
  project: Project,
  rootPath: string,
  before: ProjectSnapshot,
  affectedSymbols: string[] = [],
): EditPlan {
  const affectedFiles: string[] = [];
  const fileContents: Record<string, string> = {};
  const diffs: string[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const path = toRepoRelative(rootPath, sourceFile.getFilePath());
    const originalText = before.get(path) ?? '';
    const newText = sourceFile.getFullText();
    if (originalText === newText) continue;

    affectedFiles.push(path);
    fileContents[path] = newText;
    diffs.push(createTwoFilesPatch(path, path, originalText, newText));
  }

  return {
    operation: operationId,
    affectedFiles,
    affectedSymbols,
    diff: diffs.join('\n'),
    fileContents,
  };
}
