import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditError, hashContent } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import type { EditRow, MetadataStore } from '@twograph/store';
import { applyPatch, parsePatch } from 'diff';
import { writeFilesAtomically } from './apply.js';
import { planEdit } from './engine.js';
import type { EditOperationRegistry } from './registry.js';

/** Pending previews older than this are treated as expired (docs/08 §1 step 4). */
export const DEFAULT_EDIT_EXPIRY_MS = 60 * 60 * 1000;

interface AppliedFileRecord {
  /** Pre-image content — restored on revert. */
  before: string;
  /** Post-image hash — revert only proceeds if the current file still matches this. */
  afterHash: string;
}

export interface ProposeEditDeps {
  store: MetadataStore;
  repo: string;
  rootPath: string;
  graphQueries: GraphQueries;
}

/**
 * Plans an edit and persists it as a pending preview (docs/08 §1 step 3).
 * Nothing on disk changes here — only `approveEdit` writes files.
 */
export async function proposeEdit(
  registry: EditOperationRegistry,
  deps: ProposeEditDeps,
  operationId: string,
  rawParams: unknown,
): Promise<EditRow> {
  const plan = await planEdit(registry, deps, operationId, rawParams);
  const fileHashes: Record<string, string> = {};
  for (const path of plan.affectedFiles) {
    fileHashes[path] = hashContent(readFileSync(join(deps.rootPath, path), 'utf8'));
  }
  return deps.store.createEdit(
    deps.repo,
    operationId,
    JSON.stringify(rawParams),
    plan.diff,
    fileHashes,
  );
}

/** @throws EditError('EDIT_NOT_PREVIEWED') if there's no pending preview under this id. */
function requirePendingEdit(store: MetadataStore, editId: string): EditRow {
  const row = store.getEdit(editId);
  if (!row || row.status !== 'pending') {
    throw new EditError('EDIT_NOT_PREVIEWED', `no pending edit preview: ${editId}`);
  }
  return row;
}

function stripDiffPrefix(fileName: string | undefined): string {
  return (fileName ?? '').replace(/^[ab]\//, '');
}

export interface ApproveEditDeps {
  store: MetadataStore;
  rootPath: string;
  /** Re-processes touched files so graph/embeddings reflect the edit (docs/08 §1 step 6). */
  reindex?: (paths: string[]) => Promise<void>;
  /** Overrides {@link DEFAULT_EDIT_EXPIRY_MS}. */
  expiryMs?: number;
}

/**
 * Approves a pending edit (issue #49, docs/08 §1 steps 4-6): rejects
 * expired/already-resolved previews, re-validates every affected file's hash
 * against the preview snapshot (drift ⇒ `expired`, forcing a re-propose),
 * applies the previewed diff atomically across all touched files, journals
 * pre-images for revert, and triggers reindexing of the touched files.
 */
export async function approveEdit(deps: ApproveEditDeps, editId: string): Promise<EditRow> {
  const row = requirePendingEdit(deps.store, editId);
  const ttlMs = deps.expiryMs ?? DEFAULT_EDIT_EXPIRY_MS;

  if (deps.store.isEditExpired(editId, ttlMs)) {
    deps.store.resolveEdit(editId, 'expired');
    throw new EditError('EDIT_STALE', `edit preview expired: ${editId}`);
  }

  const fileHashes = JSON.parse(row.file_hashes_json) as Record<string, string>;
  const originalContentByPath: Record<string, string> = {};
  for (const path of Object.keys(fileHashes)) {
    const currentText = readFileSync(join(deps.rootPath, path), 'utf8');
    if (hashContent(currentText) !== fileHashes[path]) {
      deps.store.resolveEdit(editId, 'expired');
      throw new EditError('EDIT_STALE', `file changed since preview, re-propose the edit: ${path}`);
    }
    originalContentByPath[path] = currentText;
  }

  const newContentByPath: Record<string, string> = {};
  const appliedFiles: Record<string, AppliedFileRecord> = {};
  for (const patch of parsePatch(row.diff)) {
    const path = stripDiffPrefix(patch.newFileName ?? patch.oldFileName);
    const original = originalContentByPath[path];
    if (original === undefined) {
      throw new EditError('EDIT_INVALID', `diff references an unexpected file: ${path}`);
    }
    const patched = applyPatch(original, patch);
    if (patched === false) {
      throw new EditError('EDIT_INVALID', `stored diff no longer applies cleanly to ${path}`);
    }
    newContentByPath[path] = patched;
    appliedFiles[path] = { before: original, afterHash: hashContent(patched) };
  }

  writeFilesAtomically(deps.rootPath, newContentByPath, originalContentByPath);
  deps.store.resolveEdit(editId, 'applied', JSON.stringify(appliedFiles));

  const touchedPaths = Object.keys(newContentByPath);
  if (deps.reindex) await deps.reindex(touchedPaths);

  const updated = deps.store.getEdit(editId);
  if (!updated) throw new Error(`edit vanished after apply: ${editId}`);
  return updated;
}

/** Rejects a pending edit without ever writing to disk. */
export function rejectEdit(store: MetadataStore, editId: string): EditRow {
  requirePendingEdit(store, editId);
  store.resolveEdit(editId, 'rejected');
  const updated = store.getEdit(editId);
  if (!updated) throw new Error(`edit vanished after reject: ${editId}`);
  return updated;
}

/**
 * Reverts a previously applied edit (docs/08 §1 step 7): restores the
 * journaled pre-images, but only if every touched file's current content
 * still matches what was written at apply time (otherwise something else
 * has changed those files since, and reverting would clobber it).
 */
export function revertEdit(store: MetadataStore, rootPath: string, editId: string): EditRow {
  const row = store.getEdit(editId);
  if (!row || row.status !== 'applied' || !row.applied_files_json) {
    throw new EditError('EDIT_NOT_PREVIEWED', `no applied edit to revert: ${editId}`);
  }

  const appliedFiles = JSON.parse(row.applied_files_json) as Record<string, AppliedFileRecord>;
  const currentContentByPath: Record<string, string> = {};
  for (const [path, record] of Object.entries(appliedFiles)) {
    const currentText = readFileSync(join(rootPath, path), 'utf8');
    if (hashContent(currentText) !== record.afterHash) {
      throw new EditError(
        'EDIT_STALE',
        `file changed since this edit was applied, refusing to revert: ${path}`,
      );
    }
    currentContentByPath[path] = currentText;
  }

  const preImageByPath = Object.fromEntries(
    Object.entries(appliedFiles).map(([path, record]) => [path, record.before]),
  );
  writeFilesAtomically(rootPath, preImageByPath, currentContentByPath);
  store.resolveEdit(editId, 'reverted');

  const updated = store.getEdit(editId);
  if (!updated) throw new Error(`edit vanished after revert: ${editId}`);
  return updated;
}
