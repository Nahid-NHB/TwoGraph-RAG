// Maps @twograph/* imports to package sources so tests run without a prior build.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function workspaceAliases(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDir = join(root, 'packages');
  const aliases: Record<string, string> = {};
  if (!existsSync(packagesDir)) return aliases;
  for (const name of readdirSync(packagesDir)) {
    const entry = join(packagesDir, name, 'src', 'index.ts');
    if (existsSync(entry)) aliases[`@twograph/${name}`] = entry;
  }
  return aliases;
}
