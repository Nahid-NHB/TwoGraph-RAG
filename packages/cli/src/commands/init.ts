import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_RELATIVE_PATH, defaultConfig, ValidationError } from '@twograph/core';

export interface InitOptions {
  force?: boolean;
}

/** Scaffolds `.twograph/config.json` with documented defaults. Returns the file path. */
export function runInit(cwd: string, options: InitOptions = {}): string {
  const path = join(cwd, CONFIG_RELATIVE_PATH);
  if (existsSync(path) && !options.force) {
    throw new ValidationError(`config already exists at ${path} (use --force to overwrite)`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  return path;
}
