import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { EditError } from '@twograph/core';

/**
 * Writes every file in `contentByPath` atomically and all-or-nothing (docs/08
 * §1 step 5, issue #49): every file is first written to a temp path in its
 * own directory, and only once EVERY temp write has succeeded are the files
 * renamed into place (rename is atomic per file on POSIX). If a temp write
 * fails, no real file has been touched yet. If a rename itself fails (rare —
 * same-filesystem renames essentially never fail), already-renamed files are
 * best-effort restored from `originalContentByPath` so a partial apply never
 * survives.
 */
export function writeFilesAtomically(
  rootPath: string,
  contentByPath: Record<string, string>,
  originalContentByPath: Record<string, string>,
): void {
  const paths = Object.keys(contentByPath);
  const tempPathByPath: Record<string, string> = {};

  try {
    for (const path of paths) {
      const absolutePath = join(rootPath, path);
      const tempPath = join(dirname(absolutePath), `.twograph-edit-${randomUUID()}.tmp`);
      fs.writeFileSync(tempPath, contentByPath[path]!, 'utf8');
      tempPathByPath[path] = tempPath;
    }
  } catch (err) {
    for (const tempPath of Object.values(tempPathByPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best-effort cleanup of a temp file that never got renamed
      }
    }
    throw new EditError('EDIT_INVALID', `failed to write edit files: ${String(err)}`, {
      cause: err,
    });
  }

  const renamedPaths: string[] = [];
  try {
    for (const path of paths) {
      fs.renameSync(tempPathByPath[path]!, join(rootPath, path));
      renamedPaths.push(path);
    }
  } catch (err) {
    for (const path of renamedPaths) {
      try {
        fs.writeFileSync(join(rootPath, path), originalContentByPath[path]!, 'utf8');
      } catch {
        // best-effort rollback — surfaced error below is already fatal
      }
    }
    throw new EditError(
      'EDIT_INVALID',
      `apply failed partway through (${String(renamedPaths.length)}/${String(paths.length)} files renamed) and was rolled back: ${String(err)}`,
      { cause: err },
    );
  }
}
