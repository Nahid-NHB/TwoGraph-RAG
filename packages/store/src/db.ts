import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StoreError } from '@twograph/core';
import { applyMigrations } from './migrations.js';

export type { DatabaseSync };

/**
 * Opens (creating if needed) the metadata database and applies migrations.
 * Uses the Node built-in SQLite — no native compilation required.
 */
export function openDatabase(path: string): DatabaseSync {
  try {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    applyMigrations(db);
    return db;
  } catch (err) {
    throw new StoreError(`failed to open database at ${path}`, { cause: err });
  }
}
