import { EditError } from '@twograph/core';
import { ts, type Project } from 'ts-morph';

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.mts') || path.endsWith('.cts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.TS;
}

/**
 * Syntax-only reparse of a file's post-edit text (docs/08 §3: "every touched
 * file must parse cleanly"). Deliberately not a full type-check — a scoped
 * project only contains a subset of the repo, so semantic diagnostics (e.g.
 * "cannot find module") would be spurious for anything outside that scope.
 *
 * @throws EditError('EDIT_INVALID') if the text has syntax errors.
 */
export function assertParsesCleanly(path: string, text: string): void {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(path),
  );
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] })
    .parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const messages = diagnostics
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ');
    throw new EditError('EDIT_INVALID', `edit produced invalid syntax in ${path}: ${messages}`);
  }
}

/** Reparses every source file currently in the (post-edit) project. */
export function assertProjectParsesCleanly(project: Project): void {
  for (const sourceFile of project.getSourceFiles()) {
    assertParsesCleanly(sourceFile.getFilePath(), sourceFile.getFullText());
  }
}
